// 백엔드 진입점. Step 2: 수집(IG via 크롬 CDP) + 스냅샷/릴스 저장·조회.
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { db, dbStats, getSetting, setSetting, upsertHfElement, listHfElementsDb } from './db.js'
import { startJob, getJob, activeJob, listJobs } from './jobs.js'
import { collect } from './collect.js'
import { extractProducts, identifyReel } from './extract.js'
import { amazonSearch, amazonProduct, extractAsin, affiliateUrl } from './amazon.js'
import { analyzeReel } from './analyze.js'
import { matchProductByVision, simplerQuery } from './match.js'
import { generateOverall, generateScenes, generateSceneScript, translateVO, recommendPersonaHook, recommendPersona, recommendHook, generateImagePrompt, generateMotionPrompt, generateVoText } from './produce.js'
import { getPersonas, getPersona, getHooks, getVoStyles, getCameraMoves, getCameraMove, playbookReady, getContentModes } from './playbook.js'
import { genImage, genImageViaCLI, genVideoViaCLI, genAudioViaCLI, uploadRefViaCLI, buildImagePrompt, hfReady, cliReady, listHfElements, getHfElement, createHfElement, createHfElementMulti } from './higgsfield.js'
import { buildPreview } from './preview.js'
import { renderShort, probeDuration, FPS } from './remotion-render.js'

const ASSOC_TAG = process.env.AMAZON_ASSOC_TAG || ''
const AMZ_DOMAIN = process.env.AMAZON_DOMAIN || 'www.amazon.com'
// 생성 결과물(이미지·클립) 출력 폴더 — 나중에 쉽게 접근. 정적 서빙 /output.
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || 'output')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use('/output', express.static(OUTPUT_DIR))

// 니치별 해시태그 프리셋 (편집 가능 — 프론트에서 자유 수정)
// 발굴 리포트에서 실제로 상위권 나온 태그 + README 니치(K뷰티/일상용품) 기준.
const TAG_PRESETS = {
  amazon_finds: ['amazonfinds', 'amazonmusthaves', 'tiktokmademebuyit', 'founditonamazon', 'amazonfavorites', 'amazongadgets'],
  kbeauty: ['kbeauty', 'koreanskincare', 'glassskin', 'kbeautyfinds', 'koreanbeauty', 'skincareroutine'],
  home_daily: ['amazonhome', 'homefinds', 'homeorganization', 'kitchenfinds', 'cleantok', 'homehacks'],
  fashion: ['amazonfashion', 'amazonfashionfinds', 'amazonstyle', 'summerfashion', 'outfitinspo'],
  gadgets: ['amazongadgets', 'coolgadgets', 'tiktokmademebuyit', 'gadgetlover', 'techfinds'],
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), db: dbStats() })
})

app.get('/api/presets', (req, res) => res.json(TAG_PRESETS))

// 수집 실행 → 스냅샷 + 릴스 저장 → 결과 반환
app.post('/api/collect', async (req, res) => {
  const { tags, region = 'us', network = 'amazon', note = '', minPlay = 1000 } = req.body || {}
  if (!Array.isArray(tags) || !tags.length) {
    return res.status(400).json({ error: 'tags 배열이 필요합니다.' })
  }
  try {
    const { reels, perTag } = await collect({ tags, minPlay })

    const snapId = db
      .prepare(
        `INSERT INTO snapshots (source, region, network, tag_set, note, reel_count)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('ig', region, network, JSON.stringify(tags), note, reels.length).lastInsertRowid

    const insReel = db.prepare(
      `INSERT INTO reels
        (snapshot_id, code, url, thumbnail, username, followers, play, likes, comments, taken_at, is_paid, caption, tag, score, raw)
       VALUES
        (@snapshot_id, @code, @url, @thumbnail, @username, @followers, @play, @likes, @comments, @taken_at, @is_paid, @caption, @tag, @score, @raw)`
    )
    const tx = db.transaction((rows) => rows.forEach((r) => insReel.run(r)))
    tx(
      reels.map((m) => ({
        snapshot_id: snapId,
        code: m.code,
        url: m.url,
        thumbnail: m.thumb || null,
        username: m.user || null,
        followers: m.followers || null,
        play: m.play || 0,
        likes: m.like || 0,
        comments: m.comment || 0,
        taken_at: m.taken ? new Date(m.taken * 1000).toISOString() : null,
        is_paid: m.paid ? 1 : 0,
        caption: m.caption || '',
        tag: m.tag || null,
        score: m.score || 0,
        raw: JSON.stringify({ type: m.type, ptype: m.ptype }),
      }))
    )

    res.json({ snapshotId: Number(snapId), count: reels.length, perTag, reels })
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), code: e.code || null })
  }
})

app.get('/api/snapshots', (req, res) => {
  res.json(db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 50').all())
})

app.get('/api/snapshots/:id/reels', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM reels WHERE snapshot_id = ? ORDER BY score DESC').all(req.params.id)
  )
})

// ── Step 3: 제품 추출 · 확정 · 제품 카드 ────────────────────

// 스냅샷 릴스 → 제품 후보 추출 (저장 X, 사람 확인용)
app.post('/api/snapshots/:id/extract', async (req, res) => {
  const reels = db.prepare('SELECT code, caption, comments FROM reels WHERE snapshot_id = ?').all(req.params.id)
  if (!reels.length) return res.status(404).json({ error: '해당 스냅샷에 릴스가 없습니다.' })
  try {
    const result = await extractProducts(reels)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) })
  }
})

// 확인된 제품 후보 확정 → products / product_reels 업서트 + 집계 재계산
app.post('/api/products/commit', (req, res) => {
  const { snapshotId, products } = req.body || {}
  if (!snapshotId || !Array.isArray(products) || !products.length) {
    return res.status(400).json({ error: 'snapshotId 와 products 가 필요합니다.' })
  }
  const reelIdByCode = new Map(
    db.prepare('SELECT id, code FROM reels WHERE snapshot_id = ?').all(snapshotId).map((r) => [r.code, r.id])
  )
  const findProduct = db.prepare('SELECT id FROM products WHERE name = ?')
  const insProduct = db.prepare('INSERT INTO products (name, category, status) VALUES (?, ?, ?)')
  const linkReel = db.prepare('INSERT OR IGNORE INTO product_reels (product_id, reel_id) VALUES (?, ?)')
  const recompute = db.prepare(`
    UPDATE products SET
      reel_count = (SELECT COUNT(*) FROM product_reels WHERE product_id = products.id),
      total_comments = (SELECT COALESCE(SUM(r.comments),0) FROM product_reels pr JOIN reels r ON r.id = pr.reel_id WHERE pr.product_id = products.id),
      updated_at = datetime('now')
    WHERE id = ?`)
  // 점수: 구매의도(댓글 합) × 반복 보너스(여러 릴스/모음에 겹칠수록 가산)
  const rescore = db.prepare('UPDATE products SET score = total_comments * (1 + 0.25 * MAX(0, reel_count - 1)) WHERE id = ?')

  const committed = []
  const tx = db.transaction(() => {
    for (const p of products) {
      const name = (p.name || '').trim()
      if (!name) continue
      let pid = findProduct.get(name)?.id
      if (!pid) pid = Number(insProduct.run(name, p.category || '기타', 'candidate').lastInsertRowid)
      else if (p.category) db.prepare('UPDATE products SET category = ? WHERE id = ?').run(p.category, pid)
      for (const code of p.reelCodes || []) {
        const rid = reelIdByCode.get(code)
        if (rid) linkReel.run(pid, rid)
      }
      recompute.run(pid)
      rescore.run(pid)
      committed.push(pid)
    }
  })
  tx()
  res.json({ committed: committed.length })
})

// 제품 카드 목록 (구매의도순)
// ── ③ 제품 선택 — 제품 라이브러리 (아마존에서 고른 판매 제품들) ──
app.get('/api/products', (req, res) => {
  res.json(db.prepare(`SELECT * FROM products ORDER BY id DESC`).all())
})

// 아마존 제품을 라이브러리에 추가
app.post('/api/products', (req, res) => {
  const { asin, title, price, rating, reviewCount, image, category } = req.body || {}
  if (!asin) return res.status(400).json({ error: 'asin 필요' })
  const exists = db.prepare('SELECT id FROM products WHERE asin = ?').get(asin)
  if (exists) return res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(exists.id))
  const url = affiliateUrl(asin, ASSOC_TAG, AMZ_DOMAIN)
  const id = Number(db.prepare(`INSERT INTO products (name, category, asin, image_url, price, rating, review_count, amazon_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lib')`)
    .run(title || asin, category || null, asin, image || null, price || null, rating || null, reviewCount || null, url).lastInsertRowid)
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id))
})

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// 제품 상세 — 묶인 릴스 포함
app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!product) return res.status(404).json({ error: '없는 제품' })
  const reels = db
    .prepare(
      `SELECT r.* FROM reels r JOIN product_reels pr ON pr.reel_id = r.id
       WHERE pr.product_id = ? ORDER BY r.comments DESC`
    )
    .all(req.params.id)
  res.json({ product, reels })
})

// ── 릴스우선 모델: 최신 스냅샷 릴스 브라우징 + 단일 릴스 제품 식별 ──

// 최신 스냅샷의 릴스 (점수순) — ① 발굴 탭 기본 뷰
app.get('/api/reels/latest', (req, res) => {
  const snap = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get()
  if (!snap) return res.json({ snapshot: null, reels: [] })
  const reels = db.prepare('SELECT * FROM reels WHERE snapshot_id = ? ORDER BY score DESC').all(snap.id)
  res.json({ snapshot: snap, reels })
})

// 단일 릴스 제품 식별 (LLM, 영어 검색어 포함) — 저장 X
app.post('/api/reels/:id/identify', async (req, res) => {
  const reel = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id)
  if (!reel) return res.status(404).json({ error: '없는 릴스' })
  try {
    res.json(await identifyReel(reel))
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) })
  }
})

// 테마(제작 대상)의 대표 후보를 products 행에 미러링(카드 표시용) + 상태 동기화
function syncTheme(pid) {
  const cur = db.prepare('SELECT status FROM products WHERE id = ?').get(pid)
  const n = db.prepare('SELECT COUNT(*) n FROM candidates WHERE product_id = ?').get(pid).n
  const prim = db.prepare('SELECT * FROM candidates WHERE product_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1').get(pid)
  const status = cur && cur.status === 'rejected' ? 'rejected' : n > 0 ? 'verified' : 'candidate'
  db.prepare(`UPDATE products SET status = ?, asin = ?, image_url = ?, price = ?, rating = ?, match_type = ?, amazon_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, prim?.asin || null, prim?.image_url || null, prim?.price || null, prim?.rating || null, prim?.match_type || null, prim?.amazon_url || null, pid)
}

function addCandidate(pid, a) {
  const url = affiliateUrl(a.asin, ASSOC_TAG, AMZ_DOMAIN)
  const isFirst = db.prepare('SELECT COUNT(*) n FROM candidates WHERE product_id = ?').get(pid).n === 0
  const id = Number(db.prepare(`INSERT INTO candidates (product_id, asin, title, price, rating, review_count, image_url, amazon_url, match_type, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(pid, a.asin, a.title || null, a.price || null, a.rating || null, a.reviewCount || null, a.image || a.imageUrl || null, url, a.matchType || 'related', isFirst ? 1 : 0).lastInsertRowid)
  syncTheme(pid)
  return db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
}

// 릴스 → 제작 대상(테마) 생성. amazon 주면 첫 후보로 함께 등록.
app.post('/api/reels/:id/to-product', (req, res) => {
  const reel = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id)
  if (!reel) return res.status(404).json({ error: '없는 릴스' })
  const { name, category = '기타', searchQuery = '', amazon } = req.body || {}
  if (!name || !name.trim()) return res.status(400).json({ error: 'name 이 필요합니다.' })

  const pid = Number(
    db.prepare('INSERT INTO products (name, category, search_query, status) VALUES (?, ?, ?, ?)')
      .run(name.trim(), category, searchQuery || null, 'candidate').lastInsertRowid
  )
  db.prepare('INSERT OR IGNORE INTO product_reels (product_id, reel_id) VALUES (?, ?)').run(pid, reel.id)
  db.prepare(`UPDATE products SET reel_count = 1,
      total_comments = (SELECT comments FROM reels WHERE id = ?),
      score = (SELECT comments FROM reels WHERE id = ?) WHERE id = ?`).run(reel.id, reel.id, pid)
  if (amazon && amazon.asin) addCandidate(pid, amazon)
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(pid))
})

// ── 후보 제품 (테마에 원본+동급 N개) ──
app.get('/api/products/:id/candidates', (req, res) => {
  res.json(db.prepare('SELECT * FROM candidates WHERE product_id = ? ORDER BY is_primary DESC, id ASC').all(req.params.id))
})
app.post('/api/products/:id/candidates', (req, res) => {
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: '없는 제작 대상' })
  if (!req.body || !req.body.asin) return res.status(400).json({ error: 'asin 필요' })
  res.json(addCandidate(p.id, req.body))
})
app.post('/api/candidates/:id/primary', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 후보' })
  db.prepare('UPDATE candidates SET is_primary = 0 WHERE product_id = ?').run(c.product_id)
  db.prepare('UPDATE candidates SET is_primary = 1 WHERE id = ?').run(c.id)
  syncTheme(c.product_id)
  res.json({ ok: true })
})
app.post('/api/candidates/:id/match-type', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 후보' })
  db.prepare('UPDATE candidates SET match_type = ? WHERE id = ?').run((req.body && req.body.matchType) || 'related', c.id)
  syncTheme(c.product_id)
  res.json({ ok: true })
})
app.delete('/api/candidates/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id)
  if (c) {
    const wasPrimary = c.is_primary
    db.prepare('DELETE FROM candidates WHERE id = ?').run(c.id)
    if (wasPrimary) {
      const r = db.prepare('SELECT id FROM candidates WHERE product_id = ? ORDER BY id ASC LIMIT 1').get(c.product_id)
      if (r) db.prepare('UPDATE candidates SET is_primary = 1 WHERE id = ?').run(r.id)
    }
    syncTheme(c.product_id)
  }
  res.json({ ok: true })
})

// 독립 아마존 검색/조회 (카드 없이 식별 단계에서 사용)
app.get('/api/amazon/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim()
  if (!q) return res.status(400).json({ error: '검색어 없음' })
  try {
    let items = await amazonSearch(q, { domain: AMZ_DOMAIN }), usedQuery = q
    if (!items.length) { const sq = simplerQuery(q); if (sq && sq.toLowerCase() !== q.toLowerCase()) { const r2 = await amazonSearch(sq, { domain: AMZ_DOMAIN }); if (r2.length) { items = r2; usedQuery = sq } } }   // 0건 → 단순화 재시도
    res.json({ query: usedQuery, items })
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), code: e.code || null })
  }
})

app.post('/api/amazon/fetch', async (req, res) => {
  const input = ((req.body && req.body.input) || '').trim()
  let asin = extractAsin(input)
  if (!asin && /^https?:\/\//i.test(input)) {
    try { asin = extractAsin((await fetch(input, { redirect: 'follow' })).url) } catch { /* 무시 */ }
  }
  if (!asin) return res.status(400).json({ error: 'URL/ASIN에서 ASIN(10자리)을 못 찾음.' })
  try {
    res.json({ item: await amazonProduct(asin, { domain: AMZ_DOMAIN }), warning: null })
  } catch (e) {
    res.json({ item: { asin, title: '', price: '', rating: null, reviewCount: '', image: '', sponsored: false }, warning: `상세 못 가져옴 (${e.code || e.message}) — ASIN만 확정 가능` })
  }
})

// ── Step 4: 아마존 검증 게이트 ──────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json({ assocTag: ASSOC_TAG, domain: AMZ_DOMAIN, hasTag: !!ASSOC_TAG, hasLLMKey: !!process.env.ANTHROPIC_API_KEY })
})

// 생성 언어/지역 (글로벌) — 분석·스크립트·VO가 모두 이 언어로 생성됨
const GEN_LANG_DEFAULT = 'English (US, American audience)'
const genLang = () => getSetting('genLang', GEN_LANG_DEFAULT) || GEN_LANG_DEFAULT
app.get('/api/gen-lang', (req, res) => res.json({ lang: genLang() }))
app.put('/api/gen-lang', (req, res) => { setSetting('genLang', (req.body && req.body.lang) || GEN_LANG_DEFAULT); res.json({ lang: genLang() }) })

// shorts-playbook 라이브러리 — 페르소나·훅 (폴더가 소스). UI 드롭다운용.
app.get('/api/personas', (req, res) => res.json({ ready: playbookReady(), personas: getPersonas() }))
app.get('/api/hooks', (req, res) => res.json({ ready: playbookReady(), hooks: getHooks() }))
app.get('/api/vo-styles', (req, res) => res.json({ ready: playbookReady(), voStyles: getVoStyles() }))
app.get('/api/camera-moves', (req, res) => res.json({ moves: getCameraMoves() }))

// 제품 → 아마존 검색 후보 (저장 X, 사람이 고름)
app.get('/api/products/:id/amazon-search', async (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: '없는 제품' })
  const q = (req.query.q || p.name || '').toString().trim()
  if (!q) return res.status(400).json({ error: '검색어 없음' })
  try {
    const items = await amazonSearch(q, { domain: AMZ_DOMAIN })
    res.json({ query: q, domain: AMZ_DOMAIN, items })
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), code: e.code || null })
  }
})

// 직접 입력(URL/ASIN) → 제품 상세 가져오기 (저장 X, 사람이 확인 후 verify)
app.post('/api/products/:id/fetch-amazon', async (req, res) => {
  const input = ((req.body && req.body.input) || '').trim()
  let asin = extractAsin(input)
  // 단축링크(a.co / amzn.to)면 리다이렉트 따라가 최종 URL에서 ASIN 추출
  if (!asin && /^https?:\/\//i.test(input)) {
    try {
      const r = await fetch(input, { redirect: 'follow' })
      asin = extractAsin(r.url)
    } catch { /* 무시 */ }
  }
  if (!asin) return res.status(400).json({ error: 'URL/ASIN에서 ASIN(10자리)을 못 찾음. 예: B0DJ733JS1 또는 amazon.com/dp/B0DJ733JS1' })
  try {
    const item = await amazonProduct(asin, { domain: AMZ_DOMAIN })
    res.json({ item, warning: null })
  } catch (e) {
    // 크롬 다운/로봇체크 등 → ASIN만이라도 반환해 잠글 수 있게
    res.json({ item: { asin, title: '', price: '', rating: null, reviewCount: '', image: '', sponsored: false }, warning: `상세 정보는 못 가져옴 (${e.code || e.message}) — ASIN만 확정 가능합니다.` })
  }
})

// 후보 1개 확정 → ASIN·이미지·가격 저장 + 어필리에이트 링크 + status=verified
app.post('/api/products/:id/verify', (req, res) => {
  const { asin, title, price, rating, reviewCount, imageUrl, matchType } = req.body || {}
  if (!asin) return res.status(400).json({ error: 'asin 이 필요합니다.' })
  const url = affiliateUrl(asin, ASSOC_TAG, AMZ_DOMAIN)
  db.prepare(
    `UPDATE products SET
       asin = ?, amazon_url = ?, image_url = ?, price = ?, rating = ?, review_count = ?,
       match_type = ?, note = ?, status = 'verified', verified_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(asin, url, imageUrl || null, price || null, rating || null, reviewCount || null, matchType || 'related', title ? '아마존: ' + title : null, req.params.id)
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id))
})

// 원본/동급 토글 (검증 후 수정)
app.post('/api/products/:id/match-type', (req, res) => {
  const { matchType } = req.body || {}
  db.prepare(`UPDATE products SET match_type = ?, updated_at = datetime('now') WHERE id = ?`).run(matchType || null, req.params.id)
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id))
})

// 아마존에 없음 → 탈락
app.post('/api/products/:id/reject', (req, res) => {
  db.prepare(`UPDATE products SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

// 후보로 되돌리기 (실수 복구용)
app.post('/api/products/:id/reset', (req, res) => {
  db.prepare(`UPDATE products SET status = 'candidate', updated_at = datetime('now') WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

// ── 릴스 영상 분석 (구조·훅·씬스크립트·에셋) ──
app.post('/api/products/:id/analyze', async (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: '없는 제품' })
  const reel = db
    .prepare(`SELECT r.* FROM reels r JOIN product_reels pr ON pr.reel_id = r.id
              WHERE pr.product_id = ? ORDER BY r.comments DESC LIMIT 1`)
    .get(req.params.id)
  if (!reel) return res.status(404).json({ error: '연결된 릴스가 없습니다.' })
  try {
    const analysis = await analyzeReel({ code: reel.code, url: reel.url, caption: reel.caption, productName: p.name, lang: genLang() })
    db.prepare(`UPDATE products SET analysis = ?, analyzed_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(analysis), req.params.id)
    res.json(analysis)
  } catch (e) {
    res.status(500).json({ error: e.message || String(e), code: e.code || null })
  }
})

// ── ② 릴스 분석 (재사용 구조 라이브러리) ──────────────────────

// 릴스 → 분석 자산 생성 (릴스 스냅샷 함께 저장)
app.post('/api/reels/:id/analysis', (req, res) => {
  const r = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id)
  if (!r) return res.status(404).json({ error: '없는 릴스' })
  const title = (req.body && req.body.title) || (r.caption ? r.caption.replace(/\s+/g, ' ').slice(0, 28) : '@' + r.username)
  const id = Number(db.prepare(`INSERT INTO analyses
      (title, category, reel_code, reel_url, reel_thumbnail, reel_username, reel_caption, reel_comments, reel_play, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discover')`)
    .run(title, (req.body && req.body.category) || '기타', r.code, r.url, r.thumbnail, r.username, r.caption, r.comments, r.play).lastInsertRowid)
  res.json(db.prepare('SELECT * FROM analyses WHERE id = ?').get(id))
})

app.get('/api/analyses', (req, res) => res.json(db.prepare('SELECT * FROM analyses ORDER BY id DESC').all()))
app.get('/api/analyses/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '없는 분석' })
  res.json(a)
})
app.put('/api/analyses/:id', (req, res) => {
  const { title, category } = req.body || {}
  db.prepare('UPDATE analyses SET title = COALESCE(?, title), category = COALESCE(?, category) WHERE id = ?').run(title ?? null, category ?? null, req.params.id)
  res.json(db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id))
})
app.delete('/api/analyses/:id', (req, res) => { db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.id); res.json({ ok: true }) })

// 영상 분석 실행 (릴스 스냅샷으로)
// Reel Analysis 에이전트 — 요청과 분리된 잡으로 실행. 즉시 { jobId } 반환, UI가 상태 폴링.
app.post('/api/analyses/:id/analyze', (req, res) => {
  const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '없는 분석' })
  const existing = activeJob('analyses', a.id)
  if (existing) return res.json({ jobId: existing.id, already: true })
  const job = startJob({ agent: 'analyze', refType: 'analyses', refId: a.id, message: 'queued…' }, async (progress) => {
    progress('릴스 영상 받는 중…', 15)
    const result = await analyzeReel({ code: a.reel_code, url: a.reel_url, caption: a.reel_caption, productName: a.title, lang: genLang(), onProgress: (m, pct) => progress(m, pct) })
    // Analyze가 제품까지 한 번에: 식별 → 비전으로 "생김새" 매칭 (best-effort)
    progress('제품 매칭 중…', 70)
    let product = a.product ? JSON.parse(a.product) : null   // 직접 입력으로 이미 제품이 있으면 그걸 사용
    let candidates = a.candidates ? JSON.parse(a.candidates) : []
    let matchMeta = a.match_meta ? JSON.parse(a.match_meta) : null
    if (!product) {   // 수동 제품이 없을 때만 비전 매칭
      try {
        const id = await identifyReel({ code: a.reel_code, url: a.reel_url, username: a.reel_username, caption: a.reel_caption })
        const q = id?.amazonQuery || ''
        if (q) {
          const mr = await matchProductByVision({ code: a.reel_code, query: q, domain: AMZ_DOMAIN, assocTag: ASSOC_TAG })
          product = mr.product; candidates = mr.candidates || []; matchMeta = { ...(mr.match || {}), query: mr.query }
        } else matchMeta = { asin: null, confidence: 0, reason: 'product not identifiable from reel' }
      } catch (e) { matchMeta = { asin: null, confidence: 0, reason: 'match failed: ' + (e.message || '').slice(0, 100) } }
    } else matchMeta = matchMeta || { asin: product.asin || null, confidence: 1, reason: 'manually provided product' }
    progress('저장 중…', 95)
    db.prepare(`UPDATE analyses SET analysis = ?, product = ?, candidates = ?, match_meta = ?, analyzed_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(result), product ? JSON.stringify(product) : null, JSON.stringify(candidates), matchMeta ? JSON.stringify(matchMeta) : null, a.id)
    return { ok: true }
  })
  res.json({ jobId: job.id })
})

// 잡 상태 — UI가 폴링 / 재접속. GET /api/jobs/:id, GET /api/jobs?ref=analyses:12&active=1
app.get('/api/jobs/:id', (req, res) => { const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'no job' }); res.json(job) })
app.get('/api/jobs', (req, res) => {
  const { ref, status, active } = req.query
  let refType, refId
  if (ref) { const [t, i] = String(ref).split(':'); refType = t; refId = i }
  if (active && refType) return res.json({ job: activeJob(refType, refId, req.query.agent) || null })
  res.json({ jobs: listJobs({ status, refType, refId }) })
})

// 직접 추가 — 발굴(Discover) 없이 릴스 URL + (선택)제품 링크로 분석 자산 생성. 릴스를 직접 가져와 리믹스.
app.post('/api/analyses/from-url', async (req, res) => {
  const { reelUrl, productUrl } = req.body || {}
  if (!reelUrl) return res.status(400).json({ error: '릴스 URL이 필요합니다.' })
  const m = String(reelUrl).match(/instagram\.com\/(?:reels?|p)\/([A-Za-z0-9_-]+)/i)
  const code = m ? m[1] : null
  if (!code) return res.status(400).json({ error: '인스타그램 릴스 URL이 아닙니다 (예: instagram.com/reel/XXXX/).' })
  const url = `https://www.instagram.com/reel/${code}/`
  // (선택) 제품 링크 → 현재 아마존만 풀 해상도. 그 외 링크는 수동 제품으로 저장(나중에 ③에서 보강).
  let product = null
  const pu = (productUrl || '').trim()
  if (pu) {
    const asin = extractAsin(pu)
    if (asin) {
      try {
        const d = await amazonProduct(asin, { domain: AMZ_DOMAIN })
        product = { source: 'original', asin, title: d?.title || `Amazon ${asin}`, price: d?.price || null, rating: d?.rating || null, reviewCount: d?.reviewCount || null, image: d?.image || (d?.images || [])[0] || null, images: d?.images || [], dimensions: d?.dimensions || '', features: d?.features || '', amazon_url: affiliateUrl(asin, ASSOC_TAG, AMZ_DOMAIN) }
      } catch { product = { source: 'original', asin, title: `Amazon ${asin}`, amazon_url: affiliateUrl(asin, ASSOC_TAG, AMZ_DOMAIN) } }
    } else {
      product = { source: 'original', title: pu.replace(/^https?:\/\//, '').slice(0, 60), manualUrl: pu }   // 비아마존 링크 (TikTok Shop/올리브영/쿠팡 등) — 우선 수동 보관
    }
  }
  const title = (product?.title || `Reel ${code}`).slice(0, 60)
  const id = Number(db.prepare(`INSERT INTO analyses (title, reel_code, reel_url, product, source) VALUES (?, ?, ?, ?, 'url')`)
    .run(title, code, url, product ? JSON.stringify(product) : null).lastInsertRowid)
  res.json(db.prepare('SELECT * FROM analyses WHERE id = ?').get(id))
})

// ── ④ 콘텐츠 제작 (분석 × 제품 라이브러리) ─────────────────────

app.get('/api/contents', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, a.title AS analysis_title, a.reel_thumbnail, a.reel_username, (a.analysis IS NOT NULL) AS has_analysis, a.source AS origin,
           json_extract(c.product, '$.title') AS product_name, json_extract(c.product, '$.image') AS product_image
    FROM contents c LEFT JOIN analyses a ON a.id = c.analysis_id
    ORDER BY c.id DESC`).all())
})

// 콘텐츠 생성 (분석에서 시작 — 제품은 콘텐츠 안에서 선택). 제목: 매칭된 제품명 > 릴스 제목 (영어, 한국어 접미사 없음)
app.post('/api/contents', (req, res) => {
  const { analysisId, title } = req.body || {}
  const a = analysisId ? db.prepare('SELECT title, product FROM analyses WHERE id = ?').get(analysisId) : null
  let autoTitle = 'New content'
  if (a) {
    let prodTitle = null
    try { prodTitle = a.product ? JSON.parse(a.product)?.title : null } catch {}
    autoTitle = (prodTitle || a.title || 'New content').slice(0, 80)
  }
  const id = Number(db.prepare('INSERT INTO contents (analysis_id, title) VALUES (?, ?)')
    .run(analysisId || null, title || autoTitle).lastInsertRowid)
  res.json(db.prepare('SELECT * FROM contents WHERE id = ?').get(id))
})

app.get('/api/contents/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const analysis = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const product = c.product ? JSON.parse(c.product) : null
  res.json({ content: c, analysis, product })
})

app.delete('/api/contents/:id', (req, res) => { db.prepare('DELETE FROM contents WHERE id = ?').run(req.params.id); res.json({ ok: true }) })

// 콘텐츠 복제 — 전체 파이프라인(분석·제품·씬·overall·레퍼런스 등) 복사해 변형 버전 시작
app.post('/api/contents/:id/duplicate', (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const cols = Object.keys(c).filter((k) => !['id', 'created_at', 'updated_at'].includes(k))
  const vals = cols.map((k) => k === 'title' ? ((c.title || 'untitled').slice(0, 72) + ' (copy)') : c[k])
  const id = Number(db.prepare(`INSERT INTO contents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid)
  res.json(db.prepare('SELECT * FROM contents WHERE id = ?').get(id))
})

app.post('/api/contents/:id/analysis', (req, res) => {
  db.prepare(`UPDATE contents SET analysis_id = ?, updated_at = datetime('now') WHERE id = ?`).run((req.body && req.body.analysisId) || null, req.params.id)
  res.json({ ok: true })
})

// undo/redo — 스냅샷(콘텐츠의 되돌릴 수 있는 전체 상태)을 그대로 되돌린다(정확 복원, 병합 없음).
app.post('/api/contents/:id/restore', (req, res) => {
  const b = req.body || {}
  const js = (v) => (v != null ? JSON.stringify(v) : null)
  db.prepare(`UPDATE contents SET analysis_id = ?, overall = ?, scenes = ?, persona = ?, hook = ?, vo_style = ?, vo_style_note = ?, style = ?, direction = ?, shot_count = ?, character_ref = ?, ref_lib = ?, product = ?, node_meta = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(b.analysisId || null, js(b.overall), js(b.scenes), b.persona ?? null, b.hook ?? null, b.voStyle ?? null, b.voStyleNote ?? null, b.style ?? null, b.direction ?? null, b.shotCount ?? null, b.characterRef ?? null, js(b.refLib), js(b.product), js(b.nodeMeta), req.params.id)
  res.json({ ok: true })
})

// 전 씬 공통 이미지 스타일/지시 (예: "여성 손, 한국 가정집, 밝은 자연광")
app.post('/api/contents/:id/style', (req, res) => {
  db.prepare(`UPDATE contents SET style = ?, updated_at = datetime('now') WHERE id = ?`).run((req.body && req.body.style) || '', req.params.id)
  res.json({ ok: true })
})

// 제품 레퍼런스 이미지 추가/삭제 (공개 https URL). first=true면 맨 앞(첫 레퍼런스).
app.post('/api/contents/:id/product-ref', (req, res) => {
  const { url, first, remove } = req.body || {}
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c || !c.product) return res.status(400).json({ error: '제품을 먼저 선택하세요.' })
  if (!url) return res.status(400).json({ error: 'url 필요' })
  if (!remove && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: '공개 https 이미지 URL이 필요합니다.' })  // 추가만 https 필수 (삭제는 업로드 ref 포함 모두 가능)
  const p = JSON.parse(c.product)
  p.images = (p.images || []).filter((u) => u !== url)
  if (!remove) { if (first) { p.images.unshift(url); p.image = url } else p.images.push(url) }
  if (remove && p.image === url) p.image = p.images[0] || null   // 대표 이미지 삭제 시 다음 것으로
  db.prepare(`UPDATE contents SET product = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(p), c.id)
  res.json(p)
})

// 로컬 파일 레퍼런스 저장만 (base64 → 디스크). Higgsfield 업로드는 첫 '사용' 시로 지연(lazy).
// 즉시 응답 → 드롭이 바로 썸네일로 뜬다. 반환 ref = 로컬 경로(hfmedia: 접두어 없음 = 아직 미업로드).
app.post('/api/contents/:id/ref-save', (req, res) => {
  const { filename, contentType, dataB64 } = req.body || {}
  const c = db.prepare('SELECT id FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  if (!dataB64) return res.status(400).json({ error: '파일 데이터 없음' })
  try {
    const buffer = Buffer.from(dataB64.replace(/^data:[^;]+;base64,/, ''), 'base64')
    const dir = path.join(OUTPUT_DIR, `content-${c.id}`); fs.mkdirSync(dir, { recursive: true })
    const ext = ((contentType || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
    const fname = `uref-${Date.now().toString().slice(-7)}.${ext}`
    fs.writeFileSync(path.join(dir, fname), buffer)
    res.json({ ref: `/output/content-${c.id}/${fname}` })
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 로컬 파일 레퍼런스 업로드 (base64) → Higgsfield 업로드 → product.images 맨 앞(첫 레퍼런스)
app.post('/api/contents/:id/ref-upload', async (req, res) => {
  const { filename, contentType, dataB64 } = req.body || {}
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c || !c.product) return res.status(400).json({ error: '제품을 먼저 선택하세요.' })
  if (!dataB64) return res.status(400).json({ error: '파일 데이터 없음' })
  try {
    const buffer = Buffer.from(dataB64.replace(/^data:[^;]+;base64,/, ''), 'base64')
    const mediaRef = await uploadRefViaCLI({ buffer, filename: filename || 'ref.png', contentType: contentType || 'image/png' }) // 'hfmedia:<id>'
    // 표시용 로컬 사본 저장 → ref = "hfmedia:<id>|/output/...png" (생성은 media_id, 표시는 로컬)
    const dir = path.join(OUTPUT_DIR, `content-${c.id}`); fs.mkdirSync(dir, { recursive: true })
    const ext = ((contentType || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
    const fname = `uref-${Date.now().toString().slice(-7)}.${ext}`
    fs.writeFileSync(path.join(dir, fname), buffer)
    const ref = `${mediaRef}|/output/content-${c.id}/${fname}`
    const p = JSON.parse(c.product)
    p.images = [ref, ...(p.images || [])]
    db.prepare(`UPDATE contents SET product = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(p), c.id)
    res.json(p)
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 레퍼런스 입력(url 또는 base64 파일) → ref 문자열 (url 또는 "hfmedia:<id>|/output/...")
async function processRefInput(contentId, { url, dataB64, filename, contentType }) {
  if (url && /^https?:\/\//i.test(url)) return url
  if (dataB64) {
    const buffer = Buffer.from(dataB64.replace(/^data:[^;]+;base64,/, ''), 'base64')
    const mediaRef = await uploadRefViaCLI({ buffer, filename: filename || 'ref.png', contentType: contentType || 'image/png' })
    const dir = path.join(OUTPUT_DIR, `content-${contentId}`); fs.mkdirSync(dir, { recursive: true })
    const ext = ((contentType || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
    const fname = `cref-${Date.now().toString().slice(-7)}.${ext}`
    fs.writeFileSync(path.join(dir, fname), buffer)
    return `${mediaRef}|/output/content-${contentId}/${fname}`
  }
  return null
}

// 캐릭터(인물) 레퍼런스 — 콘텐츠 전체 씬에 동일 인물 적용
app.post('/api/contents/:id/character-ref', async (req, res) => {
  const c = db.prepare('SELECT id FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  try {
    if (req.body && req.body.remove) { db.prepare(`UPDATE contents SET character_ref = NULL, updated_at = datetime('now') WHERE id = ?`).run(c.id); return res.json({ character_ref: null }) }
    const ref = await processRefInput(c.id, req.body || {})
    if (!ref) return res.status(400).json({ error: '공개 https URL 또는 파일이 필요합니다.' })
    db.prepare(`UPDATE contents SET character_ref = ?, updated_at = datetime('now') WHERE id = ?`).run(ref, c.id)
    res.json({ character_ref: ref })
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬 환경/무드(공간) 레퍼런스 — 씬별
app.post('/api/contents/:id/scene/:index/env-ref', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c); const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  try {
    if (req.body && req.body.remove) { delete scenes[i].envRef }
    else { const ref = await processRefInput(c.id, req.body || {}); if (!ref) return res.status(400).json({ error: '공개 https URL 또는 파일이 필요합니다.' }); scenes[i] = { ...scenes[i], envRef: ref } }
    db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
    res.json({ scene: scenes[i] })
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 연출 지시 (훅·샷 스타일) — 전체/씬 스크립트 생성에 반영
app.post('/api/contents/:id/direction', (req, res) => {
  db.prepare(`UPDATE contents SET direction = ?, updated_at = datetime('now') WHERE id = ?`).run((req.body && req.body.direction) || '', req.params.id)
  res.json({ ok: true })
})

// VO 페르소나 (화자) — 전체/씬 스크립트 생성에 반영 (playbook 키 또는 자유텍스트)
app.post('/api/contents/:id/shot-count', (req, res) => {
  const n = Number(req.body && req.body.shotCount)
  const v = (Number.isInteger(n) && n >= 3 && n <= 12) ? n : null
  db.prepare(`UPDATE contents SET shot_count = ?, updated_at = datetime('now') WHERE id = ?`).run(v, req.params.id)
  res.json({ shot_count: v })
})
app.post('/api/contents/:id/persona', (req, res) => {
  db.prepare(`UPDATE contents SET persona = ?, updated_at = datetime('now') WHERE id = ?`).run((req.body && req.body.persona) || '', req.params.id)
  res.json({ ok: true })
})

// 훅/스토리텔링 셰이프 (playbook hooks.yaml 키) — 스크립트 생성에 반영
app.post('/api/contents/:id/hook', (req, res) => {
  db.prepare(`UPDATE contents SET hook = ?, updated_at = datetime('now') WHERE id = ?`).run((req.body && req.body.hook) || '', req.params.id)
  res.json({ ok: true })
})

// VO 스피킹 스타일 (프리셋 키 + 자유 텍스트 refine) — 페르소나 위에 얹혀 모든 VO 생성에 반영
app.post('/api/contents/:id/vo-style', (req, res) => {
  const b = req.body || {}
  db.prepare(`UPDATE contents SET vo_style = ?, vo_style_note = ?, updated_at = datetime('now') WHERE id = ?`).run(b.voStyle || '', b.voStyleNote || '', req.params.id)
  res.json({ ok: true })
})

// 추천 — 제품 + 릴스 분석을 보고 가장 잘 맞는 persona + hook 제안 (이유 포함)
app.post('/api/contents/:id/recommend', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const a = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const product = c.product ? JSON.parse(c.product) : null
  const analysis = a?.analysis ? JSON.parse(a.analysis) : null
  try {
    const rec = await recommendPersonaHook({ productName: product?.title || a?.title, product, analysis, personas: getPersonas(), hooks: getHooks() })
    res.json(rec)
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})
// 페르소나만 추천 (persona 노드 re-run)
app.post('/api/contents/:id/recommend-persona', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const a = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const product = c.product ? JSON.parse(c.product) : null
  const analysis = a?.analysis ? JSON.parse(a.analysis) : null
  try { res.json(await recommendPersona({ productName: product?.title || a?.title, product, analysis, personas: getPersonas(), voStyles: getVoStyles(), guidance: req.body && req.body.guidance })) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})
// 훅만 추천 (hook 노드 re-run)
app.post('/api/contents/:id/recommend-hook', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const a = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const analysis = a?.analysis ? JSON.parse(a.analysis) : null
  try { res.json(await recommendHook({ analysis, hooks: getHooks(), guidance: req.body && req.body.guidance })) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 제품 선택 — 아마존에서 고른 제품을 콘텐츠에 적용 (asin 없으면 해제). asin이면 실제 치수도 자동 조회.
app.post('/api/contents/:id/product', async (req, res) => {
  const { asin, title, price, rating, reviewCount, image, original, keepOriginal, setProduct } = req.body || {}
  let product
  if (setProduct && typeof setProduct === 'object') {
    // 이미 만들어진 제품 객체(②에서 비전 매칭한 것)를 그대로 저장
    product = setProduct
    db.prepare(`UPDATE contents SET product = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(product), req.params.id)
    return res.json(product)
  }
  if (asin) {
    // 아마존 제품 — 상세페이지에서 치수·특징·갤러리 자동 조회 (정확도용; 크롬 없으면 빈값)
    let dimensions = '', features = '', images = []
    try { const d = await amazonProduct(asin); dimensions = d?.dimensions || ''; features = d?.features || ''; images = d?.images || [] } catch {}
    // keepOriginal = 원본 제품을 유지한 채 아마존 링크/데이터만 붙임 (교체 아님)
    const src = keepOriginal ? 'original' : 'amazon'
    product = { source: src, asin, title: title || null, price: price || null, rating: rating || null, reviewCount: reviewCount || null, image: image || (images[0] || null), dimensions, features, images, amazon_url: affiliateUrl(asin, ASSOC_TAG, AMZ_DOMAIN) }
  } else if (original) {
    // 기본 = 원본 제품 (릴스에서 식별, 아마존 링크 없음)
    product = { source: 'original', title: title || null }
  } else {
    db.prepare(`UPDATE contents SET product = NULL, updated_at = datetime('now') WHERE id = ?`).run(req.params.id)
    return res.json({ ok: true })
  }
  db.prepare(`UPDATE contents SET product = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(product), req.params.id)
  res.json(product)
})

// 기본 제품 추천 — 분석된 릴스에서 원본 제품의 영어 검색어 (기본값=원본)
app.post('/api/contents/:id/suggest', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c || !c.analysis_id) return res.json({ product: null, candidates: [], match: null })
  const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id)
  // ② 분석 단계에서 비전으로 매칭해둔 제품/후보를 그대로 사용 (재검색 X)
  res.json({
    product: a?.product ? JSON.parse(a.product) : null,
    candidates: a?.candidates ? JSON.parse(a.candidates) : [],
    match: a?.match_meta ? JSON.parse(a.match_meta) : null,
  })
})

// 콘텐츠 + 분석/제품을 모아오는 헬퍼 (분석 완료 검증)
function loadForGen(id) {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(id)
  if (!c) return { err: '없는 콘텐츠' }
  const a = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id = ?').get(c.analysis_id) : null
  if (!a || !a.analysis) return { err: '먼저 ② 릴스 분석에서 🎬 영상 분석을 실행하세요.' }
  return { c, a, p: c.product ? JSON.parse(c.product) : null }
}

// ③ 전체 스크립트 생성 (구조만 빌려 선택 제품으로 새로 작성). body.guidance 있으면 현재 버전을 그 지시대로 수정.
// Overall Script 에이전트 — 파이프라인의 엔진. 잡으로 실행: 즉시 { jobId }, 뒤에서 생성·저장.
app.post('/api/contents/:id/overall', (req, res) => {
  const { c, a, p, err } = loadForGen(req.params.id)
  if (err) return res.status(c ? 400 : 404).json({ error: err })
  const existing = activeJob('contents', c.id, 'overall')
  if (existing) return res.json({ jobId: existing.id, already: true })
  const guidance = (req.body && req.body.guidance || '').trim()
  const base = guidance && c.overall ? JSON.parse(c.overall) : null
  const job = startJob({ agent: 'overall', refType: 'contents', refId: c.id, message: 'writing overall…' }, async (progress) => {
    progress('스토리 스크립트 작성 중… (~1분)', 30)
    const overall = await generateOverall({ analysis: JSON.parse(a.analysis), productName: p?.title || a.title, product: p, base, guidance, persona: c.persona, voStyle: c.vo_style, voStyleNote: c.vo_style_note, hook: c.hook, contentMode: c.content_mode, hasFootage: c.content_mode === 'direct_review', lang: genLang() })
    progress('저장 중…', 90)
    // Script Engine 실행 = 샷 수 추천값을 편집 가능한 값으로 재시드(re-initiate). 이후 사용자가 편집 가능, 다시 실행하면 다시 시드.
    const rec = Number(overall.shotCount)
    const seed = (Number.isInteger(rec) && rec >= 3 && rec <= 12) ? rec : null
    db.prepare(`UPDATE contents SET overall = ?, shot_count = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(overall), seed, c.id)
    return overall
  })
  res.json({ jobId: job.id })
})
// 전체 스크립트 수동 편집 저장
app.put('/api/contents/:id/overall', (req, res) => {
  db.prepare(`UPDATE contents SET overall = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify((req.body && req.body.overall) || {}), req.params.id)
  res.json({ ok: true })
})

// 콘텐츠 모드 (claim-safety 게이트) — 목록 + 콘텐츠별 저장
// ── 히긱스필드 재사용 element(캐릭터/환경/제품) — UI에서 available 목록 조회 + 이름 붙여 새로 등록 ──
let hfElementsCache = { at: 0, data: null }
// DB가 권위 소스. 항상 DB를 즉시 반환. refresh=1이면 HF list를 당겨 병합(upsert)하되,
// HF가 실패/빈 응답이어도 DB는 절대 지우지 않는다 → 'element 사라짐' 불가능.
app.get('/api/hf/elements', async (req, res) => {
  const fresh = req.query.refresh === '1'
  if (fresh || listHfElementsDb().length === 0) {   // refresh, 또는 DB 비었으면(최초) → HF에서 당겨 병합
    try { const els = await listHfElements(); for (const e of els) upsertHfElement(e) }
    catch (e) { return res.json({ elements: listHfElementsDb(), stale: true, error: String(e.message || e) }) }
  }
  res.json({ elements: listHfElementsDb() })
})
const hfElDetailCache = new Map()   // id → { at, data } (element 전체 이미지 뷰어용)
app.get('/api/hf/elements/:id', async (req, res) => {
  const id = req.params.id, now = Date.now(), c = hfElDetailCache.get(id)
  if (c && now - c.at < 10 * 60 * 1000) return res.json({ element: c.data, cached: true })
  try { const el = await getHfElement(id); hfElDetailCache.set(id, { at: now, data: el }); res.json({ element: el }) }
  catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})
app.post('/api/hf/elements', async (req, res) => {
  const { name, category, imageUrl } = req.body || {}
  if (!name || !imageUrl) return res.status(400).json({ error: 'name과 imageUrl이 필요합니다' })
  try {
    const el = await createHfElement({ name, category, imageUrl })
    upsertHfElement(el)   // push → DB 영속화 (패널에 즉시·영구히 뜬다)
    res.json({ element: el })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})
// 로컬 ref 여러 장 → 멀티포토 element 등록 (refs = 로컬 썸네일 문자열 배열)
app.post('/api/hf/elements/multi', async (req, res) => {
  const { name, category, refs } = req.body || {}
  if (!name || !Array.isArray(refs) || !refs.length) return res.status(400).json({ error: 'name과 refs가 필요합니다' })
  const toPath = (r) => {
    let s = String(r || '')
    if (s.includes('|')) s = s.split('|')[1]              // "hfmedia:..|/output/.." → "/output/.."
    s = s.replace(/^https?:\/\/[^/]+/, '')                // 호스트 제거
    const m = s.match(/\/output\/(.+)$/)
    return m ? path.join(OUTPUT_DIR, decodeURIComponent(m[1])) : null
  }
  const paths = refs.map(toPath).filter(Boolean)
  if (!paths.length) return res.status(400).json({ error: '로컬 이미지 경로를 찾지 못했습니다' })
  try {
    const el = await createHfElementMulti({ name, category, filePaths: paths })
    upsertHfElement(el)   // push → DB 영속화
    res.json({ element: el })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})
// 이 콘텐츠의 캐릭터로 element 지정 (또는 해제) — 생성 시 <<<id>>>로 주입되어 전 씬 동일 인물
app.post('/api/contents/:id/character-element', (req, res) => {
  const el = req.body && req.body.element
  const val = el && el.id ? JSON.stringify({ id: el.id, name: el.name || '' }) : null
  db.prepare(`UPDATE contents SET character_element = ?, updated_at = datetime('now') WHERE id = ?`).run(val, req.params.id)
  res.json({ character_element: val ? JSON.parse(val) : null })
})
app.get('/api/content-modes', (req, res) => res.json({ modes: getContentModes() }))
app.post('/api/contents/:id/content-mode', (req, res) => {
  const mode = (req.body && req.body.mode) || null
  db.prepare(`UPDATE contents SET content_mode = ?, updated_at = datetime('now') WHERE id = ?`).run(mode, req.params.id)
  res.json({ content_mode: mode })
})

// 노드 그래프 레퍼런스 라이브러리 저장 (product/character/environment 정리 보존)
app.put('/api/contents/:id/ref-lib', (req, res) => {
  const refLib = (req.body && req.body.refLib) || null
  db.prepare(`UPDATE contents SET ref_lib = ?, updated_at = datetime('now') WHERE id = ?`).run(refLib ? JSON.stringify(refLib) : null, req.params.id)
  res.json({ ok: true })
})

// 노드 이름 등 그래프 커스터마이즈 저장 (편집한 노드 이름 보존)
app.put('/api/contents/:id/node-meta', (req, res) => {
  const nodeMeta = (req.body && req.body.nodeMeta) || null
  db.prepare(`UPDATE contents SET node_meta = ?, updated_at = datetime('now') WHERE id = ?`).run(nodeMeta ? JSON.stringify(nodeMeta) : null, req.params.id)
  res.json({ ok: true })
})
// 그래프 레이아웃 저장 — 수동 추가 노드/연결/위치/노드 설정을 보존 (재빌드해도 유지)
app.put('/api/contents/:id/graph-state', (req, res) => {
  const state = (req.body && req.body.state) || null
  db.prepare(`UPDATE contents SET graph_state = ?, updated_at = datetime('now') WHERE id = ?`).run(state ? JSON.stringify(state) : null, req.params.id)
  res.json({ ok: true })
})

// ④ 씬 스크립트 생성 (편집된 전체 스크립트를 씬 단위로 분해; 없으면 자동 생성). body.guidance로 guided regeneration.
app.post('/api/contents/:id/script', async (req, res) => {
  const { c, a, p, err } = loadForGen(req.params.id)
  if (err) return res.status(c ? 400 : 404).json({ error: err })
  const guidance = (req.body && req.body.guidance || '').trim()
  const base = guidance && c.scenes ? JSON.parse(c.scenes) : null
  // 샷 개수: 프론트가 보내면(빈값=자동) 그 값으로 저장, 안 보내면 저장값 사용
  let shotCount = c.shot_count || null
  if (req.body && 'shotCount' in req.body) {
    const n = Number(req.body.shotCount)
    shotCount = (Number.isInteger(n) && n >= 3 && n <= 12) ? n : null
    db.prepare(`UPDATE contents SET shot_count = ? WHERE id = ?`).run(shotCount, c.id)
  }
  // 씬 분해는 sonnet 체인으로 ~2-3분 → 잡으로(즉시 jobId 반환 + 폴링). 동기 3분 요청은 프록시/소켓에서 끊긴다.
  const existing = activeJob('contents', c.id, 'scenes')
  if (existing) return res.json({ jobId: existing.id, already: true })
  const job = startJob({ agent: 'scenes', refType: 'contents', refId: c.id, message: 'decomposing into scenes…' }, async (progress) => {
    const analysis = JSON.parse(a.analysis)
    let overall = c.overall ? JSON.parse(c.overall) : null
    const hasFootage = c.content_mode === 'direct_review'
    if (!overall) { progress('writing the overall story… (~1min)', 20); overall = await generateOverall({ analysis, productName: p?.title || a.title, product: p, persona: c.persona, voStyle: c.vo_style, voStyleNote: c.vo_style_note, hook: c.hook, contentMode: c.content_mode, hasFootage, lang: genLang() }); db.prepare(`UPDATE contents SET overall = ? WHERE id = ?`).run(JSON.stringify(overall), c.id) }
    progress('writing scene scripts… (~1-2min)', 55)
    const scenes = await generateScenes({ analysis, productName: p?.title || a.title, product: p, overall, base, guidance, direction: c.direction, shotCount, persona: c.persona, voStyle: c.vo_style, voStyleNote: c.vo_style_note, hook: c.hook, contentMode: c.content_mode, hasFootage, lang: genLang() })
    progress('saving…', 90)
    // 새 씬 구성 → 기존 이미지/클립/VO/프리뷰 초기화 (어긋남 방지). 새로 생성해야 함.
    flushContentAssets(c.id)
    db.prepare(`UPDATE contents SET scenes = ?, preview = NULL, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
    return { scenes, overall }
  })
  res.json({ jobId: job.id })
})

// 씬 저장(편집) — 생성 산출물(이미지/클립/VO)은 절대 덮어쓰지 않고 보존한다.
// 프론트 state가 stale(서버 배치 후 미반영)이어도 저장이 클립/이미지를 지우지 않게.
const SCENE_GEN_FIELDS = ['image', 'imageSrc', 'video', 'videoSrc', 'audio', 'voEn', 'elements']
app.put('/api/contents/:id/scenes', (req, res) => {
  const incoming = (req.body && req.body.scenes) || []
  const c = db.prepare('SELECT scenes FROM contents WHERE id = ?').get(req.params.id)
  let existing = []
  try { existing = c?.scenes ? JSON.parse(c.scenes) : [] } catch {}
  const exById = new Map(existing.filter((e) => e && e.id != null).map((e) => [e.id, e]))
  const merged = incoming.map((s, i) => {
    const ex = (s && s.id != null && exById.get(s.id)) || existing[i] || {}
    const out = { ...s }
    for (const f of SCENE_GEN_FIELDS) if (out[f] == null && ex[f] != null) out[f] = ex[f]  // 생성물 보존
    return out
  })
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(merged), req.params.id)
  res.json({ ok: true, scenes: merged })
})

// 최종형: 'card'(이미지) | 'movie'(클립) — 6번 클립 생성 스킵 여부 결정
app.post('/api/contents/:id/final-form', (req, res) => {
  const form = (req.body && req.body.form) === 'movie' ? 'movie' : 'card'
  db.prepare(`UPDATE contents SET final_form = ?, updated_at = datetime('now') WHERE id = ?`).run(form, req.params.id)
  res.json({ ok: true, form })
})

// 생성 결과 URL을 output 폴더로 다운로드해 저장 → 상대 경로(/output/...) 반환
async function saveAsset(contentId, index, url, isClip, suffix = '') {
  const dir = path.join(OUTPUT_DIR, `content-${contentId}`)
  fs.mkdirSync(dir, { recursive: true })
  const kind = isClip ? 'clip' : 'scene'
  const ext = (url.split('?')[0].match(/\.(png|jpg|jpeg|webp|mp4|webm)$/i) || [, isClip ? 'mp4' : 'png'])[1].toLowerCase()
  const r = await fetch(url)
  if (!r.ok) throw new Error('다운로드 실패 ' + r.status)
  const fname = `${kind}-${index + 1}${suffix ? '-' + suffix : ''}.${ext}`   // suffix로 start/end 프레임 파일 분리 (덮어쓰기 방지)
  fs.writeFileSync(path.join(dir, fname), Buffer.from(await r.arrayBuffer()))
  return `/output/content-${contentId}/${fname}`
}
function getScenes(c) { try { return c.scenes ? JSON.parse(c.scenes) : [] } catch { return [] } }
// ✨ Auto 카메라 무빙 — 씬 역할에 맞춰 하나 선택 (한 컷 한 동작 원칙)
function autoCameraMove(i, total) {
  if (i === 0) return 'push_in'                              // 훅 = 긴장감 push in
  if (total > 1 && i === total - 1) return 'static'          // CTA = 정적 (손가락 다운 제스처 깔끔하게)
  const cycle = ['pull_back', 'push_in', 'pan', 'orbit', 'tilt', 'tracking']
  return cycle[(i - 1) % cycle.length]
}

// ── 씬 자산 생성 코어 (per-scene 라우트 + 백그라운드 배치가 공유) ──
// 코스메틱/뷰티 제품 감지 (제품명·특징·분석 카테고리) → 이미지 스타일을 리뷰/UGC(피부·바르는 클로즈업)로
function isCosmeticContent(c, product) {
  const a = c.analysis_id ? db.prepare('SELECT category FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const txt = `${product?.title || ''} ${product?.features || ''} ${a?.category || ''}`.toLowerCase()
  return /뷰티|skin\s?care|skincare|serum|toner|moisturi[sz]|sunscreen|\bspf\b|cleanser|cosmetic|make[\s-]?up|lip\s?gloss|lipstick|mascara|foundation|\bbeauty\b|essence|ampoule|retinol|hyaluron|collagen|k-?beauty|sheet\s?mask|face\s?mask|micellar|exfoliat/i.test(txt)
}
// 이 씬에 캐릭터 레퍼런스가 걸려있는지 (c.character_ref 또는 그래프 refLib character 역할)
function sceneHasCharacterRef(c, scenes, i) {
  if (c.character_ref) return true
  try {
    const rl = c.ref_lib ? JSON.parse(c.ref_lib) : null, gr = scenes[i]?.graphRefs
    if (rl && gr) { const cmap = {}; (rl.character || []).forEach((a) => { if (a && a.id) cmap[a.id] = a.thumb }); if ((gr.character || []).some((id) => cmap[id])) return true }
  } catch { /* ignore */ }
  return false
}
async function genPromptForScene(c, scenes, i, guidance) {
  const product = c.product ? JSON.parse(c.product) : null
  const cosmetic = isCosmeticContent(c, product)
  const hasCharacterRef = sceneHasCharacterRef(c, scenes, i)
  // 씬 캐릭터 element 이름(들) → 프롬프트에서 이름으로 부르고 외모 서술 금지. 씬 지정 없으면 콘텐츠 기본 캐릭터.
  let charElC = null; try { charElC = c.character_element ? JSON.parse(c.character_element) : null } catch { charElC = null }
  const sceneElsC = Array.isArray(scenes[i].elements) ? scenes[i].elements.filter((e) => e && e.name) : []
  let elementNames = sceneElsC.map((e) => e.name)
  if (!elementNames.length && charElC && charElC.name) elementNames = [charElC.name]
  const siblingTitles = scenes.map((s) => s.onScreenText || '')
  // 데메아너(표정 톤) = 페르소나 register, 없으면 릴스 분석의 voice.register
  let demeanor = (c.persona ? getPersona(c.persona)?.register : '') || ''
  if (!demeanor && c.analysis_id) { try { const a = db.prepare('SELECT analysis FROM analyses WHERE id = ?').get(c.analysis_id); demeanor = (a?.analysis ? (JSON.parse(a.analysis).voice || {}).register : '') || '' } catch { /* ignore */ } }
  const p = await generateImagePrompt({ scene: scenes[i], productName: product?.title, product, style: c.style, sceneIndex: i, sceneTotal: scenes.length, guidance, cosmetic, hasCharacterRef, elementNames, siblingTitles, demeanor, lang: genLang() })
  if (!p) throw new Error('이미지 프롬프트 생성 실패')
  scenes[i] = { ...scenes[i], imagePrompt: p }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
// 한 씬의 스크립트(Title + VO) 재생성 — overall + guidance 기반
async function genSceneScriptForScene(c, scenes, i, guidance) {
  const overall = c.overall ? JSON.parse(c.overall) : null
  if (!overall) throw new Error('먼저 Script Engine으로 전체 스크립트를 생성하세요.')
  const product = c.product ? JSON.parse(c.product) : null
  const a = c.analysis_id ? db.prepare('SELECT title FROM analyses WHERE id = ?').get(c.analysis_id) : null
  const r = await generateSceneScript({ overall, product, productName: product?.title || a?.title, scenes, sceneIndex: i, sceneTotal: scenes.length, persona: c.persona, voStyle: c.vo_style, voStyleNote: c.vo_style_note, hook: c.hook, contentMode: c.content_mode, hasFootage: c.content_mode === 'direct_review', guidance, durationSec: scenes[i].durationSec, lang: genLang() })
  scenes[i] = { ...scenes[i], onScreenText: r.onScreenText, vo: r.vo, ...(r.emotion ? { emotion: r.emotion } : {}), ...(r.purpose ? { purpose: r.purpose } : {}) }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
// 씬 스크립트 기반 모션 프롬프트(캐릭터·제품 동작) 생성 — guidance(input prompt)로 조정
async function genMotionForScene(c, scenes, i, guidance) {
  const product = c.product ? JSON.parse(c.product) : null
  const motionPrompt = await generateMotionPrompt({ scene: scenes[i], product, guidance, lang: genLang() })
  scenes[i] = { ...scenes[i], motionPrompt }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
// VO 텍스트(voEn) — 씬 VO → 음성용 영어. guidance 있으면 LLM으로 조정, 없으면 번역/복사
async function genVoTextForScene(c, scenes, i, guidance) {
  const vo = scenes[i].vo || scenes[i].onScreenText || ''
  const voEn = (guidance && guidance.trim())
    ? await generateVoText({ vo, guidance, lang: genLang() })
    : (/english/i.test(genLang()) ? vo : (await translateVO(vo)) || vo)
  scenes[i] = { ...scenes[i], voEn }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
// lazy 업로드: 로컬 전용 ref(/output/…, hfmedia: 없음)를 첫 사용 시 HF에 업로드하고
// refLib에 media_id를 박아 upload-once로 만든다. 이미 hfmedia:/http면 그대로 둔다.
async function upgradeRefsToHf(c, refLib, refGroups) {
  let changed = false
  const cache = new Map()
  const up = async (ref) => {
    if (!ref || typeof ref !== 'string') return ref
    if (ref.startsWith('hfmedia:')) return ref                               // 이미 업로드됨
    if (cache.has(ref)) return cache.get(ref)
    // 'hfmedia:..|경로' 접두어 + http://host 접두어 제거 → 순수 경로. localhost/output도 로컬 파일로 취급(HF는 로컬 못 읽음).
    const local = ref.replace(/^.*\|/, '').replace(/^https?:\/\/[^/]+/i, '')
    if (!/^\/output\//.test(local)) {                                        // /output 로컬 파일이 아니면
      if (/^https?:/i.test(ref)) return ref                                  // 진짜 외부 공개 URL → 그대로 import
      cache.set(ref, ref); return ref
    }
    const abs = path.join(OUTPUT_DIR, local.replace(/^\/output\//, ''))
    if (!fs.existsSync(abs)) { cache.set(ref, ref); return ref }             // 파일 없음 → 그대로(폴백)
    const ct = 'image/' + (path.extname(abs).slice(1).replace('jpg', 'jpeg') || 'png')
    const mediaRef = await uploadRefViaCLI({ buffer: fs.readFileSync(abs), filename: path.basename(abs), contentType: ct })
    const upgraded = `${mediaRef}|${local}`
    cache.set(ref, upgraded)
    if (refLib) for (const role of ['product', 'character', 'environment']) for (const a of (refLib[role] || [])) if (a && a.thumb === ref) { a.thumb = upgraded; changed = true }
    return upgraded
  }
  const out = {}
  for (const k of Object.keys(refGroups)) { const v = refGroups[k]; out[k] = Array.isArray(v) ? await Promise.all(v.map(up)) : await up(v) }
  if (changed) db.prepare(`UPDATE contents SET ref_lib = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(refLib), c.id)
  return out
}
async function genImageForScene(c, scenes, i, promptOverride, frameRole) {
  const product = c.product ? JSON.parse(c.product) : null
  const scenePrompt = promptOverride || scenes[i].imagePrompt || buildImagePrompt(scenes[i], product)
  // 프레임 역할 → 클립은 start 프레임에서 end 프레임으로 '움직임'을 렌더한다. 두 프레임은 같은 그림이면 안 되고, 이 씬 모션(motionPrompt)의 시작 상태 / 끝 상태를 각각 담아야 한다.
  const motion = (scenes[i].motionPrompt || '').trim()
  const frameDir = frameRole === 'end'
    ? `[FRAME = END KEYFRAME — the LAST frame of the clip] A DIFFERENT, later moment than the start frame — the clip animates from start to here, so the posture MUST be VISIBLY DIFFERENT: her pose, gesture, gaze and expression have moved through the action${motion ? ` (${motion})` : ''}, settling into the resolved/payoff expression. Do NOT reproduce the start frame's pose — it must clearly differ. The ONE hard rule: the product stays in the SAME hand as the start frame — NEVER switch it to the other hand, and NEVER mirror/flip the shot. Keep the same person, background and wardrobe; change the posture.`
    : `[FRAME = START KEYFRAME — the FIRST frame of the clip] Render the OPENING moment of this shot: the expression just BEGINNING (the first flicker), the product held naturally. Note which hand holds the product — the end frame will show a DIFFERENT posture but keep the product in that SAME hand.`
  const prompt = [
    scenePrompt,
    frameDir,
    c.style && c.style.trim() ? `Style direction: ${c.style.trim()}.` : '',
    product?.dimensions ? `The real product's actual dimensions are ${product.dimensions} — depict it at exactly that real-world size.` : '',
    product?.features ? `Depict the product accurately per these real specs/mechanics: ${String(product.features).slice(0, 700)}` : '',
  ].filter(Boolean).join(' ')
  // 노드 그래프 레퍼런스(refLib + 씬 graphRefs) → 실제 URL 해석. 없으면 기존 방식 폴백.
  let refLib = null; try { refLib = c.ref_lib ? JSON.parse(c.ref_lib) : null } catch { refLib = null }
  const gr = scenes[i].graphRefs
  let gProduct = null, gChar = null, gEnv = null
  if (refLib) {
    const map = {}; ['product', 'character', 'environment'].forEach((role) => (refLib[role] || []).forEach((a) => { if (a && a.id) map[a.id] = a.thumb }))
    if (gr) {   // 씬에 명시 지정이 있으면 그대로
      gProduct = (gr.product || []).map((id) => map[id]).filter(Boolean)
      gChar = (gr.character || []).map((id) => map[id]).find(Boolean) || null
      gEnv = (gr.environment || []).map((id) => map[id]).find(Boolean) || null
    } else {   // 명시 지정 없음 → 라이브러리 전체를 기본 적용 (프론트 defRefs와 동일). 캐릭터 레퍼런스가 실제로 이미지에 반영되도록.
      gProduct = (refLib.product || []).map((a) => a.thumb).filter(Boolean)
      gChar = (refLib.character || []).map((a) => a.thumb).find(Boolean) || null
      gEnv = (refLib.environment || []).map((a) => a.thumb).find(Boolean) || null
    }
  }
  let refs = (gProduct && gProduct.length) ? gProduct : (Array.isArray(scenes[i].refs) && scenes[i].refs.length) ? scenes[i].refs : [product?.image || (product?.images || [])[0]].filter(Boolean)
  // 씬별 캐릭터 element(들) → 정체성 고정 (<<<id>>> 프롬프트 주입). 씬 지정 없으면 콘텐츠 기본 캐릭터. 있으면 로컬 캐릭터 ref 생략.
  let charEl = null; try { charEl = c.character_element ? JSON.parse(c.character_element) : null } catch { charEl = null }
  const sceneEls = Array.isArray(scenes[i].elements) ? scenes[i].elements.filter((e) => e && e.id) : []
  let elIds = sceneEls.map((e) => e.id)
  if (!elIds.length && charEl && charEl.id) elIds = [charEl.id]
  let characterRef = elIds.length ? null : (gChar || c.character_ref || null)
  let envRef = gEnv || scenes[i].envRef || null
  let url
  if (hfReady()) { url = await genImage({ prompt, aspect: '9:16' }) }
  else {
    const up = await upgradeRefsToHf(c, refLib, { refs, characterRef, envRef })   // 로컬 전용 ref → 첫 사용 시 HF 업로드(once)
    refs = up.refs; characterRef = up.characterRef; envRef = up.envRef
    url = await genImageViaCLI({ prompt, productImageUrls: refs, characterRef, envRef, charElementIds: elIds, productName: product?.title, dimensions: product?.dimensions })
  }
  const rel = await saveAsset(c.id, i, url, false, frameRole === 'end' ? 'end' : '')   // start/end 별도 파일
  // end 프레임은 별도 슬롯(imageEnd)에 저장 → start(image)를 덮어쓰지 않음. 클립이 둘 다 키프레임으로 사용.
  const imgFields = frameRole === 'end' ? { imageEnd: rel, imageSrcEnd: url } : { image: rel, imageSrc: url }
  scenes[i] = { ...scenes[i], ...(promptOverride ? { imagePrompt: promptOverride } : {}), ...imgFields }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
async function genClipForScene(c, scenes, i, promptOverride) {
  const imageUrl = scenes[i].imageSrc
  if (!imageUrl) { const e = new Error('먼저 이 씬의 이미지를 생성하세요.'); e.needImage = true; throw e }
  // 클립은 이미지 프롬프트(씬 설명)를 물려받음. 카메라 무빙 = 한 컷 한 동작, 느리게 (camera-moves.yaml).
  const sceneDesc = (scenes[i].imagePrompt || '').replace(/\s*vertical 9:16[^.]*$/i, '').trim().slice(0, 400)
  let moveKey = scenes[i].cameraMove
  if (moveKey === 'auto') moveKey = autoCameraMove(i, scenes.length)        // ✨ Auto: 씬 역할에 맞는 무빙
  const move = getCameraMove(moveKey)
  const camera = move ? `CAMERA: ${move.prompt}` : 'CAMERA: slow push in'   // 기본 = 느린 push in (안전한 시네마틱)
  const extra = (promptOverride || scenes[i].motionPrompt || '').trim()      // 추가 연기/액션 (선택)
  const motion = `${sceneDesc ? sceneDesc + '. ' : ''}${camera}.${extra ? ' ' + extra + '.' : ''} Apply exactly ONE slow, smooth camera move — never stack multiple moves. The object stays as placed; do NOT fold, unfold, assemble or transform the product.`
  const dur = Math.max(3, Math.min(10, Math.round(Number(scenes[i].durationSec) || 5)))   // 씬 durationSec 반영 (3-10s)
  const endImageUrl = scenes[i].imageSrcEnd || null                                        // end 프레임(있으면) → start→end 모핑
  const url = await genVideoViaCLI({ imageUrl, endImageUrl, prompt: motion, duration: dur, model: scenes[i].model })
  const rel = await saveAsset(c.id, i, url, true)
  scenes[i] = { ...scenes[i], ...(promptOverride ? { motionPrompt: promptOverride } : {}), video: rel, videoSrc: url }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}
async function genVoForScene(c, scenes, i, textOverride) {
  const voEn = (textOverride || scenes[i].vo || scenes[i].onScreenText || '').trim()
  if (!voEn) throw new Error('VO 텍스트가 비어있습니다.')
  const url = await genAudioViaCLI({ text: voEn })
  const dir = path.join(OUTPUT_DIR, `content-${c.id}`); fs.mkdirSync(dir, { recursive: true })
  const fname = `vo-${i + 1}.mp3`
  const r = await fetch(url); fs.writeFileSync(path.join(dir, fname), Buffer.from(await r.arrayBuffer()))
  scenes[i] = { ...scenes[i], voEn, audio: `/output/content-${c.id}/${fname}` }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  return scenes[i]
}

// ── 백그라운드 배치 (전체 이미지/클립/VO) — 서버에서 돌아 페이지 이동/새로고침에 안전 ──
const batchJobs = new Map()  // contentId -> { kind, total, done, current, fails:[], status, lastError }
async function runBatch(id, kind, idx) {
  const job = batchJobs.get(id)
  for (const i of idx) {
    if (!job) return
    job.current = i
    try {
      const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(id)
      const scenes = getScenes(c)
      if (kind === 'clips') await genClipForScene(c, scenes, i)
      else if (kind === 'vo') await genVoForScene(c, scenes, i)
      else if (kind === 'prompts') await genPromptForScene(c, scenes, i)
      else await genImageForScene(c, scenes, i)
    } catch (e) { job.fails.push(i + 1); job.lastError = (e.message || String(e)).slice(0, 160) }
    job.done++
  }
  job.status = 'done'; job.finishedAt = Date.now()
}
app.post('/api/contents/:id/batch', (req, res) => {
  const id = Number(req.params.id)
  const kind = (req.body && req.body.kind) || 'images'
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const existing = batchJobs.get(id)
  if (existing && existing.status === 'running') return res.json({ ok: true, job: existing })
  const scenes = getScenes(c)
  let idx
  if (kind === 'clips') idx = scenes.map((_, i) => i).filter((i) => scenes[i].makeVideo && scenes[i].imageSrc)
  else if (kind === 'vo') idx = scenes.map((_, i) => i).filter((i) => scenes[i].vo || scenes[i].onScreenText)
  else idx = scenes.map((_, i) => i)
  if (!idx.length) return res.status(400).json({ error: kind === 'clips' ? '영상화(✨) 켠 씬에 이미지가 먼저 있어야 합니다.' : kind === 'vo' ? 'VO 텍스트가 있는 씬이 없습니다.' : '먼저 씬 스크립트를 생성하세요.' })
  const job = { kind, total: idx.length, done: 0, current: idx[0], fails: [], status: 'running', startedAt: Date.now() }
  batchJobs.set(id, job)
  runBatch(id, kind, idx).catch((e) => { job.status = 'error'; job.lastError = (e.message || String(e)).slice(0, 160) })
  res.json({ ok: true, job })
})
app.get('/api/contents/:id/batch', (req, res) => res.json({ job: batchJobs.get(Number(req.params.id)) || null }))
// 콘텐츠의 생성 자산(이미지/클립/VO/프리뷰) 파일 초기화 — 씬 스크립트 새로 만들 때
function flushContentAssets(contentId) {
  const dir = path.join(OUTPUT_DIR, `content-${contentId}`)
  try { for (const f of fs.readdirSync(dir)) if (/^(scene|clip|vo|seg|preview)/.test(f)) fs.unlinkSync(path.join(dir, f)) } catch {}
}

// 이미지 생성 가능 여부 + 경로. cli = claude CLI→Higgsfield MCP(기본, 추가결제0) / sdk = API 키
app.get('/api/hf/status', (req, res) => res.json({ ready: cliReady() || hfReady(), mode: hfReady() ? 'sdk' : 'cli' }))

// 씬 이미지 첨부 (옵션2: 에이전트가 Higgsfield MCP로 생성한 URL을 다운로드해 저장)
app.post('/api/contents/:id/scene-image', async (req, res) => {
  const { index, url, clip } = req.body || {}
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  if (!url) return res.status(400).json({ error: 'url 필요' })
  try {
    const rel = await saveAsset(c.id, i, url, !!clip)
    scenes[i] = clip ? { ...scenes[i], video: rel, videoSrc: url } : { ...scenes[i], image: rel, imageSrc: url }
    db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
    res.json({ ok: true, scene: scenes[i] })
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬 이미지 생성 (버튼, 씬 1개씩 = iterative/순차).
//  기본: claude CLI → Higgsfield MCP (제품 이미지 레퍼런스). HF_CREDENTIALS 있으면 SDK 직접.
// 씬 이미지 프롬프트(영어 설명) 생성 — 이미지 생성과 분리. 검수/수정 후 이미지 생성.
app.post('/api/contents/:id/scene/:index/prompt', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  try { const scene = await genPromptForScene(c, scenes, i, req.body && req.body.guidance); res.json({ ok: true, scene }) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬 스크립트(Title+VO) 재생성 — overall + guidance(instruction) 기반
app.post('/api/contents/:id/scene/:index/script', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  try { const scene = await genSceneScriptForScene(c, scenes, i, req.body && req.body.guidance); res.json({ ok: true, scene }) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬 모션 프롬프트 생성 (캐릭터·제품 동작 — 씬 스크립트 기반)
app.post('/api/contents/:id/scene/:index/motion', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  try { const scene = await genMotionForScene(c, scenes, i, req.body && req.body.guidance); res.json({ ok: true, scene }) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬 VO 텍스트(voEn) 생성 (씬 VO → 음성용 영어 텍스트)
app.post('/api/contents/:id/scene/:index/votext', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  try { const scene = await genVoTextForScene(c, scenes, i, req.body && req.body.guidance); res.json({ ok: true, scene }) }
  catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// 씬별 캐릭터 element(들) 지정 — "Yuna meets Sofia" 같은 멀티 캐스트. body.elements = [{id,name}]
app.post('/api/contents/:id/scene/:index/elements', (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  const els = Array.isArray(req.body && req.body.elements) ? req.body.elements.filter((e) => e && e.id).map((e) => ({ id: String(e.id), name: e.name || '' })) : []
  scenes[i] = { ...scenes[i], elements: els }
  db.prepare(`UPDATE contents SET scenes = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(scenes), c.id)
  res.json({ ok: true, scene: scenes[i] })
})

// 씬 미디어 생성(이미지/클립/VO)을 '잡'으로 실행 — 페이지 이동/새로고침 후에도 서버에서 계속 돌고, 돌아오면 노드가 재접속(재부착)한다.
// agent 키에 씬 index(+ 이미지 frameRole)를 인코딩 → 노드별 활성 잡을 찾아 붙는다: img#3 / img#3e / clip#3 / vo#3.
function genFriendly(m) {
  return /credit/i.test(m) ? 'Higgsfield 크레딧 부족 — 충전 후 다시 시도하세요.'
    : /nsfw/i.test(m) ? '이미지가 콘텐츠 필터에 걸렸습니다 — 프롬프트를 수정하세요.'
    : m === 'NO_CREDENTIALS' ? 'HF_CREDENTIALS 미설정' : m === 'NO_IMAGE' ? '먼저 씬 이미지를 생성하세요.' : m
}
function startSceneGen(res, c, agent, message, fn) {
  const existing = activeJob('contents', c.id, agent)
  if (existing) return res.json({ jobId: existing.id, agent, already: true })   // 이미 도는 잡에 재접속
  const job = startJob({ agent, refType: 'contents', refId: c.id, message }, async (progress) => {
    try { return await fn(progress) } catch (e) { throw new Error(genFriendly(e.message || String(e))) }
  })
  res.json({ jobId: job.id, agent })
}
app.post('/api/contents/:id/scene/:index/image', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  const frameRole = req.body && req.body.frameRole === 'end' ? 'end' : 'start'
  startSceneGen(res, c, `img#${i}${frameRole === 'end' ? 'e' : ''}`, '이미지 생성 중…', async (progress) => {
    progress('이미지 생성 중… (~1분)', 30)
    return await genImageForScene(c, scenes, i, req.body && req.body.prompt, frameRole)
  })
})

// 씬 클립 생성 (image→video, 풀무비). 씬 이미지가 먼저 있어야 함.
app.post('/api/contents/:id/scene/:index/clip', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  if (!scenes[i].imageSrc) return res.status(400).json({ error: '먼저 이 씬의 이미지를 생성하세요 (클립은 이미지 기반).', needImage: true })
  startSceneGen(res, c, `clip#${i}`, '클립 생성 중…', async (progress) => {
    progress('클립 렌더링 중… (~1-2분)', 30)
    return await genClipForScene(c, scenes, i, req.body && req.body.prompt)
  })
})

// 씬 VO 생성 (영어). 한국어 vo → 영어 번역 → 음성 → mp3 저장. scene.voEn + scene.audio.
app.post('/api/contents/:id/scene/:index/vo', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  const i = Number(req.params.index)
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) return res.status(400).json({ error: '잘못된 씬 index' })
  startSceneGen(res, c, `vo#${i}`, 'VO 생성 중…', async (progress) => {
    progress('음성 생성 중…', 40)
    return await genVoForScene(c, scenes, i, req.body && req.body.text)
  })
})

// 임시 프리뷰 무비 합성 (ffmpeg) — 현재 씬들의 클립/이미지 + VO를 이어붙임
app.post('/api/contents/:id/movie', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  if (!scenes.length) return res.status(400).json({ error: '씬이 없습니다.' })
  try {
    const dir = path.join(OUTPUT_DIR, `content-${c.id}`); fs.mkdirSync(dir, { recursive: true })
    const outPath = path.join(dir, 'preview.mp4')
    await buildPreview(dir, scenes, outPath)
    const rel = `/output/content-${c.id}/preview.mp4?t=${Date.now()}`
    db.prepare(`UPDATE contents SET preview = ?, updated_at = datetime('now') WHERE id = ?`).run(`/output/content-${c.id}/preview.mp4`, c.id)
    res.json({ ok: true, preview: rel })
  } catch (e) { res.status(500).json({ error: e.message || String(e) }) }
})

// Remotion 정식 익스포트 — scenes(클립/이미지 + 자막 + VO) → 9:16 mp4
app.post('/api/contents/:id/remotion', async (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '없는 콘텐츠' })
  const scenes = getScenes(c)
  if (!scenes.length) return res.status(400).json({ error: '씬이 없습니다.' })
  const base = `http://localhost:${PORT}`
  const dir = path.join(OUTPUT_DIR, `content-${c.id}`)
  try {
    const data = []
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]
      const isVid = !!(s.makeVideo && s.video)
      const visRel = isVid ? s.video : s.image
      if (!visRel) continue
      const visLocal = path.join(dir, path.basename(visRel))
      if (!fs.existsSync(visLocal)) continue
      let sec = Math.max(2, Number(s.durationSec) || 4)
      if (isVid) { const d = await probeDuration(visLocal); if (d > 0) sec = Math.min(d, 15) }
      if (s.audio) { const ad = await probeDuration(path.join(dir, path.basename(s.audio))); if (ad > 0) sec = Math.max(sec, ad + 0.3) }
      data.push({
        kind: isVid ? 'video' : 'image',
        src: base + visRel,
        audio: s.audio ? base + s.audio : null,
        caption: s.onScreenText || '',
        cta: i === scenes.length - 1,
        durationInFrames: Math.round(Math.min(sec, 15) * FPS),
      })
    }
    if (!data.length) return res.status(400).json({ error: '렌더할 씬 없음 — 이미지/클립을 먼저 생성하세요.' })
    const outPath = path.join(dir, 'short.mp4')
    await renderShort({ scenes: data, outPath })
    db.prepare(`UPDATE contents SET export_mp4 = ?, updated_at = datetime('now') WHERE id = ?`).run(`/output/content-${c.id}/short.mp4`, c.id)
    res.json({ ok: true, url: `/output/content-${c.id}/short.mp4?t=${Date.now()}` })
  } catch (e) { res.status(500).json({ error: 'Remotion 렌더 실패: ' + (e.message || String(e)).slice(0, 300) }) }
})

const PORT = process.env.PORT || 5174
app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (db ready)`)
})
