// 제품 매칭 — 키워드가 아니라 "생김새"로 매칭한다.
// 릴스 프레임(실제 제품 모습) vs 아마존 후보 이미지들을 Claude 비전(claude CLI + Read 툴)으로
// 비교해 같은 디자인을 고른다. 같은 기능(블루투스+무선충전+조명)이라도 디자인이 다르면 다른 제품.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { amazonSearch, amazonProduct, affiliateUrl } from './amazon.js'
import { runClaude as cliRunClaude, extractJson } from './cli.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.resolve(__dirname, '../data')
const CLI_MODEL = process.env.MATCH_CLI_MODEL || 'sonnet'

// 비전 = 공용 래퍼 + Read 툴 (프레임/후보 이미지를 CLI가 읽는다)
const runClaudeVision = (prompt, opts = {}) => cliRunClaude(prompt, { tools: ['Read'], model: CLI_MODEL, timeout: 240000, timeoutMsg: 'claude vision timeout', ...opts })

async function downloadImg(url, outPath) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('img ' + r.status)
  await fs.promises.writeFile(outPath, Buffer.from(await r.arrayBuffer()))
  return outPath
}

// 릴스 프레임 중 제품이 잘 보일 만한 2장 (가운데쯤)
function pickFrames(code, n = 2) {
  const dir = path.join(DATA, 'frames', code)
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => /\.jpg$/i.test(f)).sort() } catch { return [] }
  if (!files.length) return []
  const idxs = n >= files.length ? files.map((_, i) => i) : [Math.floor(files.length * 0.4), Math.floor(files.length * 0.7)]
  return [...new Set(idxs)].map((i) => path.join(dir, files[Math.min(i, files.length - 1)]))
}

// 한 번의 시도: 검색 → 후보 이미지 저장 → 비전 비교. 결과 {m, cand} 반환.
async function attempt({ code, query, domain, round }) {
  const items = (await amazonSearch(query, { domain, max: 6 })) || []
  const frames = pickFrames(code)
  if (!items.length || !frames.length) return { m: { asin: null, confidence: 0, reason: !items.length ? 'no Amazon results' : 'no reel frames', betterQuery: '' }, cand: [], items }
  const mdir = path.join(DATA, 'match', code, `r${round}`)
  fs.mkdirSync(mdir, { recursive: true })
  const cand = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.image) continue
    try { const p = path.join(mdir, `c${i}.jpg`); await downloadImg(it.image, p); cand.push({ ...it, _path: p, n: cand.length + 1 }) } catch {}
  }
  if (!cand.length) return { m: { asin: null, confidence: 0, reason: 'candidate images unavailable', betterQuery: '' }, cand: [], items }

  const prompt = `You match a product shown in an Instagram reel to Amazon listings by VISUAL APPEARANCE — the same physical design/shape — NOT just shared features. Many gadgets share features (e.g. bluetooth + wireless charger + night light) yet look completely different; those are different products.

Read these REEL product frames first:
${frames.map((f, i) => `REEL[${i + 1}]: ${f}`).join('\n')}

Then read each AMAZON candidate image and compare its DESIGN/SHAPE to the reel product:
${cand.map((c) => `CANDIDATE ${c.n}: asin=${c.asin} title="${(c.title || '').slice(0, 90)}" image=${c._path}`).join('\n')}

Pick the candidate whose physical design genuinely matches the reel product (same form factor, silhouette, key parts). If NONE clearly matches the same design, return null — do not force a match on shared features alone. When nothing matches, suggest a better English Amazon search query that describes the reel product's actual design (shape words, e.g. "arch handle moon lamp wireless charger speaker").

ALL text in English. Output ONLY JSON: {"asin":"<matching asin or null>","confidence":0.0,"reason":"one short line in English","betterQuery":"<improved English search query, or empty>"}`

  let m = null
  for (let k = 0; k < 2 && !m; k++) { try { const out = await runClaudeVision(prompt); const j = extractJson(out); if (j && typeof j === 'object') m = j } catch {} }
  if (!m) m = { asin: null, confidence: 0, reason: 'vision compare failed', betterQuery: '' }
  return { m, cand, items }
}

// 핵심: 릴스 제품과 같은 "디자인"의 아마존 후보를 비전으로 고른다.
// 과하게 구체적인 쿼리를 줄인다: 노이즈/과장 단어 제거 후 핵심 3단어까지. (Amazon 키워드 검색은 단어가 적을수록 결과가 많다)
const QUERY_NOISE = new Set(['toy', 'replica', 'fake', 'clone', 'copy', 'knockoff', 'imitation', 'novelty', 'cheap', 'best', 'new', 'the', 'a', 'an', 'for', 'with', 'style', 'like', 'small', 'tiny', 'cute', 'viral', 'trending', 'gadget', 'device', 'item', 'product'])
export function simplerQuery(q) {
  const words = String(q || '').trim().split(/\s+/).filter((w) => w && !QUERY_NOISE.has(w.toLowerCase().replace(/[^a-z0-9]/gi, '')))
  return (words.length > 3 ? words.slice(0, 3) : words).join(' ')
}

// 1차 검색에서 못 찾으면 비전이 제안한 더 정확한 검색어로 1번 재시도.
// 출력: { product|null, candidates, match:{asin,confidence,reason}, query }
export async function matchProductByVision({ code, query, domain = 'www.amazon.com', assocTag = '' }) {
  if (!query || !query.trim()) return { product: null, candidates: [], match: null, query: '' }
  let usedQuery = query
  let { m, cand, items } = await attempt({ code, query, domain, round: 0 })
  // 0건 → 쿼리가 과하게 구체적(예: "mini iPhone phone toy replica")일 때가 많다. 노이즈 단어 제거 + 핵심 3단어로 줄여 재검색.
  if (!items.length) {
    const sq = simplerQuery(query)
    if (sq && sq.toLowerCase() !== query.trim().toLowerCase()) {
      const rs = await attempt({ code, query: sq, domain, round: 1 })
      if (rs.items.length) { m = rs.m; cand = rs.cand; items = rs.items; usedQuery = sq }
    }
  }
  // 못 찾았고 더 나은 검색어를 제안하면 → 그걸로 재검색 1회
  if (!m.asin && m.betterQuery && m.betterQuery.trim() && m.betterQuery.trim().toLowerCase() !== usedQuery.trim().toLowerCase()) {
    const r2 = await attempt({ code, query: m.betterQuery.trim(), domain, round: 2 })
    if (r2.cand.length) { m = r2.m; cand = r2.cand; items = r2.items; usedQuery = m.asin ? m.betterQuery.trim() : usedQuery }
  }

  let product = null
  const hit = m.asin ? cand.find((c) => c.asin === m.asin) : null
  if (hit) {
    let dimensions = '', features = '', images = []
    try { const d = await amazonProduct(hit.asin, { domain }); dimensions = d?.dimensions || ''; features = d?.features || ''; images = d?.images || [] } catch {}
    product = { source: 'original', asin: hit.asin, title: hit.title || null, price: hit.price || null, rating: hit.rating || null, reviewCount: hit.reviewCount || null, image: hit.image || images[0] || null, dimensions, features, images, amazon_url: affiliateUrl(hit.asin, assocTag, domain), match_confidence: m.confidence ?? null, match_reason: m.reason || '' }
  }
  const candidates = (cand.length ? cand : items).map((c) => ({ asin: c.asin, title: c.title, price: c.price, rating: c.rating, reviewCount: c.reviewCount, image: c.image }))
  return { product, candidates, match: { asin: m.asin || null, confidence: m.confidence ?? 0, reason: m.reason || '' }, query: usedQuery }
}
