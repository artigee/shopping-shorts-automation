// 아마존 검증 게이트 — 어댑터 구조. 지금은 '내 크롬으로 검색'(CDP), 나중에 PA-API로 교체 가능.
// 목표: 제품 후보 → 구매가능한 실제 리스팅(ASIN·가격·별점·이미지) 후보를 사람에게 제시.
import { chromium } from 'playwright-core'

const CDP_URL = process.env.CDP_URL || 'http://localhost:9222'

function tagError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

// 어필리에이트 링크 — ASIN 확정 시 어소시에이트 태그 부착(수익화 링크).
export function affiliateUrl(asin, tag, domain = 'www.amazon.com') {
  const base = `https://${domain}/dp/${asin}`
  return tag ? `${base}?tag=${encodeURIComponent(tag)}` : base
}

// URL/문자열에서 ASIN(10자리) 추출
export function extractAsin(s = '') {
  s = String(s).trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || s.match(/[?&]asin=([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

// 단일 제품 상세 가져오기 (직접 입력한 ASIN/URL용) — 디버그 크롬으로 제품 페이지 파싱
export async function amazonProduct(asin, { domain = 'www.amazon.com' } = {}) {
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 4000 })
  } catch {
    throw tagError('CHROME_NOT_FOUND', `디버그 크롬(${CDP_URL})에 못 붙음 — launch-chrome.sh 로 크롬을 먼저 띄워주세요.`)
  }
  const ctx = browser.contexts()[0] || (await browser.newContext())
  const page = await ctx.newPage()
  try {
    await page.goto(`https://${domain}/dp/${asin}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    const robot = await page.evaluate(() =>
      /api-services-support@amazon|robot check|Enter the characters you see|automated access/i.test(document.body ? document.body.innerText : '')
    )
    if (robot) throw tagError('ROBOT', '아마존 로봇 체크 — 크롬에서 직접 통과 후 재시도하세요.')
    const info = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)
      const title = (q('#productTitle') || {}).textContent?.trim() || ''
      const price = (q('.a-price .a-offscreen') || {}).textContent || ''
      const ratingTxt = (q('#acrPopover') && q('#acrPopover').getAttribute('title')) || (q('.a-icon-alt') || {}).textContent || ''
      const rating = parseFloat(ratingTxt) || null
      const reviewCount = ((q('#acrCustomerReviewText') || {}).textContent || '').replace(/[^\d,]/g, '')
      const image = ((q('#landingImage') || q('#imgTagWrapperId img')) || {}).src || ''
      // 실제 치수 — 상세표/디테일 불릿에서 "Dimensions" 행 추출 (스케일 정밀화용)
      let dimensions = ''
      const rows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li, table.a-keyvalue tr')
      for (const r of rows) {
        const txt = (r.textContent || '').replace(/\s+/g, ' ').trim()
        if (/\b(Product Dimensions|Item Dimensions|Package Dimensions|Unfolded|Dimensions)\b/i.test(txt) && /[\d.]+\s*[x×]\s*[\d.]+/i.test(txt)) {
          const m = txt.match(/([\d.,]+\s*[x×]\s*[\d.,]+(?:\s*[x×]\s*[\d.,]+)?\s*(?:inches|inch|in|cm|centimet\w*|mm|feet|ft)?)/i)
          if (m) { dimensions = m[1].replace(/\s+/g, ' ').trim(); if (/Product Dimensions|Item Dimensions/i.test(txt)) break }
        }
      }
      // "About this item" 특징 불릿 — 제품 메커니즘/소재/사용법 (이미지 정확도용)
      let features = ''
      const fbs = document.querySelectorAll('#feature-bullets li span.a-list-item, #feature-bullets li')
      const flist = [...fbs].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((x) => x && x.length > 5)
      features = [...new Set(flist)].slice(0, 8).join(' • ').slice(0, 1200)
      // 갤러리 이미지(여러 각도/상태) — 씬별 레퍼런스 선택용
      let images = []
      const thumbs = document.querySelectorAll('#altImages img, li.imageThumbnail img')
      images = [...new Set([...thumbs].map((im) => im.src).filter(Boolean).map((u) => u.replace(/\._[^.]*_\./, '.')))].slice(0, 8)
      if (image && !images.includes(image)) images.unshift(image)
      return { title, price, rating, reviewCount, image, dimensions, features, images }
    })
    return { asin, sponsored: false, ...info }
  } catch (e) {
    if (e.code) throw e
    if (/has been closed|Target page|Timeout|net::|ERR_/i.test(e.message || '')) {
      throw tagError('CHROME_UNSTABLE', '디버그 크롬 연결 불안정 — 크롬 재실행 후 재시도.')
    }
    throw e
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

export async function amazonSearch(query, { domain = 'www.amazon.com', max = 8 } = {}) {
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 4000 })
  } catch {
    throw tagError('CHROME_NOT_FOUND', `디버그 크롬(${CDP_URL})에 못 붙음 — scripts/launch-chrome.sh 로 크롬을 먼저 띄워주세요.`)
  }

  let page
  try {
    const ctx = browser.contexts()[0] || (await browser.newContext())
    page = await ctx.newPage()
    await page.goto(`https://${domain}/s?k=` + encodeURIComponent(query), {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    })

    const robot = await page.evaluate(() =>
      /api-services-support@amazon|robot check|Enter the characters you see|automated access/i.test(
        document.body ? document.body.innerText : ''
      )
    )
    if (robot) {
      throw tagError('ROBOT', '아마존 로봇 체크가 떴습니다 — 디버그 크롬 창에서 아마존을 한 번 직접 통과(로그인/캡차) 후 재시도하세요.')
    }

    const items = await page.evaluate((max) => {
      const out = []
      const nodes = document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')
      for (const n of nodes) {
        const asin = n.getAttribute('data-asin')
        if (!asin) continue
        const titleEl = n.querySelector('h2 span') || n.querySelector('h2 a span')
        const title = titleEl ? titleEl.textContent.trim() : ''
        if (!title) continue
        const price = (n.querySelector('.a-price .a-offscreen') || {}).textContent || ''
        const ratingTxt = (n.querySelector('.a-icon-alt') || {}).textContent || '' // "4.5 out of 5 stars"
        const rating = parseFloat(ratingTxt) || null
        // 리뷰수: 평점 아이콘 옆 숫자 링크 (best-effort)
        let reviewCount = ''
        const rcEl = n.querySelector('[aria-label$="ratings"], [aria-label$="rating"], .a-size-base.s-underline-text')
        if (rcEl) reviewCount = (rcEl.getAttribute('aria-label') || rcEl.textContent || '').replace(/[^\d,]/g, '')
        const img = (n.querySelector('img.s-image') || {}).src || ''
        const sponsored = !!n.querySelector('[aria-label="View Sponsored information or leave ad feedback"], .puis-sponsored-label-text')
        out.push({ asin, title, price, rating, reviewCount, image: img, sponsored })
        if (out.length >= max) break
      }
      return out
    }, max)

    return items
  } catch (e) {
    if (e.code) throw e // 이미 친절 에러(ROBOT 등)
    // playwright의 연결/페이지 종료류 → 크롬 재실행 안내
    if (/has been closed|Target page|Timeout|net::|ERR_/i.test(e.message || '')) {
      throw tagError('CHROME_UNSTABLE', '디버그 크롬 연결이 불안정합니다 — scripts/launch-chrome.sh 로 크롬을 다시 띄운 뒤 재시도하세요.')
    }
    throw e
  } finally {
    if (page) await page.close().catch(() => {})
    await browser.close().catch(() => {}) // CDP 연결만 종료, 실제 크롬은 유지
  }
}
