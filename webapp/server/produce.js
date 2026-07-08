// 콘텐츠 제작 — 릴스 분석(설계도) + 선택 제품 → ① 전체 스크립트 → ② 씬 스크립트 (Claude CLI).
// 핵심: 원본 릴스의 "구조"만 이해해 빌리고, 카피는 선택 제품으로 "새로" 작성 (복붙 금지).
import { runClaude as cliRunClaude, runClaudeJson, stripFence } from './cli.js'
import { personaBlock, voStyleBlock, hookBlock, banBlock, rulesBlock, contentSafetyBlock, imageRulesBlock, getBanlist, getPersona } from './playbook.js'

const CLI_MODEL = process.env.PRODUCE_CLI_MODEL || 'sonnet' // 스크립트 품질 → sonnet

// 공용 래퍼(cli.js)에 이 모듈의 기본값(sonnet, 240s, 한국어 타임아웃 안내)만 입힌 별칭
const runClaude = (prompt, opts = {}) => cliRunClaude(prompt, {
  model: CLI_MODEL, timeout: 240000,
  timeoutMsg: 'claude CLI 응답 시간 초과 — 다시 [씬 분해] 눌러주세요 (스크립트 프롬프트가 길어 가끔 느립니다).',
  ...opts,
})
// JSON 응답 표준형(재시도+균형추출+검증·수리) — 모든 JSON 스테이지가 이걸 쓴다
const runJson = (prompt, opts = {}) => runClaudeJson(prompt, {
  model: CLI_MODEL, timeout: 240000, retries: 2,
  timeoutMsg: 'claude CLI 응답 시간 초과 — 다시 시도해주세요.',
  ...opts,
})
// ── 스킬 검증 (check_vo.py의 규칙을 JS로: ban-list + VO가 Title을 재진술하지 않기) ──
const VO_STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'it', 'is', 'this', 'that', 'your', 'you', 'with', 'for', 'into', 'just', 'one', 'no', 'i', 'my', 'me', 'at', 'its', 'then', 'now', 'up'])
function contentWords(t = '') { return (String(t).toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => !VO_STOP.has(w) && w.length > 1) }
function noveltyRatio(caption, vo) { const cap = new Set(contentWords(caption)); const v = contentWords(vo); if (!v.length) return 1; return v.filter((w) => !cap.has(w)).length / v.length }
// 페르소나 시그니처(관용구/예시 라인)를 그대로(4단어+ 연속) 베꼈는지 — 룰10을 하드 가드로 강제.
const normTell = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
function reusedPersonaTell(vo, tells, minN = 4, minLen = 10) {
  const v = normTell(vo)
  for (const tell of tells) {
    const tw = normTell(tell).split(' ')
    for (let n = Math.min(7, tw.length); n >= minN; n--) {
      for (let i = 0; i + n <= tw.length; i++) {
        const gram = tw.slice(i, i + n).join(' ')
        if (gram.length >= minLen && v.includes(gram)) return gram
      }
    }
  }
  return null
}
// 전체 스크립트(overall) 검증 — 씬과 같은 게이트를 원류(모놀로그)에도 적용
function validateOverall(o, banlist, personaTells = []) {
  const fails = []
  for (const [k, t] of Object.entries({ hookLine: o.hookLine, vo: o.vo, title: o.title, cta: o.cta })) {
    if (!t) continue
    const banned = banlist.filter((p) => String(t).toLowerCase().includes(p))
    if (banned.length) fails.push(`${k} contains banned phrase(s) [${banned.join(', ')}] — rewrite without them`)
  }
  if (!String(o.vo || '').trim()) fails.push('vo (the monologue) is empty — it is required')
  if (!String(o.hookLine || '').trim()) fails.push('hookLine is empty — it is required')
  const tell = personaTells.length ? reusedPersonaTell(o.vo || '', personaTells, 5, 20) : null   // 긴 모놀로그: 진짜 시그니처(5단어+·20자+)만
  if (tell) fails.push(`the vo reuses the persona's signature phrase ("${tell}") verbatim — express it fresh`)
  return fails.length ? fails.join(' · ') : null
}
function validateScenes(scenes, banlist, threshold = 0.35, personaTells = []) {
  const fails = []
  scenes.forEach((s, i) => {
    const cap = s.onScreenText || '', vo = s.vo || ''
    const banned = [...new Set([cap, vo].flatMap((txt) => banlist.filter((p) => String(txt).toLowerCase().includes(p))))]
    if (banned.length) fails.push(`scene ${i + 1}: banned phrase(s) [${banned.join(', ')}] — rewrite without them.`)
    if (cap && vo) { const nov = noveltyRatio(cap, vo); if (nov < threshold / 2) fails.push(`scene ${i + 1}: the VO just restates the title (only ${Math.round(nov * 100)}% new words) — rewrite the VO to REACT / reveal the mechanism, not narrate. title="${cap}" vo="${vo}"`) }
    const tell = personaTells.length ? reusedPersonaTell(vo, personaTells) : null
    if (tell) fails.push(`scene ${i + 1}: the VO reuses the persona's signature phrase ("${tell}") verbatim — that's a generic tell (see rule 10). Express this beat a COMPLETELY fresh way; do not lean on the persona's example/idiom lines. vo="${vo}"`)
  })
  return fails
}

function productLine(productName, product) {
  if (product?.title) {
    const link = product.source === 'amazon' ? ' (아마존 실제 판매 제품 — 이 제품 기준)' : ' (원본 릴스의 제품)'
    return `${product.title}${link}`
  }
  return productName || '(미지정 — 일반 제품)'
}

// 사용자 지시(가이드) 블록 — guided regeneration
function guideBlock(base, guidance, label) {
  if (!guidance) return ''
  return `
[현재 ${label} — 이걸 기준으로 수정]
${JSON.stringify(base || {}).slice(0, 3000)}

[수정 지시 — 반드시 최우선 반영]
${guidance}
(위 현재 버전을 이 지시대로 고쳐 다시 작성하세요. 지시와 무관한 부분은 톤·구조를 유지.)
`
}

// 씬 VO(한국어)를 자연스러운 US 영어 쇼츠 나레이션으로 번역 (US 마켓)
export async function translateVO(koText) {
  if (!koText || !koText.trim()) return ''
  const out = await runClaude(`Translate this Korean short-form ad voiceover line into natural, punchy US English spoken voiceover. Output ONLY the English line, no quotes, no explanation:\n${koText}`, { model: 'haiku', timeout: 60000 })
  return stripFence(out).trim().replace(/^["']|["']$/g, '')
}

// 바이럴 보이스 반영 — 원본 릴스가 "어떻게 들렸는지"(목소리·리듬·에너지)를 예시로 주입.
// 구조만 빌리고 에너지를 버리던 갭을 메운다. 단어/제품명 복사는 금지 (사운드 예시일 뿐).
function viralVoiceBlock(analysis) {
  if (!analysis) return ''
  const v = analysis.voice || {}, st = analysis.structure || {}
  const lines = (Array.isArray(analysis.sceneScript) ? analysis.sceneScript : []).map((x) => x && (x.vo || x.voiceover || x.text)).filter(Boolean).slice(0, 5)
  const parts = []
  if (v.persona || v.register) parts.push(`voice: ${[v.persona, v.register].filter(Boolean).join(' · ')}`)
  if (st.pacing) parts.push(`pacing/rhythm: ${st.pacing}`)
  if (lines.length) parts.push(`how its VO actually SOUNDS (energy exemplars — match the RHYTHM, warmth and spoken-ness; NEVER reuse its words or its products):\n${lines.map((l) => `  "${String(l).replace(/"/g, "'").slice(0, 140)}"`).join('\n')}`)
  if (!parts.length) return ''
  return `\n[VIRAL VOICE — the reference reel went viral SOUNDING like this. Your script must carry the same energy and rhythm in the persona's own words. Sound exemplar only, not a content source:]\n${parts.join('\n')}\n`
}

// 최종 보이스 체크 — 페르소나·스피킹 스타일을 "이름으로" 다시 세우고, 스타일이 케이던스를 소유하게 한다.
// (예전 정적 버전의 "2-5단어 펀치" 지시가 모든 스타일을 같은 클립트 톤으로 수렴시키는 원인이었다)
const voiceCheck = (persona, voStyle) => `[FINAL VOICE CHECK — do this before you output] Read every vo line OUT LOUD in your head — this is an ACTOR ON CAMERA talking to ONE viewer${persona ? ` as "${persona}"` : ''}${voStyle ? `, speaking in the "${voStyle}" style` : ''}.
(1) TO THE VIEWER: it must sound said TO them — "you" appears naturally, anticipate what they're thinking, react to them. Inner-diary narration ("I looked into…", "I went and checked") without the viewer in the room fails.
(2) THE STYLE OWNS THE CADENCE: rhythm, pace and sentence shapes come from the speaking style${voStyle ? ` ("${voStyle}")` : ''} — a flowing/story style keeps long warm connected sentences (zero forced fragments); a punchy/hype style leans into fragments. Do NOT default every script to the same clipped deadpan cadence.
(3) If any line reads like written description, a news anchor, or a fact sheet, rewrite it as speech at the same claim level.`

const directionBlock = (d) => (d && d.trim() ? `\n[DIRECTION — apply this creative direction throughout]\n${d.trim()}\n` : '')

// VO/타이틀 크래프트는 shorts-playbook 폴더에서 읽어온다 (personaBlock/hookBlock/banBlock/rulesBlock).
const VO_ARC = 'disbelief → mechanism reveal → anti-climax/ease → earned payoff → casual close (each line a DIFFERENT energy)'

// ③ 전체 스크립트 — 구조만 빌려 선택 제품으로 새로 작성 (복붙 금지). US 마켓 → 영어로 작성.
export async function generateOverall({ analysis, productName, product, base, guidance, direction, persona, voStyle, voStyleNote, hook, contentMode, hasFootage = false, prevShotCount = null, lang = 'English (US, American audience)' }) {
  const prompt = `You are a top short-form (Instagram Reels/TikTok) ad copywriter for the ${lang} market.
KEEP the original reel's STRUCTURE only — hook archetype, beat order, pacing, CTA mechanic. DISCARD the original's exact words (its captions and voiceover); never copy its sentences. On that skeleton write a COMPLETELY NEW shorts script that sells [My product], natively in ${lang} — idioms, rhythm, regional nuance native to that audience; do NOT translate from another language.
This OVERALL script is the product's story/context. The single most important field is "vo".
[VO = the through-line] Write "vo" as ONE continuous spoken monologue in the PERSONA below — one person thinking out loud, moving through the energy ARC: ${VO_ARC}. REACT and reveal the mechanism; do NOT just explain or list features. Specific sensory detail and real numbers, never generic ad language.
This is the FULL story / context — it may be richer and longer than the final short. Write it complete and good; the SCENE step will distill it down to fit the video length. Do NOT pre-truncate here.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${rulesBlock()}${contentSafetyBlock(contentMode, { hasFootage })}
${guideBlock(base, guidance, 'overall script')}${viralVoiceBlock(analysis)}
[Reel analysis (structure reference only)]
${JSON.stringify(analysis).slice(0, 6500)}

[My product]
${productLine(productName, product)}

Rules (all text in English):
- angle: one line for the new narrative angle (e.g. "problem→solution", "before/after", "you're doing it wrong").
- hookLine: THE most important line — the 0-2s cold open that must be genuinely INTERESTING and impossible to scroll past. It hooks the VIEWER's own pain/desire ('your moisturizer pills under sunscreen') — NEVER the creator's feed ('my algorithm keeps showing me…' / 'I keep seeing this' = navel-gazing, fail). Use a bold claim, a sharp contradiction, a specific number, or a relatable pain that opens a loop the viewer NEEDS closed. Be concrete — name or evoke the real thing. BANNED weak openers: vague "I did not believe X was real / existed", "Everyone does X" generalities, anything a viewer can't picture in 1 second. If the hook wouldn't stop YOUR thumb, rewrite it.
- beats: 4-7 items, one line each. CHOOSE the structure that makes THIS product's short most scroll-stopping and DM-driving — there's no fixed template (see rule 3b for proven shapes: demo arc, before/after, myth-bust, curiosity reveal, social proof, POV). Match it to the reel's own structure + the chosen hook. Non-negotiable: (1) open with a genuinely gripping hook, (2) don't dump the product or blow the payoff in the first beats — the product earns its entrance and the result is the reward, (3) last beat = CTA.
- vo: the full voiceover as ONE continuous persona monologue (see [VO = the through-line] above) — the through-line that scenes will later slice. NOT a paragraph that explains the beats.
- cta: the final call to action (comment keyword → link funnel).
- durationSec: total video length in seconds — DEFAULT to the reference reel's length${Number(analysis?._meta?.duration) > 0 ? ' (~' + Math.round(analysis._meta.duration) + 's)' : ''}; only deviate if the story clearly needs it, and keep it in the 12-40s range.
- shotCount: the number of SHOTS this short should have, chosen for MAXIMUM impact — NOT a default.${prevShotCount ? ` STABILITY ANCHOR: the current plan uses ${prevShotCount} shots — KEEP ${prevShotCount} unless THIS story structurally demands a different count (a beat genuinely missing or genuinely redundant). Do not change it for stylistic preference; count-flapping between runs is a failure.` : ''} Decide it from THIS story: how many DISTINCT beats it truly needs, the reel's pacing (fast cuts → more shots; slow/lingering → fewer), and the durationSec above. Range 3-9: a simple/punchy story folds roles into as few as 3 (hook+product+CTA); a rich or fast-cut one expands up to 9. The last shot is always the CTA. Do NOT default to 5 — justify the number by the beats.
- shotCountWhy: one short line — why that count fits this story.

- hookOptions: THREE genuinely different hook lines (lean a different way each: bold claim / sharp contradiction / specific number / relatable pain). hookLine must be the strongest of the three.

${voiceCheck(persona, voStyle)}

Output ONLY JSON (no explanation):
{"angle":"...","title":"...","hookLine":"...","hookOptions":["...","...","..."],"durationSec":25,"shotCount":5,"shotCountWhy":"...","beats":["...","..."],"vo":"...","cta":"..."}`
  const banlistO = getBanlist().map((b) => b.toLowerCase())
  const pO = getPersona(persona), tellsO = pO ? [...(pO.idiom_markers || []), ...(pO.example_lines || [])] : []
  return await runJson(prompt, {
    validate: (j) => (!j || typeof j !== 'object' || Array.isArray(j)) ? 'output must be a single JSON object' : validateOverall(j, banlistO, tellsO),
  }).catch((e) => { throw new Error('전체 스크립트 생성 실패 — 다시 [생성] 눌러주세요. (' + (e.message || e) + ')') })
}

// ④ 씬 스크립트 — (편집됐을 수 있는) 전체 스크립트를 씬 단위로 분해 + 씬별 이미지 프롬프트. guidance 있으면 그 지시대로 수정.
// 가중치(weight) → 실제 초(durationSec) 분배. 총합 = totalSec, 각 [min,max] 클램프, 정수, 나머지 분배로 합 맞춤.
export function allocateDurations(weights, totalSec, min = 2, max = 10) {
  const n = weights.length
  if (!n) return []
  const w = weights.map((x) => (Number(x) > 0 ? Number(x) : 1))
  const sumW = w.reduce((a, b) => a + b, 0) || n
  const total = Math.max(min * n, Math.min(max * n, Math.round(Number(totalSec) || min * n)))
  const f = w.map((x) => Math.max(min, Math.min(max, total * x / sumW)))     // 클램프된 실수 배분
  const d = f.map((x) => Math.max(min, Math.min(max, Math.round(x))))
  const order = f.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac).map((o) => o.i)   // 반올림 나머지 큰 순
  let diff = total - d.reduce((a, b) => a + b, 0), guard = 0
  while (diff !== 0 && guard++ < 500) {
    let moved = false
    for (const i of order) {
      if (diff === 0) break
      if (diff > 0 && d[i] < max) { d[i]++; diff--; moved = true }
      else if (diff < 0 && d[i] > min) { d[i]--; diff++; moved = true }
    }
    if (!moved) break
  }
  return d
}

export async function generateScenes({ analysis, productName, product, overall, base, guidance, direction, shotCount, persona, voStyle, voStyleNote, hook, contentMode, hasFootage = false, lang = 'English (US, American audience)' }) {
  // 샷 수: 사용자가 지정하면 그대로, 아니면 Script Engine(overall)이 스토리 기반으로 정한 추천 수, 없으면 3-9 판단.
  const recCount = Number(overall?.shotCount) || 0
  const countRule = shotCount
    ? `Produce EXACTLY ${shotCount} scenes`
    : (recCount >= 3 && recCount <= 12)
      ? `Produce EXACTLY ${recCount} scenes — the plan chose this shot count for THIS story${overall?.shotCountWhy ? ' (' + overall.shotCountWhy + ')' : ''}`
      : 'Produce 3-9 scenes — choose the count that best fits the beats and pacing; do NOT default to 5'
  const reelLen = Math.round(Number(analysis?._meta?.duration) || 0)
  const totalSec = Math.round(Number(overall?.durationSec) || reelLen || 22)   // 목표 총 길이 = overall(=릴스 길이 기본)
  const reelBeats = (analysis?.sceneScript || []).map((s, i) => `${s.t || 'beat ' + (i + 1)}≈${s.durationSec || '?'}s`).join(', ')
  const reelPacing = analysis?.structure?.pacing || ''
  const prompt = `You are CRAFTING an impactful ${lang}-market shopping short — you are NOT splitting text into N pieces.
The [Overall script] is your STORY SOURCE: the full narration (facts, persona voice, the beats). Use it as material, but do NOT chop its monologue into shots. From [Structure reference] keep only the skeleton (beat order, pacing, shot types, CTA mechanic); discard the original's words.
APPLY the chosen HOOK shape and the SHORTS-PLAYBOOK storytelling rules below to BUILD the short: open with a scroll-stopping hook, create tension, land ONE clean turn, pay it off, exit casual. SELECT and SHARPEN the strongest beats from the story — write fresh, tight, ear-catching scene VO + titles. The short is TIGHTER than the full narration; compress hard. ALL text natively in ${lang}.
Each scene is ONLY a Title and a VO line — do NOT write any shot/visual/image description here; the visuals are decided later at the image stage.
STRONG STORY RULE: the AI image/video can't show transformations (folding, unfolding, assembling, setting up). So build the story around STATES and results — "already set up in 40 seconds", "packs into one bag", before/after — NOT around watching the product fold/unfold/assemble. The VO can SAY the setup is fast; just don't make a beat depend on SHOWING the act.

[VO vs TITLE — the most important craft rule]
- vo (per scene) = a FRESH, tight, SPOKEN line in the PERSONA — DISTILLED from the story, NOT a verbatim slice of the long monologue. It REACTS / reveals the mechanism "aha" / gives sensory or number texture. Across scenes the vo lines form the ARC: ${VO_ARC}.
- onScreenText (per scene) = the on-screen TITLE: a SHORT punchy claim or spec (<= ~5 words) that carries the FACT.
- SAME BEAT: the title and its vo are TWO ANGLES ON ONE MOMENT — the vo reacts to / deepens the title's fact. They must NOT be about different topics. ❌ title "No purge. Barrier held." + vo "the bad-review posts are just harder to find" (two unrelated ideas, and it sounds like hiding complaints). ✅ title "No purge. Barrier held." + vo "Three weeks in. Still waiting for the flare-up." (same beat, reacts).
- TITLE and VO must NEVER say the same thing. TEST: delete the vo — if the title still delivers the same info, the vo FAILED; rewrite it to react, not narrate. Do NOT inflate the title back into a full sentence.
- EAR-CATCHING (see storytelling rules): line 1 is a cold open that lands in 1.5s (no "so/okay so"). VARY line length — at least TWO vo lines are short 2-5 word fragments. One clean TURN. Cut filler. Keep each line short enough to actually say within its scene's seconds.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${rulesBlock()}${contentSafetyBlock(contentMode, { hasFootage })}
${directionBlock(direction)}${guideBlock(base, guidance, 'scene script')}
[Overall script]
${JSON.stringify(overall).slice(0, 3000)}

[My product]
${productLine(productName, product)}

${viralVoiceBlock(analysis)}[Structure reference]
${JSON.stringify(analysis?.structure || analysis).slice(0, 2200)}

[DURATION PLAN — you give a WEIGHT per shot; the app computes the seconds]
- Give each scene a "weight" (~0.5-2.0): how much SCREEN TIME this shot deserves vs the others — judged by its ROLE (hook = punchy/low; setup/connective = low; the reveal/turn and the payoff = high; CTA = slightly high), the HOOK shape, the PERSONA's cadence, and the reel's PACING, NEVER an even split.${reelPacing ? ' Reel pacing: ' + reelPacing + '.' : ''}${reelBeats ? ' Reel beat lengths: ' + reelBeats + '.' : ''} Do NOT output seconds — only the relative weight.
- The app turns weights into actual seconds summing to ≈${totalSec}s (clamped 2-10s each). Write each scene's VO to fit its SHARE ≈ ${totalSec} × weight ÷ (sum of weights) seconds of speech (~2.5 words/second): heavier shots get more words; the hook and connective shots are terse.

Rules:
- ${countRule}. If the count is very small (1-3), FOLD roles together — 1 scene = hook + product + CTA in one; 2-3 scenes = combine beats. Scene 1 = the HOOK (apply the hook shape). The LAST scene MUST be the CTA: its onScreenText is the comment keyword caption (e.g. "Comment WANT IT 👇") AND its vo IS the spoken ask — casually tell the viewer to comment the keyword to get the link (e.g. "Comment WANT IT and I'll send it your way" / "Say the word, it's in your DMs"). Do NOT make the last vo just a verdict/sign-off with no ask — the spoken CTA must be there (casual, not a hard sell). SELECT and SHARPEN the strongest beats from the story across exactly this many shots — compress, don't transcribe.
- Each scene field (TEXT ONLY — no visuals):
  weight: relative pacing weight per the DURATION PLAN above (a number ~0.5-2.0; the app converts it to seconds)
  onScreenText: on-screen TITLE — short claim/spec (<= ~5 words), carries the FACT, NEVER the same as vo
  vo: a FRESH tight spoken line distilled from the story (NOT a verbatim slice) — reacts / reveals mechanism / sensory; in persona; length fits its weight's share; DIFFERENT job than the title
  emotion: this beat's emotional tone / the creator's FACIAL EXPRESSION for this shot, concrete and SPECIFIC to this line (e.g. "narrow-eyed doubt", "small surprised recalibration", "quiet relief", "warm conspiratorial invite") — it MUST differ across scenes, not the same expression every time
  purpose: this scene's role in the flow (hook / build / turn / proof / CTA)
  shot: the camera framing for this beat (angle · distance · movement), distinct from the other scenes (e.g. "tight UGC selfie, low angle", "over-the-shoulder at a desk", "hands-only macro on skin")

- FTC disclosure (required, US affiliate): the LAST scene's onScreenText must carry a short clear disclosure — append " · #ad" (or "Commissions earned"). It is literal text, exempt from the persona voice and the ban-list.

${voiceCheck(persona, voStyle)}

Output ONLY a JSON array (no explanation):
[{"weight":1.0,"onScreenText":"...","vo":"...","emotion":"...","purpose":"...","shot":"..."}]`
  const runParse = (pr) => runJson(pr, { array: true, validate: (j) => (Array.isArray(j) && j.length) ? null : 'output must be a non-empty JSON array of scenes' }).catch(() => null)
  let scenes = await runParse(prompt)
  if (!scenes) throw new Error('씬 스크립트 응답 파싱 실패 — 다시 [재생성] 눌러주세요.')
  // 스킬 검증 루프 — ban-list + VO≠Title(react-don't-narrate). 실패 라인만 지목해 재작성(최대 2회).
  const banlist = getBanlist().map((p) => p.toLowerCase())
  const pObj = getPersona(persona), personaTells = pObj ? [...(pObj.idiom_markers || []), ...(pObj.example_lines || [])] : []
  for (let attempt = 0; attempt < 2; attempt++) {
    const fails = validateScenes(scenes, banlist, 0.35, personaTells)
    if (!fails.length) break
    const fixed = await runParse(`${prompt}\n\n[GUARDRAIL FAILED on your previous output — FIX ONLY these lines, keep every other scene exactly as-is, and re-output the SAME full JSON array]:\n${fails.join('\n')}`)
    if (!fixed) break
    scenes = fixed
  }
  ensureFtcOnLast(scenes)
  // 가중치 → 실제 초 분배 (총합 = totalSec) + 타임코드
  const durs = allocateDurations(scenes.map((s) => s.weight), totalSec, 2, 10)
  let acc = 0
  return scenes.map((s, i) => { const d = durs[i] || 2, t = `${acc}-${acc + d}s`; acc += d; return { id: i + 1, makeVideo: false, ...s, weight: Number(s.weight) || 1, durationSec: d, t } })
}

// 한 씬의 스크립트(Title + VO)만 재생성 — overall(input) + instruction(guidance) 기반, 나머지 씬과 겹치지 않게
export async function generateSceneScript({ overall, product, productName, scenes = [], sceneIndex = 0, sceneTotal = 1, persona, voStyle, voStyleNote, hook, contentMode, hasFootage = false, guidance, durationSec, lang = 'English (US, American audience)' }) {
  const isFirst = sceneIndex === 0, isLast = sceneTotal > 1 && sceneIndex === sceneTotal - 1
  const dur = Number(durationSec) > 0 ? Number(durationSec) : null
  const durRule = dur ? `\n[DURATION — the VO must fit ${dur}s of natural speech: about ${Math.max(3, Math.round(dur * 2.6))} words MAX. Write the vo to be comfortably sayable within ${dur} seconds; do not exceed it.]` : ''
  const roleRule = isLast
    ? 'This is the CTA scene (last): onScreenText = the comment-keyword caption (e.g. "Comment WANT IT 👇"); vo = the spoken casual ask to comment the keyword for the link (not a hard sell, and NOT just a sign-off).'
    : isFirst ? 'This is the HOOK scene (scene 1): apply the hook shape — a scroll-stopping cold open that lands in ~1.5s.'
      : 'A middle beat — select and sharpen the single strongest beat for this position in the arc.'
  const others = scenes.map((s, i) => i === sceneIndex ? `[${i + 1}] ← THIS scene (the one you rewrite)` : (s.onScreenText || s.vo) ? `[${i + 1}] title:"${s.onScreenText || ''}" vo:"${s.vo || ''}"` : `[${i + 1}] (not written yet)`).join('\n')
  // 비트 맵 — 단독 재생성(형제 씬이 비어 있어도) 이 씬이 어느 비트를 맡는지 알게 한다
  const beats = Array.isArray(overall?.beats) ? overall.beats : []
  const beatMap = beats.length ? `\n[BEAT MAP — the overall's beats in order. Scene ${sceneIndex + 1} of ${sceneTotal} carries the beat at its position in this arc — write THAT beat, not a random one]\n${beats.map((b, k) => `  ${k + 1}. ${b}`).join('\n')}` : ''
  const prompt = `You are crafting ONE scene of a ${lang}-market shopping short. Rewrite ONLY scene ${sceneIndex + 1} of ${sceneTotal} — its on-screen Title and spoken VO — distilled from the overall story, keeping the arc and NOT duplicating the other scenes. ALL text natively in ${lang}.
${roleRule}
[VO vs TITLE — the key rule] onScreenText = a SHORT punchy claim/spec (<= ~5 words) that carries the FACT. vo = a FRESH tight spoken line in the PERSONA that REACTS / reveals the mechanism — it must NEVER restate the title. Delete-test: if the title alone conveys the vo, rewrite the vo.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${rulesBlock()}${contentSafetyBlock(contentMode, { hasFootage })}${durRule}
${guidance && guidance.trim() ? '[INSTRUCTION — honor this above all] ' + guidance.trim() : ''}
[Overall story]
${JSON.stringify(overall).slice(0, 2600)}${beatMap}
[My product] ${productLine(productName, product)}
[All scenes — context, keep THIS one distinct]
${others}
Also give this beat's "emotion" (the creator's concrete facial expression for this shot — specific to this line, different from the other scenes) and "purpose" (its role in the flow).
${voiceCheck(persona, voStyle)}
Output ONLY JSON: {"onScreenText":"...","vo":"...","emotion":"...","purpose":"..."}`
  const banlistS = getBanlist().map((b) => b.toLowerCase())
  const pS = getPersona(persona), tellsS = pS ? [...(pS.idiom_markers || []), ...(pS.example_lines || [])] : []
  const j = await runJson(prompt, {
    validate: (x) => {
      if (!x || (!x.onScreenText && !x.vo)) return 'output must be a JSON object with onScreenText and vo'
      const fails = validateScenes([x], banlistS, 0.35, tellsS)
      return fails.length ? fails.join(' · ') : null
    },
  }).catch((e) => { throw new Error('씬 스크립트 생성 실패 (' + (e.message || e) + ')') })
  return { onScreenText: j.onScreenText || '', vo: j.vo || '', emotion: j.emotion || '', purpose: j.purpose || '' }
}

// 씬 1개의 이미지 프롬프트(영어) 생성 — 씬 스크립트는 Title+VO만 있으므로 여기서 비주얼을 정한다. 빠르게 haiku.
export async function generateImagePrompt({ scene = {}, productName, product, style, sceneIndex = 0, sceneTotal = 1, guidance, cosmetic = false, hasCharacterRef = false, elementNames = [], siblingTitles = null, demeanor = '', lang = 'English (US)' }) {
  const named = (Array.isArray(elementNames) ? elementNames : []).filter(Boolean)
  // 명명 캐릭터 element(들) — 이름으로 부르고, 외모는 절대 서술 금지(레퍼런스 element가 정체성 정의). 2명 이상이면 상호작용 구성.
  const castBlk = named.length
    ? `\n[CHARACTERS — identity is 100% from reference element(s); you describe ONLY expression, action and composition] This scene features ${named.join(' and ')}. Refer to ${named.length > 1 ? 'them' : 'her'} BY NAME (${named.join(', ')}). NEVER describe ${named.length > 1 ? 'their' : 'her'} face, hair, skin, age, body or clothing — a reference element defines each identity, and any appearance wording breaks it.${named.length > 1 ? ` Compose ${named.join(' and ')} INTERACTING as the beat describes — make clear who does what to whom (e.g. "${named[0]} handing the cup to ${named[1]}").` : ''} Describe ONLY the scene, ${named.length > 1 ? "each person's" : 'her'} facial expression and action for this beat, plus framing and lighting.`
    : ''
  // 인물: 캐릭터 레퍼런스가 있으면 레퍼런스에 100% 위임(외모 서술 금지). 없으면 인종/지역 특정 금지 + 전 씬 동일 룩.
  const personBlk = named.length ? castBlk : hasCharacterRef
    ? `\n[PERSON — IDENTITY 100% from the reference photo; you describe ONLY expression + action] A reference photo is the SOLE source of her look: face, HAIR, skin, age, build. NEVER write a single word about her hair, face, skin, age, body or clothing — not "casually unstyled hair", not "hair down", not "natural hair", nothing. Her HAIRSTYLE must stay EXACTLY as the reference (same length, cut, parting, color, texture) — describing hair at all makes the model restyle it and breaks the shot. Call her "the creator". You describe ONLY her FACIAL EXPRESSION and her ACTION/pose for THIS scene's beat below — never her appearance. Do NOT copy the reference's neutral/resting face; she is REACTING as the beat says. Her WARDROBE and HAIRSTYLE come ENTIRELY from the reference — reproduce exactly what the reference shows and keep it identical across every scene and both start/end frames. Do NOT add or invent anything that is not in the reference (no added head-wrap/turban, towel, hat, or top).`
    : `\n[PERSON — no character reference provided] Do NOT invent or specify her appearance (no age, ethnicity, nationality, body, hair or skin descriptions). Keep whatever look you render CONSISTENT across every scene (same person, same hair, same face — she must not change scene to scene). Her EXPRESSION comes from this scene's beat below — she is reacting, not posing.`
  // 이 씬의 감정·목적·샷 → 표정/프레이밍을 이 비트에 정확히 맞춘다. 페르소나 register는 목소리 톤일 뿐, 무표정 얼굴이 아님.
  const beatBlk = `\n[THIS SCENE'S BEAT — the FACE must react to this; never a blank/staring/default expression]`
    + (scene.emotion ? `\n  facial expression (render THIS): ${scene.emotion}` : '')
    + (scene.purpose ? `\n  role in the flow: ${scene.purpose}` : '')
    + (scene.shot ? `\n  shot (angle / distance / movement): ${scene.shot}` : '')
    + (demeanor ? `\n  persona tone: "${demeanor}" — this is her VOICE/attitude, a SUBTLE undertone only. It is NOT a facial instruction: do NOT render a flat, lifeless, "utterly deadpan" blank stare into the lens. Even a dry/deadpan persona still visibly REACTS to the beat above — a flicker of doubt, a small brow move, a suppressed reaction. Understated ≠ expressionless.` : '')
  // 형제 씬 제목 목록 → 이 씬을 시각적으로 확실히 다르게 (동일 구도/세팅 반복 금지).
  const listBlk = Array.isArray(siblingTitles) && siblingTitles.length > 1
    ? `\n[THE FULL SHOT LIST — this is scene ${sceneIndex + 1}; make it VISUALLY DISTINCT from every other shot: different composition, angle, distance, setting or action. Do NOT reuse the same framing or location twice]\n${siblingTitles.map((t, k) => `  ${k + 1}. ${t || '(untitled)'}${k === sceneIndex ? '   ← THIS scene' : ''}`).join('\n')}`
    : ''
  const guideBlk = guidance && guidance.trim()
    ? `\n[CREATOR'S DIRECTION FOR THIS IMAGE — honor it above all] ${guidance.trim()}\nIf the creator says a certain action/shot is hard to render or unwanted, do NOT use it — propose a DIFFERENT concrete visual that conveys the same scene beat. Follow their idea/constraint.`
    : ''
  // 코스메틱이면 비주얼을 리뷰/UGC(피부·바르는 동작·클로즈업)로
  const cosmeticBlk = cosmetic
    ? `\n[COSMETIC REVIEW STYLE — beauty/skincare/makeup product] Shoot it like a real beauty review (UGC), NOT a flat product photo: extreme close-ups of skin / lips / face showing the product's texture, glow or visible effect; OR the creator APPLYING it (patting, smoothing, misting, glossing) on their own skin; OR holding the product up next to their dewy, natural face. Authentic selfie/UGC framing, natural light, real skin texture/freckles. The face and skin ARE the demo — show them. Application on skin IS the content here (not a flat bottle shot).`
    : ''
  const isFirst = sceneIndex === 0
  const isLast = sceneTotal > 1 && sceneIndex === sceneTotal - 1
  const roleNote = isLast
    ? 'This is the CTA scene: the creator holds the PRODUCT in ONE hand while her OTHER (free) hand points a single finger DOWNWARD toward the BOTTOM of the frame — at the on-screen comment/link area the VIEWER sees on their own screen. Her expression is WELCOMING, happy and satisfied (a warm, genuine smile — she loves it and is inviting you in). NOT a phone or device in the scene; just the inviting downward finger-point at the empty lower-frame space.'
    : isFirst
      ? 'This is the HOOK scene (scene 1): a striking, scroll-stopping image that conveys the hook in the Title/VO — its disbelief, doubt, problem or curiosity. Do NOT show the resolved/triumphant end state; create the tension that makes the viewer want to keep watching. This is NOT the CTA — do NOT point a finger down or do any call-to-action gesture.'
      : `Choose a framing that fits THIS beat (and differs from a plain repeat): close-up detail, wide, top-down, low angle, over-the-shoulder, hands-only, or push-in. This is scene ${sceneIndex + 1} of ${sceneTotal}. This is NOT the CTA scene — do NOT point a finger down or do any call-to-action gesture; use a natural gesture that fits this beat.`
  const prompt = `Write ONE English image-generation prompt (a single photorealistic still frame, vertical 9:16) for ONE specific scene of a shopping short. The scene gives a Title and a voiceover — the image MUST clearly depict THIS scene's exact beat and moment, driven by that Title and VO.

[Scene Title] ${scene.onScreenText || ''}
[Scene voiceover] ${scene.vo || ''}${beatBlk}
[Product] ${productLine(productName, product)}
${product?.dimensions ? '[Real dimensions] ' + product.dimensions : ''}
${product?.features ? '[Features/mechanics] ' + String(product.features).slice(0, 400) : ''}
${style && style.trim() ? '[Style direction — apply] ' + style.trim() : ''}

[Framing for this scene] ${roleNote}${cosmeticBlk}${guideBlk}${personBlk}${listBlk}
${imageRulesBlock()}
[This shot's motion rule]
${cosmetic
    ? '- Application/use motions are GOOD — show the product being applied or used on skin/lips and its visible result; that IS the demo. (Cosmetics sell on the using.)'
    : '- NO transformation actions: never depict the product being folded, unfolded, assembled, collapsed, popped open, or set up (AI renders these badly). Show ONE clear STATE — assembled & in use, OR folded & in its carry bag. Convey "easy setup" via the RESULT, not the act.'}

Output ONLY the prompt text (one paragraph). It must faithfully realize the REAL product (accurate design + branding from the reference), render THIS scene's specific emotion/expression, keep the person neutral & consistent, and follow every VISUAL RULE above. End with "vertical 9:16, photorealistic, no overlay captions".`
  const out = await runClaude(prompt, { timeout: 90000 })   // sonnet — grounds the visual in the scene's beat
  return stripFence(out).trim().replace(/^["']|["']$/g, '')
}

// ── B1: 구조화 샷 스펙 — 프롬프트 산문 대신 타입 필드로 비주얼을 지정 (LLM 이중 패러프레이즈 제거) ──
// generateShotSpec: 씬 비트 → JSON 스펙 (누가/무엇을/표정/제품배치/카메라/세팅).
// renderShotSpec: 스펙 → 최종 이미지 프롬프트를 "기계적으로" 조립 (LLM 없음 → 드리프트 0, 항상 컴팩트해 잘리지 않음).
export async function generateShotSpec({ scene = {}, productName, product, style, sceneIndex = 0, sceneTotal = 1, guidance, cosmetic = false, hasCharacterRef = false, elementNames = [], siblingTitles = null, demeanor = '', persona = '', hook = '' }) {
  const named = (Array.isArray(elementNames) ? elementNames : []).filter(Boolean)
  const isFirst = sceneIndex === 0, isLast = sceneTotal > 1 && sceneIndex === sceneTotal - 1
  const role = isLast ? 'CTA — she holds the product in ONE hand, the OTHER hand points one finger DOWN toward the lower frame; warm genuine welcoming smile. No phone in scene.'
    : isFirst ? 'HOOK — scroll-stopping tension/doubt/curiosity of the hook line; NOT the resolved happy end-state; no CTA gesture.'
    : `beat ${sceneIndex + 1}/${sceneTotal} — a framing DISTINCT from the other shots; no CTA gesture.`
  const castRule = named.length
    ? `The cast is ${named.join(' and ')} (reference elements define their look). subject must call them BY NAME and NEVER describe face/hair/skin/age/body/clothing.${named.length > 1 ? ' Compose them INTERACTING — who does what to whom.' : ''}`
    : hasCharacterRef
      ? 'A reference photo defines her identity. Call her "the creator" and NEVER describe face/hair/skin/age/body/clothing — appearance words break the identity lock.'
      : 'No reference: do NOT specify age/ethnicity/appearance; keep the same person across scenes.'
  const prompt = `Design ONE camera shot for one scene of a vertical shopping short. Output a compact JSON SHOT SPEC — fields only, no prose paragraph.

[Scene Title] ${scene.onScreenText || ''}
[Scene VO] ${scene.vo || ''}
${scene.emotion ? '[Facial expression for this beat] ' + scene.emotion : ''}
${scene.purpose ? '[Role in flow] ' + scene.purpose : ''}
${scene.shot ? '[Shot direction from the script] ' + scene.shot : ''}
[Scene role] ${role}
[Product] ${productLine(productName, product)}${product?.dimensions ? ' · real size ' + product.dimensions : ''}
${style && style.trim() ? '[Style direction] ' + style.trim() : ''}
${demeanor ? `[Persona tone "${persona || demeanor}"] voice-attitude only, a SUBTLE undertone — the face still visibly REACTS to the beat (understated ≠ expressionless).` : ''}
${hook ? '[Hook archetype] ' + hook : ''}
[Cast rule] ${castRule}
[POV rule] "selfie" is the CAMERA'S viewpoint only — she is NEVER holding a phone or camera; no recording device exists in the scene. Describe her hands doing something natural (product, gesture, skin).
${cosmetic ? '[Cosmetic UGC] the demo IS skin/application — favor close-ups of skin/lips, applying/patting motions, real skin texture.' : '[Motion rule] show ONE clear state; never folding/assembling/setup actions.'}
${Array.isArray(siblingTitles) && siblingTitles.length > 1 ? '[Other shots — be visually DIFFERENT from all of these]\n' + siblingTitles.map((t, k) => `  ${k + 1}. ${t || '(untitled)'}${k === sceneIndex ? ' ← THIS' : ''}`).join('\n') : ''}
${guidance && guidance.trim() ? '[CREATOR DIRECTION — honor above all] ' + guidance.trim() : ''}

Output ONLY this JSON (each field ONE short concrete phrase, English):
{"subject":"who is in frame (by name/the creator/hands only)","action":"the specific action of this beat","expression":"concrete facial expression — never blank/deadpan","product_placement":"how the product appears: held/being applied/on surface + angled away, secondary, label never readable","camera":{"pov":"selfie|third-person|over-shoulder|top-down|hands-only|mirror","distance":"extreme close-up|close-up|medium|wide","angle":"eye level|slightly low|slightly high|low|high"},"setting":"location + time of day","lighting":"light quality/source","notes":"optional extra detail or empty string"}`
  return await runJson(prompt, {
    timeout: 90000,
    validate: (j) => {
      if (!(j && j.subject && j.action && j.expression && j.camera && j.camera.distance)) return 'spec must include subject, action, expression and camera.distance'
      const held = /\b(?:hold(?:ing|s)?|grip(?:ping|s)?|rais(?:ing|es)?|lift(?:ing|s)?|clutch(?:ing|es)?)\s+(?:a\s|the\s|her\s)?(?:phone|camera|smartphone)\b|\b(?:phone|camera|smartphone)\s+(?:in|at)\s+(?:her\s|one\s)?(?:hand|hands|chin|chest|face)/i
      for (const f of ['subject', 'action', 'product_placement', 'notes']) if (held.test(String(j[f] || ''))) return `"${f}" puts a phone/camera in her hands — selfie is the camera POV, no device exists in the scene; rewrite the ${f} without any phone/camera`
      return null
    },
  })
}
export function renderShotSpec(spec, { frameRole } = {}) {
  const cam = spec.camera || {}
  const camLine = [cam.pov, cam.distance, cam.angle].filter(Boolean).join(', ')
  const frameLine = frameRole === 'end'
    ? ' This is the END keyframe of the motion — the expression/pose at its RESOLVED, later moment.'
    : frameRole === 'start' ? ' This is the START keyframe — the ONSET of the expression/motion, not its peak.' : ''
  return `${spec.subject} — ${spec.action}. Expression: ${spec.expression}.` +
    ` Product: ${spec.product_placement || 'visible but secondary, label angled away, never a readable hero shot'}.` +
    ` Camera: ${camLine || 'natural UGC framing'}. Setting: ${spec.setting || 'natural home setting'}${spec.lighting ? ', ' + spec.lighting : ''}.` +
    (spec.notes ? ` ${spec.notes}.` : '') + frameLine +
    ' The product is recognizable but NEVER a readable hero shot. No phone or camera prop in frame. No text of any kind in the image. Warm, bright, clean, aspirational mood. vertical 9:16, photorealistic, no overlay captions'
}

// ── B2: 크리틱 — storytelling 셀프체크로 스크립트를 채점하고 고칠 점을 지목 (+훅 후보 랭킹) ──
// 게이트: 점수 < 7 이면 notes를 guidance로 1회 재생성 (비용 상한: 크리틱 1회 + 재생성 1회).
export async function critiqueScript({ overall = null, scenes = null, hookOptions = null }) {
  const target = scenes
    ? `[SCENES — the shot-by-shot script]\n${JSON.stringify(scenes.map((x) => ({ title: x.onScreenText, vo: x.vo, sec: x.durationSec }))).slice(0, 3000)}\n[OVERALL it was distilled from]\n${JSON.stringify(overall || {}).slice(0, 1500)}`
    : `[OVERALL SCRIPT]\n${JSON.stringify(overall || {}).slice(0, 3000)}`
  const hookBlk = Array.isArray(hookOptions) && hookOptions.length > 1
    ? `\n[HOOK OPTIONS — also rank these and pick the single best as "bestHook" (0-based index)]\n${hookOptions.map((h, i) => `  ${i}. ${h}`).join('\n')}`
    : ''
  const prompt = `You are a ruthless short-form (Reels/TikTok) script CRITIC. Judge this shopping-short script against the self-check below. Be strict — a 9+ means you would bet money it stops scrolls.

${target}${hookBlk}

Self-check (judge EACH):
0. COLD VIEWER (weight this HEAVIEST): a stranger with zero context — after scene 2, can they say what KIND of product this is (category) and what it does for THEM (benefit)? The BRAND NAME does not need to appear early — a teased reveal ("this cream…") that names the product at the turn is CORRECT loop-craft, judged by the hook shape; penalize an early "This is [brand]" info-dump that kills the loop, AND penalize a script where even the category/benefit stays unclear. Is the story about the VIEWER's problem (not the creator's feed/algorithm)? Are there plain anchor sentences, or is it all cryptic fragments?
1. HOOK: does line 1 stop the scroll in 1.5s — concrete, pictureable, opens a loop that NEEDS closing? (vague "I didn't believe X" = fail) Does it name the VIEWER's pain/desire rather than the creator's feed?
2. TURN: is there ONE clean turn (doubt→realization / problem→mechanism) — not a flat feature list?
3. REACT: does the VO react and reveal (first-person, sensory, specific numbers) instead of narrating ad copy?
4. RHYTHM: varied line lengths with at least TWO short 2-5 word punch fragments?
5. BUDGET: can each line actually be SAID in its seconds (~2.3 words/sec)? flag any line that can't.
6. PAYOFF: does the product earn its entrance (not dumped in the first beat), with the result as the reward?
7. CTA: casual and specific (comment keyword), not salesy?

Output ONLY JSON:
{"score": <0-10 overall>, "notes": ["each note = ONE targeted, actionable fix naming the exact line/scene — max 4, empty array if 9+"]${hookBlk ? ',"bestHook": <0-based index of the strongest hook option>' : ''}}`
  return await runJson(prompt, {
    timeout: 90000,
    validate: (j) => (j && typeof j.score === 'number' && Array.isArray(j.notes)) ? null : 'output must be {score:number, notes:[]}',
  })
}

// FTC 보증 — 마지막 씬(CTA)에 disclosure가 없으면 기계적으로 부착 (미국 제휴 콘텐츠 필수).
// 풀 분해와 단일 씬 재생성 모두 이걸 거친다 (한쪽만 지키면 재생성에서 빠진다).
export function ensureFtcOnLast(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes
  const last = scenes[scenes.length - 1]
  if (!/#ad\b|commission|amazon associate|\bsponsored\b/i.test(last.onScreenText || '')) last.onScreenText = ((last.onScreenText || '').trim() + ' · #ad').trim()
  return scenes
}

// 씬의 캐릭터·제품 "동작/행동" 모션 (image→video 클립용). 카메라 무빙 아님 — 카메라는 clip의 cameraMove가 담당.
export async function generateMotionPrompt({ scene = {}, product, guidance, lang = 'English (US)' }) {
  const gBlk = guidance && guidance.trim() ? `\n[INSTRUCTION — honor this above all] ${guidance.trim()}` : ''
  const prompt = `Write ONE short motion line (<= ~18 words) describing the SUBJECT motion for turning this shopping-short still into a short vertical video clip: what the PERSON does (a small natural gesture / bit of acting) and/or how the PRODUCT moves or is handled in-frame. This is NOT camera movement — describe ONLY character & product behavior. No transformations (folding / assembling / setup). Keep it subtle, realistic, and grounded in the scene beat.
[Scene Title] ${scene.onScreenText || ''}
[Scene VO] ${scene.vo || ''}
[Image] ${(scene.imagePrompt || '').slice(0, 300)}
Product: ${product?.title || ''}${gBlk}
Output ONLY the motion line — no quotes, and no camera terms (pan, zoom, dolly, push-in, tilt, orbit) — in ${lang}.`
  const out = await runClaude(prompt, { model: 'haiku', timeout: 60000 })
  return (out || '').trim().split('\n')[0].replace(/^["']|["']$/g, '').slice(0, 200)
}

// VO 텍스트를 지시(guidance)에 맞게 LLM으로 조정 (음성용 영어 라인). guidance 없으면 호출 안 함(번역/복사).
export async function generateVoText({ vo, guidance, lang = 'English (US)' }) {
  const prompt = `Rewrite this short-video VOICEOVER line for the spoken voice, in ${lang}. Keep it tight, spoken, same core intent; apply the instruction. It must still sound like one person talking.
[VO] ${vo}
[Instruction] ${(guidance || '').trim()}
Output ONLY the rewritten line — no quotes.`
  const out = await runClaude(prompt, { model: 'haiku', timeout: 60000 })
  return (out || '').trim().split('\n')[0].replace(/^["']|["']$/g, '').slice(0, 400)
}

// 제품 + 릴스 분석을 보고 가장 잘 맞는 PERSONA + HOOK 추천 (이유 포함)
export async function recommendPersonaHook({ productName, product, analysis, personas, hooks }) {
  const prompt = `You recommend the single best VO PERSONA and the single best HOOK shape for a US-market shopping short, based on the product and the reference reel's analysis. Choose what will make the MOST impactful, scroll-stopping short for THIS product and its likely buyer.

[Product]
${productLine(productName, product)}
${product?.features ? '[Product features/mechanics] ' + String(product.features).slice(0, 500) : ''}

[Reference reel analysis]
${JSON.stringify(analysis || {}).slice(0, 2500)}

[Available personas (key: name — register)]
${(personas || []).map((p) => `${p.key}: ${p.name} — ${p.register || ''}`).join('\n')}

[Available hooks (key: name — when it fits)]
${(hooks || []).map((h) => `${h.key}: ${h.name} — ${h.when_to_use || ''}`).join('\n')}

Think about who buys this product, the emotion that sells it, and what the reel's structure rewards. Pick ONE persona key and ONE hook key from the lists above (use the exact keys).
Output ONLY JSON: {"persona":"<key>","personaWhy":"one short reason","hook":"<key>","hookWhy":"one short reason"}`
  return await runJson(prompt, { timeout: 90000, validate: (r) => (r && typeof r === 'object' && r.persona && r.hook) ? null : 'output must be JSON with persona and hook keys' })
    .catch((e) => { throw new Error('추천 응답 실패 (' + (e.message || e) + ')') })
}

// 페르소나만 추천 (product + audience + reel voice + instruction)
export async function recommendPersona({ productName, product, analysis, personas, voStyles, guidance }) {
  const hasStyles = Array.isArray(voStyles) && voStyles.length
  const prompt = `Recommend the single best VO PERSONA${hasStyles ? ' and the best SPEAKING STYLE (how that persona paces the line)' : ''} for a US-market shopping short — the combination that makes the most scroll-stopping short for THIS product and its likely buyer.
[Product] ${productLine(productName, product)}${product?.features ? '\n[Features] ' + String(product.features).slice(0, 400) : ''}
[Reel voice + audience + pacing (reference)] ${JSON.stringify({ voice: analysis?.voice, audience: analysis?.audience, hook: analysis?.hook, pacing: analysis?.structure?.pacing }).slice(0, 1600)}
[Available personas (key: name — register)]
${(personas || []).map((p) => `${p.key}: ${p.name} — ${p.register || ''}`).join('\n')}${hasStyles ? `
[Available speaking styles (key: name — how it paces the VO)]
${voStyles.map((s) => `${s.key}: ${s.name} — ${(s.directive || '').trim().split('\n')[0]}`).join('\n')}` : ''}
${guidance && guidance.trim() ? '[INSTRUCTION — honor above all] ' + guidance.trim() : ''}
Pick ONE persona key${hasStyles ? ' and ONE speaking-style key' : ''} from the list(s) (exact keys). The style should match the reel's pacing and the persona's register. Output ONLY JSON: {"persona":"<key>","why":"one short reason"${hasStyles ? ',"voStyle":"<key>","voStyleWhy":"one short reason"' : ''}}`
  return await runJson(prompt, { model: 'haiku', timeout: 60000, validate: (r) => r?.persona ? null : 'output must be JSON with a persona key' })
    .catch((e) => { throw new Error('persona 추천 실패 (' + (e.message || e) + ')') })
}

// 훅만 추천 (reel의 hook.family로 leaning + instruction)
export async function recommendHook({ analysis, hooks, guidance }) {
  const fam = analysis?.hook?.family || ''
  const prompt = `Recommend the single best HOOK shape for a US-market shopping short.${fam ? ` The reference reel's hook archetype is "${fam}" — LEAN to the catalog hook that matches it unless the instruction says otherwise.` : ''}
[Reel hook] ${JSON.stringify(analysis?.hook || {}).slice(0, 700)}
[Available hooks (key: name — when it fits)]
${(hooks || []).map((h) => `${h.key}: ${h.name} — ${h.when_to_use || ''}`).join('\n')}
${guidance && guidance.trim() ? '[INSTRUCTION — honor above all] ' + guidance.trim() : ''}
Pick ONE hook key from the list (exact key). Output ONLY JSON: {"hook":"<key>","why":"one short reason"}`
  return await runJson(prompt, { model: 'haiku', timeout: 60000, validate: (r) => r?.hook ? null : 'output must be JSON with a hook key' })
    .catch((e) => { throw new Error('hook 추천 실패 (' + (e.message || e) + ')') })
}
