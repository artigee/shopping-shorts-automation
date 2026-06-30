// IG 수집 — Playwright가 CDP로 내 디버그 크롬에 붙어, 그 페이지 컨텍스트에서
// IG 내부 web_info API를 내 로그인 쿠키로 호출. (콘솔 붙여넣기 2-홉 제거)
import { chromium } from 'playwright-core'
import { scoreReel } from './score.js'

const IG_APP_ID = '936619743392459'
const CDP_URL = process.env.CDP_URL || 'http://localhost:9222'

function tagError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

// 브라우저 페이지 컨텍스트에서 해시태그 web_info 호출 → 릴스 노드만 추려서 반환.
async function scrapeTag(page, tag) {
  return await page.evaluate(
    async ({ tag, appId }) => {
      const r = await fetch(
        'https://www.instagram.com/api/v1/tags/web_info/?tag_name=' + encodeURIComponent(tag),
        { headers: { 'x-ig-app-id': appId }, credentials: 'include' }
      )
      if (!r.ok) return { error: r.status }
      const data = await r.json()
      const out = []
      ;(function find(n) {
        if (!n || typeof n !== 'object') return
        if (n.pk && n.user && n.code) out.push(n)
        if (Array.isArray(n)) { n.forEach(find); return }
        for (const k in n) if (typeof n[k] === 'object') find(n[k])
      })(data.data)
      const seen = new Set(), rows = []
      for (const m of out) {
        if (seen.has(m.code)) continue
        seen.add(m.code)
        const iv = m.image_versions2 && m.image_versions2.candidates
        const thumb = (iv && iv.length && iv[0].url) || m.display_uri || m.thumbnail_url || ''
        rows.push({
          code: m.code,
          url: 'https://www.instagram.com/reel/' + m.code + '/',
          thumb,
          user: m.user && m.user.username,
          followers: (m.user && m.user.follower_count) || null,
          like: m.like_count || 0,
          comment: m.comment_count || 0,
          play: m.play_count || m.ig_play_count || m.view_count || 0,
          type: m.media_type,
          ptype: m.product_type,
          paid: !!m.is_paid_partnership,
          taken: m.taken_at,
          caption: (m.caption && m.caption.text) || '',
        })
      }
      return { rows }
    },
    { tag, appId: IG_APP_ID }
  )
}

export async function collect({ tags, minPlay = 1000, onProgress = () => {} }) {
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 4000 })
  } catch {
    throw tagError(
      'CHROME_NOT_FOUND',
      `디버그 크롬(${CDP_URL})에 못 붙음 — scripts/launch-chrome.sh 로 크롬을 먼저 띄워주세요.`
    )
  }

  try {
    const context = browser.contexts()[0] || (await browser.newContext())
    let page = context.pages().find((p) => p.url().includes('instagram.com'))
    if (!page) page = await context.newPage()
    if (!page.url().includes('instagram.com')) {
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
    }

    // sessionid 는 HttpOnly → document.cookie 로는 안 보임. context 쿠키로 확인(HttpOnly 포함).
    const cookies = await context.cookies('https://www.instagram.com')
    const loggedIn = cookies.some((c) => c.name === 'sessionid' && c.value)
    if (!loggedIn) {
      throw tagError(
        'NOT_LOGGED_IN',
        '그 크롬에서 instagram.com 에 로그인돼 있지 않습니다. (디버그 크롬 창에서 IG 로그인 후 다시 시도)'
      )
    }

    const pool = {} // dedup by code, keep max play
    const perTag = []
    for (const tag of tags) {
      const res = await scrapeTag(page, tag)
      if (res.error) {
        perTag.push({ tag, ok: false, status: res.error })
      } else {
        for (const m of res.rows) {
          if (!pool[m.code] || m.play > pool[m.code].play) pool[m.code] = { ...m, tag }
        }
        perTag.push({ tag, ok: true, count: res.rows.length })
      }
      onProgress({ tag, perTag })
      await page.waitForTimeout(800) // rate-limit 완화
    }

    let reels = Object.values(pool).filter((m) => m.type === 2 && m.play >= minPlay)
    reels.forEach((m) => { m.score = scoreReel(m) })
    reels.sort((a, b) => b.score - a.score)
    return { reels, perTag }
  } finally {
    // CDP 연결만 끊김 — 내 실제 크롬은 안 닫힘.
    await browser.close().catch(() => {})
  }
}
