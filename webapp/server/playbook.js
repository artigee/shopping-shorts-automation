// shorts-playbook 로더 — 규칙·페르소나·훅·금지어를 폴더에서 읽어 프롬프트 블록으로.
// 폴더가 소스 오브 트루스: personas.yaml / hooks.yaml / banlist.txt / references/*.md 를
// 고치면 webapp 생성 결과가 바로 바뀐다 (코드 수정 X).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLAYBOOK_DIR = path.resolve(process.env.PLAYBOOK_DIR || path.join(__dirname, '../../shorts-playbook'))

export function playbookReady() { return fs.existsSync(path.join(PLAYBOOK_DIR, 'SKILL.md')) }

function readText(rel) { try { return fs.readFileSync(path.join(PLAYBOOK_DIR, rel), 'utf8') } catch { return '' } }
function readYaml(rel) { try { return parseYaml(readText(rel)) || {} } catch { return {} } }

// ── 페르소나 라이브러리 ──
export function getPersonas() {
  const y = readYaml('data/personas.yaml')
  return Object.entries(y).map(([key, v]) => ({ key, ...v }))
}
export function getPersona(key) {
  if (!key) return null
  const y = readYaml('data/personas.yaml')
  return y[key] ? { key, ...y[key] } : null
}

// ── 훅/스토리텔링 라이브러리 ──
export function getHooks() {
  const y = readYaml('data/hooks.yaml')
  return Object.entries(y).map(([key, v]) => ({ key, ...v }))
}
export function getHook(key) {
  if (!key) return null
  const y = readYaml('data/hooks.yaml')
  return y[key] ? { key, ...y[key] } : null
}

// 이미지/클립 비주얼 규칙 — references/image-rules.md 를 그대로 주입(소스 오브 트루스). 파일 편집이 곧 생성 규칙.
export function imageRulesBlock() {
  const md = readText('references/image-rules.md')
  return md && md.trim() ? `\n[VISUAL RULES — follow ALL of these; the product/text/person/emotion policy is authoritative]\n${md.trim()}\n` : ''
}

// ── VO speaking styles (how the persona paces the line; layered on persona) ──
export function getVoStyles() {
  const y = readYaml('data/vo-styles.yaml')
  return Object.entries(y).map(([key, v]) => ({ key, ...v }))
}
export function getVoStyle(key) {
  if (!key) return null
  const y = readYaml('data/vo-styles.yaml')
  return y[key] ? { key, ...y[key] } : null
}

// ── 카메라 무빙 (image→video 클립) ──
export function getCameraMoves() {
  const y = readYaml('data/camera-moves.yaml')
  return Object.entries(y).map(([key, v]) => ({ key, ...v }))
}
export function getCameraMove(key) {
  if (!key) return null
  const y = readYaml('data/camera-moves.yaml')
  return y[key] ? { key, ...y[key] } : null
}

// ── 금지어 ──
export function getBanlist() {
  return readText('data/banlist.txt')
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

// ── 프롬프트 블록 ──
// 페르소나: 라이브러리 키면 풍부한 스펙, 자유 텍스트면 그대로.
export function personaBlock(personaKeyOrText) {
  const p = getPersona(personaKeyOrText)
  if (!p) {
    const t = (personaKeyOrText || '').trim()
    return t
      ? `\n[PERSONA — the single voice for ALL voiceover]\n${t}\n`
      : `\n[PERSONA] a been-burned skeptic who is now quietly a little obsessed — deadpan, dry, specific.\n`
  }
  const list = (a) => (Array.isArray(a) && a.length ? a.map((x) => `  - ${x}`).join('\n') : '  - (none)')
  return `\n[PERSONA — the single voice for ALL voiceover]
Name: ${p.name}
Register: ${p.register || ''}
Voice: ${(p.voice || '').trim()}
Idioms they actually use:\n${list(p.idiom_markers)}
They NEVER say:\n${list(p.never_says)}
Dollar/value framing: ${p.dollar_reference_style || ''}
Example lines (match this exact voice):\n${list(p.example_lines)}\n`
}

// 스피킹 스타일 — 페르소나(누구)는 그대로 두고, 문장의 호흡/구조(어떻게)만 얹는다.
// 프리셋 키 + 자유 텍스트 refine 을 합쳐 하나의 지시 블록으로. 둘 다 없으면 빈 문자열.
export function voStyleBlock(styleKeyOrText, note) {
  const s = getVoStyle(styleKeyOrText)
  const preset = s ? (s.directive || '').trim() : (String(styleKeyOrText || '').trim())
  const refine = (note || '').trim()
  if (!preset && !refine) return ''
  return `\n[SPEAKING STYLE — how the persona paces the VO (keeps the persona's attitude; only changes the delivery)]\n${preset}${preset && refine ? '\n' : ''}${refine ? 'Also: ' + refine : ''}\n`
}

// 훅/스토리텔링 셰이프 — 지정 안 하면 LLM이 가장 잘 맞는 훅을 직접 고르게 (훅 크래프트는 항상 적용)
export function hookBlock(hookKey) {
  const h = getHook(hookKey)
  if (!h) {
    const names = getHooks().map((x) => x.name).filter(Boolean)
    return `\n[HOOK / STORYTELLING SHAPE — none preset; CHOOSE the strongest one for this product and apply it]
Available shapes: ${names.join(', ') || 'disbelief reveal, problem-agitate-solve, before/after, price-shock, curiosity gap, myth-bust'}.
Pick the one that best fits this product, then build the short around its energy arc. Scene 1 must execute that hook hard.\n`
  }
  return `\n[HOOK / STORYTELLING SHAPE — apply this exactly]
Shape: ${h.name}
When it fits: ${h.when_to_use || ''}
Energy ARC (each line a DIFFERENT energy): ${h.arc || ''}
VO shape: ${(h.vo_guidance || '').trim()}
Caption style: ${h.caption_style || ''}\n`
}

// 금지어 블록
export function banBlock() {
  const ban = getBanlist()
  if (!ban.length) return ''
  return `\n[VO BAN-LIST — these clichés are FORBIDDEN in any voiceover OR caption line; if tempted, rewrite]: ${ban.join(', ')}.`
}

// 크래프트 규칙 (references 핵심 파일 주입 — 폴더가 권위, 프롬프트는 가볍게)
export function rulesBlock() {
  // 파일 전체를 주입 (예전 2200자 컷은 storytelling.md의 대부분 — arc·훅·시그니처 규칙 — 을 잘라먹었다). 파일이 곧 규칙 다이얼.
  const parts = [readText('references/vo-rules.md'), readText('references/title-rules.md'), readText('references/storytelling.md'), readText('references/english-style.md')]
    .map((s) => s.trim().slice(0, 9000)).filter(Boolean)
  if (!parts.length) return ''
  return `\n[SHORTS-PLAYBOOK RULES — follow these exactly]\n${parts.join('\n\n---\n\n')}\n`
}

// ── 콘텐츠 모드 라이브러리 ──
export function getContentModes() {
  const y = readYaml('data/content-modes.yaml')
  return Object.entries(y).map(([key, v]) => ({ key, ...v }))
}
export function getContentMode(key) {
  if (!key) return null
  const y = readYaml('data/content-modes.yaml')
  return y[key] ? { key, ...y[key] } : null
}

// 콘텐츠 모드 + 클레임 안전 가드레일 — 스크립트가 "말해도 되는 범위"를 고정한다.
// mode 미지정 시 안전 기본값(Curated Find)으로 강제. hasFootage=true여야 Direct Review 허용.
export function contentSafetyBlock(mode, { hasFootage = false } = {}) {
  const m = getContentMode(mode)
  const safe = m && (m.default_safe || (m.requires_footage && hasFootage))
  const active = safe ? m : (getContentMode('curated_find') || { key: 'curated_find', label: 'Curated Find', allow: ['trending', 'worth checking'], ban: ['I used', 'it fixed', 'guaranteed'] })
  const ref = readText('references/content-safety.md').trim().slice(0, 1800)
  return `\n[CONTENT MODE — ${active.label} (${active.key})]\nThis mode restricts WHAT YOU MAY CLAIM — it does NOT restrict HOW YOU SPEAK. NEVER claim: ${(active.ban || []).join(', ')}.\n[CLAIM SAFETY ≠ VOICE SAFETY — the most important distinction]\n- CLAIMS: no medical/treatment verbs, no guaranteed outcomes, no first-person RESULT claims ("it fixed my skin") unless Direct Review is active${!hasFootage ? ' (it is NOT — no first-hand footage attached)' : ''}.\n- VOICE: stay 100% in the persona — warm, first-person, conversational, spoken-out-loud. First-person CURIOSITY and DISCOVERY are always allowed and encouraged: "I looked it up", "I keep seeing this everywhere", "okay now I'm suspicious", "I wasn't going to care, and then—". Only first-person RESULTS are off-limits.\n- HEDGING lives INSIDE the persona's voice, never as corporate reportage. BANNED detached phrasings: "people are saying", "people are discussing", "users report", "it is marketed as", "boards keep landing here", "make of that what you will". Instead hedge the way a friend would: "supposedly", "if the reviews are honest", "every routine I checked had it — which is either a coincidence or it isn't".\n- Delete-test: read each line out loud — if it sounds like a news anchor or a product page instead of the persona talking to a friend, rewrite it in the persona's mouth WITHOUT strengthening the claim.\nKeep the reference reel's FUNCTION but change wording/visuals/persona/framing — an Inspired Structure Script, never a copy.\n${ref ? '[CONTENT-SAFETY REFERENCE]\n' + ref + '\n' : ''}`
}
