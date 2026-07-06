import { runClaude as cliRunClaude } from './cli.js'
// 릴스 → 제품 후보 추출. LLM 보조(Claude Haiku) + 키 없을 때 키워드 휴리스틱 폴백.
// 결정사항: "모음은 광산, 제작은 단일" → 모음 릴스는 여러 제품 후보로 분해.
// 캡션은 펀널로 제품명을 숨기는 경우가 많아, 추출 목표는 정확한 SKU가 아니라
// 제품 '타입/카테고리' 후보. 구체 ASIN은 Step 4 아마존 게이트에서 확정.

const MODEL = process.env.EXTRACT_MODEL || 'claude-haiku-4-5-20251001'

const COMBO = /(\b\d{2,3}\b.*(products|items|finds|deals)|best ?sellers|top \d|round ?up|haul|essentials|favorites)/i
export const isCombo = (cap = '') => COMBO.test(cap)

// ── 휴리스틱 사전 (키 없을 때) — 발굴 리포트 카테고리 기반 ──
const DICT = [
  { re: /swimsuit|swimwear|bikini|one ?piece/i, name: '수영복', cat: '패션' },
  { re: /\bbra|bralette|seamless top|no ?bra|tops? for/i, name: '심리스 탑', cat: '패션' },
  { re: /dress|matching set|pants|lace top|flowy|outfit|jeans/i, name: '여름 의류', cat: '패션' },
  { re: /perfume|fragrance|body mist|huele|smell/i, name: '바디미스트/향수', cat: '뷰티' },
  { re: /skincare|serum|sunscreen|glass skin|moistur/i, name: '스킨케어', cat: '뷰티' },
  { re: /mood light|lamp|lighting|\blight\b|led/i, name: '무드 조명', cat: '조명' },
  { re: /rug|decor|home|interior|living room/i, name: '홈 인테리어', cat: '생활' },
  { re: /organiz|storage|ordnung|declutter|bins?/i, name: '수납/정리템', cat: '수납정리' },
  { re: /kitchen|cooking|utensil|gadget/i, name: '주방템', cat: '주방' },
  { re: /road trip|car |charging|travel essentials/i, name: '차량/여행템', cat: '여행' },
  { re: /notepad|legal pad|planner|notebook|office supplies|stationery/i, name: '문구/다이어리', cat: '문구' },
  { re: /pool|outdoor|patio|backyard/i, name: '아웃도어', cat: '생활' },
  { re: /camera|tripod|recording|content (creation|tools)|mic/i, name: '촬영 장비', cat: '가전' },
  { re: /classroom|teacher|school supplies/i, name: '교실/교사용품', cat: '문구' },
  { re: /cleaning|cleantok|vacuum/i, name: '청소템', cat: '생활' },
]

function heuristicExtract(reels) {
  return reels.map((r) => {
    const cap = r.caption || ''
    const hits = DICT.filter((d) => d.re.test(cap))
    let products
    if (hits.length) {
      products = hits.map((h) => ({ name: h.name, category: h.cat, confidence: 0.5, oneOfMany: isCombo(cap) }))
    } else {
      // 단서 없으면 모음이면 일반 후보, 단일이면 미상
      products = [{ name: isCombo(cap) ? '아마존 베스트셀러 모음(미상)' : '미상 제품', category: '기타', confidence: 0.2, oneOfMany: isCombo(cap) }]
    }
    return { code: r.code, products }
  })
}

function stripFence(t = '') {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : t).trim()
}

async function llmExtract(reels) {
  const items = reels.map((r) => ({ code: r.code, caption: r.caption || '', combo: isCombo(r.caption) }))
  const system = `You extract shoppable product candidates from Instagram shopping-reel captions for an Amazon-affiliate shorts pipeline.
Rules:
- Captions are often "funnel" style hiding the exact product ("comment LINK"). Infer the product TYPE from any hint (e.g. "swimsuit", "legal pads", "mood light", "road trip essentials").
- A roundup/haul reel (combo=true) → return MULTIPLE candidates if the caption hints them; if only generic ("25 amazon finds") return ONE generic candidate with low confidence.
- A single-product reel → exactly one candidate.
- "name": a SHORT Korean product-type label (e.g. "무드 조명", "수영복", "리갈패드"). "category": one of 패션/뷰티/주방/수납정리/조명/가전/문구/여행/생활/기타.
- "confidence": 0..1 (how sure the product type is identifiable from the caption).
Return ONLY a JSON array, no prose:
[{"code":"...","products":[{"name":"...","category":"...","confidence":0.0,"oneOfMany":false}]}]`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content: JSON.stringify(items) }] }),
  })
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const data = await r.json()
  const text = (data.content || []).map((c) => c.text || '').join('')
  const parsed = JSON.parse(stripFence(text))
  if (!Array.isArray(parsed)) throw new Error('LLM 응답이 배열이 아님')
  return parsed
}

// ── 릴스우선 모델: 단일 릴스 제품 식별 (영어 아마존 검색어 포함) ──
// 휴리스틱 영어 매핑 (키 없을 때)
const DICT_EN = [
  { re: /swimsuit|swimwear|bikini|one ?piece/i, ko: '수영복', cat: '패션', q: 'one piece swimsuit' },
  { re: /\bbra|bralette|seamless top|no ?bra/i, ko: '심리스 탑', cat: '패션', q: 'seamless tank top women' },
  { re: /mood light|\blamp\b|string lights|led light|night light/i, ko: '무드 조명', cat: '조명', q: 'mood light lamp' },
  { re: /\brug\b|area rug/i, ko: '러그', cat: '생활', q: 'washable area rug living room' },
  { re: /quilt|bedding|comforter/i, ko: '퀼트 침구', cat: '생활', q: 'quilt set queen' },
  { re: /pillow/i, ko: '베개', cat: '생활', q: 'bed pillows' },
  { re: /nightstand/i, ko: '나이트스탠드', cat: '생활', q: 'slim nightstand' },
  { re: /olive tree/i, ko: '인조 올리브나무', cat: '생활', q: 'artificial olive tree' },
  { re: /legal pad|notepad/i, ko: '리갈패드', cat: '문구', q: 'colorful legal pads' },
  { re: /knife set/i, ko: '주방 칼 세트', cat: '주방', q: 'kitchen knife set' },
  { re: /utensil holder/i, ko: '수저통', cat: '주방', q: 'utensil holder' },
  { re: /slushi|blender/i, ko: '믹서/슬러시', cat: '주방', q: 'ninja slushi machine' },
  { re: /organizer|storage|bins?/i, ko: '수납 정리함', cat: '수납정리', q: 'storage organizer' },
  { re: /fan\b|ventilateur/i, ko: '선풍기', cat: '가전', q: 'portable fan' },
  { re: /microphone|\bmic\b/i, ko: '마이크', cat: '가전', q: 'wireless microphone' },
  { re: /trimmer|shaver/i, ko: '트리머', cat: '가전', q: 'body trimmer' },
  { re: /brow tint|eyebrow gel/i, ko: '브로우 틴트', cat: '뷰티', q: 'waterproof brow tint' },
  { re: /pdrn|skincare|serum|cream|moistur/i, ko: '스킨케어', cat: '뷰티', q: 'korean skincare set' },
]

function heuristicIdentify(reel) {
  const cap = reel.caption || ''
  const hit = DICT_EN.find((d) => d.re.test(cap))
  if (hit) return { nameKo: hit.ko, category: hit.cat, amazonQuery: hit.q, confidence: 0.5, note: '키워드 매칭(휴리스틱)' }
  return { nameKo: '미상 제품', category: '기타', amazonQuery: '', confidence: 0.15, note: '캡션에 제품 단서 없음 — 릴스를 직접 열어보세요.' }
}

// CLI/LLM 공용 식별 지시문
const ID_SYSTEM = `You identify the MAIN shoppable product in one Instagram shopping reel, for searching Amazon US.
The caption is often a "funnel" that hides the exact product ("comment LINK"). Infer the product from any hint.
The amazonQuery must be a SHORT keyword search of 2–3 core product words only (the noun + one defining attribute) — how a shopper actually types it. Do NOT add qualifiers like "toy", "replica", "novelty", "cheap", "cute", "viral", "gadget", or subjective adjectives; those return zero Amazon results. E.g. a tiny working phone → "mini phone", NOT "mini iPhone phone toy replica".
Output a single JSON object (no prose):
{"nameKo":"짧은 한국어 제품명","category":"패션|뷰티|주방|수납정리|조명|가전|문구|여행|생활|기타","amazonQuery":"best ENGLISH Amazon search query — 2-3 core keywords, English words only","confidence":0.0,"note":"short Korean note; if the caption truly hides the product, say so"}`

// 로컬 claude CLI 호출 — Max 구독 인증, API 키·추가 과금 없음. (공용 래퍼 cli.js + 이 모듈 기본값)
const CLI_MODEL = process.env.EXTRACT_CLI_MODEL || 'haiku'
const runClaude = (prompt, opts = {}) => cliRunClaude(prompt, { model: CLI_MODEL, timeout: 45000, ...opts })

async function cliIdentify(reel) {
  const prompt = `${ID_SYSTEM}\n\nCaption (@${reel.username || ''}): ${(reel.caption || '').replace(/\s+/g, ' ')}`
  const out = await runClaude(prompt)
  const obj = JSON.parse(stripFence(out))
  if (!obj || !obj.nameKo) throw new Error('CLI 응답 파싱 실패')
  return obj
}

async function llmIdentify(reel) {
  const system = ID_SYSTEM
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system, messages: [{ role: 'user', content: `@${reel.username || ''}: ${reel.caption || ''}` }] }),
  })
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  const text = (data.content || []).map((c) => c.text || '').join('')
  const obj = JSON.parse(stripFence(text))
  return obj
}

export async function identifyReel(reel) {
  // 1순위: 로컬 claude CLI (Max 구독, API 키·추가 과금 없음)
  let cliErr = null
  try {
    return { ...(await cliIdentify(reel)), method: 'cli' }
  } catch (e) {
    cliErr = e // ENOENT(CLI 없음)·timeout·파싱실패 → 폴백
  }
  // 2순위: API 키
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { ...(await llmIdentify(reel)), method: 'llm' }
    } catch (e) {
      return { ...heuristicIdentify(reel), method: 'heuristic', warning: 'CLI/LLM 실패 → 휴리스틱: ' + e.message }
    }
  }
  // 3순위: 휴리스틱
  const why = cliErr?.code === 'ENOENT' ? 'claude CLI·API 키 모두 없음' : 'claude CLI 오류(' + (cliErr?.message || '').slice(0, 80) + ') + API 키 없음'
  return { ...heuristicIdentify(reel), method: 'heuristic', warning: why + ' → 휴리스틱(정확도 낮음).' }
}

const normName = (s = '') => s.trim().toLowerCase().replace(/\s+/g, ' ')

// per-reel 후보 → 제품 후보로 그룹핑(같은 이름 묶고 구매의도=댓글 합산)
function groupCandidates(reels, perReel) {
  const byCode = Object.fromEntries(reels.map((r) => [r.code, r]))
  const groups = {}
  for (const pr of perReel) {
    if (!byCode[pr.code]) continue
    for (const p of pr.products || []) {
      if (!p || !p.name) continue
      const key = normName(p.name)
      if (!groups[key]) groups[key] = { name: p.name, category: p.category || '기타', codes: new Set(), confSum: 0, n: 0 }
      const g = groups[key]
      g.codes.add(pr.code)
      g.confSum += p.confidence || 0.4
      g.n++
    }
  }
  return Object.values(groups)
    .map((g) => {
      const codes = [...g.codes]
      const totalComments = codes.reduce((s, c) => s + (byCode[c]?.comments || 0), 0)
      return {
        name: g.name,
        category: g.category,
        reelCodes: codes,
        reelCount: codes.length,
        totalComments,
        avgConfidence: +(g.confSum / g.n).toFixed(2),
      }
    })
    .sort((a, b) => b.totalComments - a.totalComments)
}

export async function extractProducts(reels) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  let perReel
  let method = 'heuristic'
  let warning = null
  if (hasKey) {
    try {
      perReel = await llmExtract(reels)
      method = 'llm'
    } catch (e) {
      perReel = heuristicExtract(reels)
      warning = 'LLM 실패 → 휴리스틱 폴백: ' + e.message
    }
  } else {
    perReel = heuristicExtract(reels)
    warning = 'ANTHROPIC_API_KEY 없음 → 키워드 휴리스틱 사용 (정확도 낮음). .env 에 키 넣으면 LLM 추출.'
  }
  return { candidates: groupCandidates(reels, perReel), method, warning }
}
