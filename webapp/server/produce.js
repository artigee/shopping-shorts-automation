// 콘텐츠 제작 — 릴스 분석(설계도) + 선택 제품 → ① 전체 스크립트 → ② 씬 스크립트 (Claude CLI).
// 핵심: 원본 릴스의 "구조"만 이해해 빌리고, 카피는 선택 제품으로 "새로" 작성 (복붙 금지).
import { spawn } from 'node:child_process'
import { personaBlock, voStyleBlock, hookBlock, banBlock, rulesBlock, contentSafetyBlock, imageRulesBlock, getBanlist } from './playbook.js'

const CLI_MODEL = process.env.PRODUCE_CLI_MODEL || 'sonnet' // 스크립트 품질 → sonnet

function runClaude(prompt, { timeout = 240000, model = CLI_MODEL } = {}) {
  return new Promise((res, rej) => {
    const child = spawn('claude', ['-p', prompt, '--model', model], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('claude CLI 응답 시간 초과 — 다시 [씬 분해] 눌러주세요 (스크립트 프롬프트가 길어 가끔 느립니다).')) }, timeout)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(t); rej(e) })
    child.on('close', (code) => { clearTimeout(t); code === 0 ? res(out) : rej(new Error(`claude exit ${code}: ${err.slice(-200)}`)) })
  })
}
function stripFence(t = '') {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : t).trim()
}
// ── 스킬 검증 (check_vo.py의 규칙을 JS로: ban-list + VO가 Title을 재진술하지 않기) ──
const VO_STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'it', 'is', 'this', 'that', 'your', 'you', 'with', 'for', 'into', 'just', 'one', 'no', 'i', 'my', 'me', 'at', 'its', 'then', 'now', 'up'])
function contentWords(t = '') { return (String(t).toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => !VO_STOP.has(w) && w.length > 1) }
function noveltyRatio(caption, vo) { const cap = new Set(contentWords(caption)); const v = contentWords(vo); if (!v.length) return 1; return v.filter((w) => !cap.has(w)).length / v.length }
function validateScenes(scenes, banlist, threshold = 0.35) {
  const fails = []
  scenes.forEach((s, i) => {
    const cap = s.onScreenText || '', vo = s.vo || ''
    const banned = [...new Set([cap, vo].flatMap((txt) => banlist.filter((p) => String(txt).toLowerCase().includes(p))))]
    if (banned.length) fails.push(`scene ${i + 1}: banned phrase(s) [${banned.join(', ')}] — rewrite without them.`)
    if (cap && vo) { const nov = noveltyRatio(cap, vo); if (nov < threshold / 2) fails.push(`scene ${i + 1}: the VO just restates the title (only ${Math.round(nov * 100)}% new words) — rewrite the VO to REACT / reveal the mechanism, not narrate. title="${cap}" vo="${vo}"`) }
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

const directionBlock = (d) => (d && d.trim() ? `\n[DIRECTION — apply this creative direction throughout]\n${d.trim()}\n` : '')

// VO/타이틀 크래프트는 shorts-playbook 폴더에서 읽어온다 (personaBlock/hookBlock/banBlock/rulesBlock).
const VO_ARC = 'disbelief → mechanism reveal → anti-climax/ease → earned payoff → casual close (each line a DIFFERENT energy)'

// ③ 전체 스크립트 — 구조만 빌려 선택 제품으로 새로 작성 (복붙 금지). US 마켓 → 영어로 작성.
export async function generateOverall({ analysis, productName, product, base, guidance, direction, persona, voStyle, voStyleNote, hook, contentMode, hasFootage = false, lang = 'English (US, American audience)' }) {
  const prompt = `You are a top short-form (Instagram Reels/TikTok) ad copywriter for the ${lang} market.
KEEP the original reel's STRUCTURE only — hook archetype, beat order, pacing, CTA mechanic. DISCARD the original's exact words (its captions and voiceover); never copy its sentences. On that skeleton write a COMPLETELY NEW shorts script that sells [My product], natively in ${lang} — idioms, rhythm, regional nuance native to that audience; do NOT translate from another language.
This OVERALL script is the product's story/context. The single most important field is "vo".
[VO = the through-line] Write "vo" as ONE continuous spoken monologue in the PERSONA below — one person thinking out loud, moving through the energy ARC: ${VO_ARC}. REACT and reveal the mechanism; do NOT just explain or list features. Specific sensory detail and real numbers, never generic ad language.
This is the FULL story / context — it may be richer and longer than the final short. Write it complete and good; the SCENE step will distill it down to fit the video length. Do NOT pre-truncate here.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${contentSafetyBlock(contentMode, { hasFootage })}
${guideBlock(base, guidance, 'overall script')}
[Reel analysis (structure reference only)]
${JSON.stringify(analysis).slice(0, 6500)}

[My product]
${productLine(productName, product)}

Rules (all text in English):
- angle: one line for the new narrative angle (e.g. "problem→solution", "before/after", "you're doing it wrong").
- hookLine: the 0-2s opening line — a fresh scroll-stopping hook.
- beats: 4-7 items, one line each, the video flow (product strengths surface naturally).
- vo: the full voiceover as ONE continuous persona monologue (see [VO = the through-line] above) — the through-line that scenes will later slice. NOT a paragraph that explains the beats.
- cta: the final call to action (comment keyword → link funnel).
- durationSec: total video length in seconds — DEFAULT to the reference reel's length${Number(analysis?._meta?.duration) > 0 ? ' (~' + Math.round(analysis._meta.duration) + 's)' : ''}; only deviate if the story clearly needs it, and keep it in the 12-40s range.
- shotCount: the number of SHOTS this short should have, chosen for MAXIMUM impact — NOT a default. Decide it from THIS story: how many DISTINCT beats it truly needs, the reel's pacing (fast cuts → more shots; slow/lingering → fewer), and the durationSec above. Range 3-9: a simple/punchy story folds roles into as few as 3 (hook+product+CTA); a rich or fast-cut one expands up to 9. The last shot is always the CTA. Do NOT default to 5 — justify the number by the beats.
- shotCountWhy: one short line — why that count fits this story.

Output ONLY JSON (no explanation):
{"angle":"...","title":"...","hookLine":"...","durationSec":25,"shotCount":5,"shotCountWhy":"...","beats":["...","..."],"vo":"...","cta":"..."}`
  let o
  for (let k = 0; k < 2 && !o; k++) { const out = await runClaude(prompt); try { const j = JSON.parse(stripFence(out)); if (j && typeof j === 'object' && !Array.isArray(j)) o = j } catch {} }
  if (!o) throw new Error('전체 스크립트 응답 파싱 실패 — 다시 [생성] 눌러주세요.')
  return o
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
- TITLE and VO must NEVER say the same thing. TEST: delete the vo — if the title still delivers the same info, the vo FAILED; rewrite it to react, not narrate. Do NOT inflate the title back into a full sentence.
- EAR-CATCHING (see storytelling rules): line 1 is a cold open that lands in 1.5s (no "so/okay so"). VARY line length — at least TWO vo lines are short 2-5 word fragments. One clean TURN. Cut filler. Keep each line short enough to actually say within its scene's seconds.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${rulesBlock()}${contentSafetyBlock(contentMode, { hasFootage })}
${directionBlock(direction)}${guideBlock(base, guidance, 'scene script')}
[Overall script]
${JSON.stringify(overall).slice(0, 3000)}

[My product]
${productLine(productName, product)}

[Structure reference]
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

Output ONLY a JSON array (no explanation):
[{"weight":1.0,"onScreenText":"...","vo":"...","emotion":"...","purpose":"...","shot":"..."}]`
  const runParse = async (pr) => { for (let k = 0; k < 2; k++) { const out = await runClaude(pr); try { const j = JSON.parse(stripFence(out)); if (Array.isArray(j) && j.length) return j } catch { /* 다음 시도 */ } } return null }
  let scenes = await runParse(prompt)
  if (!scenes) throw new Error('씬 스크립트 응답 파싱 실패 — 다시 [재생성] 눌러주세요.')
  // 스킬 검증 루프 — ban-list + VO≠Title(react-don't-narrate). 실패 라인만 지목해 재작성(최대 2회).
  const banlist = getBanlist().map((p) => p.toLowerCase())
  for (let attempt = 0; attempt < 2; attempt++) {
    const fails = validateScenes(scenes, banlist)
    if (!fails.length) break
    const fixed = await runParse(`${prompt}\n\n[GUARDRAIL FAILED on your previous output — FIX ONLY these lines, keep every other scene exactly as-is, and re-output the SAME full JSON array]:\n${fails.join('\n')}`)
    if (!fixed) break
    scenes = fixed
  }
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
  const others = scenes.map((s, i) => i === sceneIndex ? `[${i + 1}] ← THIS scene (the one you rewrite)` : `[${i + 1}] title:"${s.onScreenText || ''}" vo:"${s.vo || ''}"`).join('\n')
  const prompt = `You are crafting ONE scene of a ${lang}-market shopping short. Rewrite ONLY scene ${sceneIndex + 1} of ${sceneTotal} — its on-screen Title and spoken VO — distilled from the overall story, keeping the arc and NOT duplicating the other scenes. ALL text natively in ${lang}.
${roleRule}
[VO vs TITLE — the key rule] onScreenText = a SHORT punchy claim/spec (<= ~5 words) that carries the FACT. vo = a FRESH tight spoken line in the PERSONA that REACTS / reveals the mechanism — it must NEVER restate the title. Delete-test: if the title alone conveys the vo, rewrite the vo.
${personaBlock(persona)}${voStyleBlock(voStyle, voStyleNote)}${hookBlock(hook)}${banBlock()}${rulesBlock()}${contentSafetyBlock(contentMode, { hasFootage })}${durRule}
${guidance && guidance.trim() ? '[INSTRUCTION — honor this above all] ' + guidance.trim() : ''}
[Overall story]
${JSON.stringify(overall).slice(0, 2600)}
[My product] ${productLine(productName, product)}
[All scenes — context, keep THIS one distinct]
${others}
Also give this beat's "emotion" (the creator's concrete facial expression for this shot — specific to this line, different from the other scenes) and "purpose" (its role in the flow).
Output ONLY JSON: {"onScreenText":"...","vo":"...","emotion":"...","purpose":"..."}`
  for (let k = 0; k < 2; k++) { const out = await runClaude(prompt); try { const j = JSON.parse(stripFence(out)); if (j && (j.onScreenText || j.vo)) return { onScreenText: j.onScreenText || '', vo: j.vo || '', emotion: j.emotion || '', purpose: j.purpose || '' } } catch { /* retry */ } }
  throw new Error('씬 스크립트 생성 파싱 실패')
}

// 씬 1개의 이미지 프롬프트(영어) 생성 — 씬 스크립트는 Title+VO만 있으므로 여기서 비주얼을 정한다. 빠르게 haiku.
export async function generateImagePrompt({ scene = {}, productName, product, style, sceneIndex = 0, sceneTotal = 1, guidance, cosmetic = false, hasCharacterRef = false, siblingTitles = null, demeanor = '', lang = 'English (US)' }) {
  // 인물: 캐릭터 레퍼런스가 있으면 레퍼런스에 100% 위임(외모 서술 금지). 없으면 인종/지역 특정 금지 + 전 씬 동일 룩.
  const personBlk = hasCharacterRef
    ? `\n[PERSON — LOCKED TO A REFERENCE PHOTO] A fixed reference of the on-screen person is supplied to the image model. Do NOT describe their face, hair, age, ethnicity, skin or body — call them only "the creator". Describe ONLY their action, pose, hands, expression and framing; identity comes 100% from the reference.`
    : `\n[PERSON — no reference; keep her CONSISTENT and NEUTRAL] The creator is a young woman in her mid-20s with natural, bare skin. Do NOT specify ethnicity, nationality, or regional features — keep it neutral. Keep her EXACT same look in every scene (same hair, same face) — she must NOT change shot to shot. Describe her action / pose / expression, not a fresh appearance each time.`
  // 이 씬의 감정·목적·샷 → 표정/프레이밍을 이 비트에 정확히 맞춘다 (분석→씬에서 전달). 매 씬 같은 표정 금지.
  const beatBlk = `\n[THIS SCENE'S BEAT — render exactly this, NOT a generic/default expression]`
    + (scene.emotion ? `\n  emotion / facial expression: ${scene.emotion}` : '')
    + (scene.purpose ? `\n  role in the flow: ${scene.purpose}` : '')
    + (scene.shot ? `\n  shot (angle / distance / movement): ${scene.shot}` : '')
    + (demeanor ? `\n  the creator's persona register is "${demeanor}" — her overall demeanor reads that way, but the per-shot expression above still varies beat to beat` : '')
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
    ? 'This is the CTA scene: show the creator looking at camera and POINTING DOWN toward the BOTTOM of the frame — at the on-screen comment/link area the VIEWER sees on their own screen. NOT a phone or device in the scene; an inviting downward point/tap at the empty lower-frame space, optionally holding the product in the other hand.'
    : isFirst
      ? 'This is the HOOK scene (scene 1): a striking, scroll-stopping image that conveys the hook in the Title/VO — its disbelief, doubt, problem or curiosity. Do NOT show the resolved/triumphant end state; create the tension that makes the viewer want to keep watching.'
      : `Choose a framing that fits THIS beat (and differs from a plain repeat): close-up detail, wide, top-down, low angle, over-the-shoulder, hands-only, or push-in. This is scene ${sceneIndex + 1} of ${sceneTotal}.`
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
  const out = await runClaude(prompt, { timeout: 90000 })
  const r = JSON.parse(stripFence(out))
  if (!r || typeof r !== 'object') throw new Error('추천 응답 파싱 실패')
  return r
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
  const out = await runClaude(prompt, { model: 'haiku', timeout: 60000 })
  const r = JSON.parse(stripFence(out)); if (!r?.persona) throw new Error('persona 추천 파싱 실패'); return r
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
  const out = await runClaude(prompt, { model: 'haiku', timeout: 60000 })
  const r = JSON.parse(stripFence(out)); if (!r?.hook) throw new Error('hook 추천 파싱 실패'); return r
}
