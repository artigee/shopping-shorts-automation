// IG 수집 — Playwright가 소유한 Chrome for Testing(공유 persistent context)의 페이지에서
// IG 내부 web_info API를 로그인 쿠키로 호출. (connectOverCDP는 Chrome 149에서 불안정 → 폐기)
import { scoreReel, scoreReelV2 } from './score.js'
import { getContext } from './browser.js'

const IG_APP_ID = '936619743392459'

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
  let context
  try {
    context = await getContext()
  } catch (e) {
    throw tagError(e.code || 'BROWSER_LAUNCH_FAILED', e.message)
  }

  {
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
        'Instagram login required — log into instagram.com in the debug Chrome window (launched by scripts/launch-chrome.sh), then retry.'
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
    reels.forEach((m) => { m.score = scoreReel(m); m.score2 = scoreReelV2(m) })
    reels.sort((a, b) => b.score2 - a.score2)   // v2(계정 대비 성과) 기준 랭킹
    return { reels, perTag }
    // 공유 persistent context는 닫지 않음 (다음 호출 재사용).
  }
}
