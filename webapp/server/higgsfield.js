// Higgsfield 생성.
//  - 기본 경로(버튼): claude CLI → Higgsfield MCP (Max 플랜 + Plus 크레딧, 추가 결제 0)
//  - 옵션 경로: 공식 SDK 직접 호출 (HF_CREDENTIALS=KEY_ID:KEY_SECRET 별도 결제 계정, 기본 비활성)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHiggsfieldClient } from '@higgsfield/client/v2'

const CRED =
  process.env.HF_CREDENTIALS ||
  (process.env.HF_API_KEY && process.env.HF_API_SECRET ? `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}` : '')

export function hfReady() { return !!CRED }

let _client
function client() {
  if (!_client) _client = createHiggsfieldClient({ credentials: CRED, maxPollTime: 300000 })
  return _client
}

// 씬 이미지 1장 생성 → 결과 이미지 URL (세로 9:16)
export async function genImage({ prompt, aspect = '9:16', seed }) {
  if (!CRED) throw new Error('NO_CREDENTIALS')
  const input = {
    aspect_ratio: aspect,
    prompt: withScale(prompt),
    safety_tolerance: 2,
    seed: Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1e6),
  }
  const jobSet = await client().subscribe('flux-pro/kontext/max/text-to-image', { input, withPolling: true })
  if (!jobSet.isCompleted) throw new Error(jobSet.isNsfw ? 'NSFW 거부됨' : jobSet.isFailed ? '생성 실패' : '미완료(타임아웃)')
  const url = jobSet.jobs?.[0]?.results?.raw?.url
  if (!url) throw new Error('결과 URL 없음')
  return url
}

// 모든 이미지 프롬프트에 붙는 스케일 규칙 — 제품의 실제 물리 크기를 존중 (큰 제품을 작게 그리지 않게)
const SCALE_RULE = ' IMPORTANT — render the product at its TRUE real-world physical size: do not shrink a large product (e.g. a bed, furniture, appliance) into a tiny prop; keep proportions realistic and use natural scale references (a person, hand, room, or furniture) so the real size reads correctly.'
const NO_TEXT_RULE = ' ABSOLUTELY NO text of any kind in the image — no letters, words, numbers, captions, subtitles, labels, signs, logos, watermarks, or typography. Purely visual scene, clean (text/captions are added later in editing).'
const TONE_RULE = ' Mood: warm, bright, clean, aspirational. Even a problem/"before" beat stays light, calm and relatable — NEVER genuinely distressing: no crying or upset child, no exhausted/despairing person, no bleak or messy-despair framing, no dark moody grime. Premium lifestyle look.'
export function withScale(prompt) { return `${String(prompt || '').trim()}${SCALE_RULE}${NO_TEXT_RULE}${TONE_RULE}` }

// 씬 스크립트 + 선택 제품 → 이미지 프롬프트 (제품이 보이게)
export function buildImagePrompt(scene, product) {
  const base = scene?.imagePrompt || scene?.onScreenText || 'product lifestyle shot'
  const prod = product?.title ? ` Featured product: ${product.title} (real product size matters).` : ''
  return `${base}${prod} Vertical 9:16, photorealistic, clean social-commerce lighting, no text overlay.`
}

// ── 기본 버튼 경로: claude CLI → Higgsfield MCP ──────────────────
const HF_TOOLS = ['mcp__higgsfield__media_import_url', 'mcp__higgsfield__generate_image', 'mcp__higgsfield__job_status']
export function cliReady() { return true } // claude CLI(Higgsfield MCP 연결) 경로는 항상 사용 가능

function runClaude(prompt, extraArgs = [], timeout = 240000) {
  return new Promise((res, rej) => {
    const child = spawn('claude', ['-p', prompt, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('claude CLI timeout')) }, timeout)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(t); rej(e) })
    child.on('close', (code) => { clearTimeout(t); code === 0 ? res(out) : rej(new Error(`claude exit ${code}: ${err.slice(-200)}`)) })
  })
}

// 히긱스필드에 등록된 재사용 element(캐릭터/환경/제품) 목록 — claude CLI로 MCP 조회 후 JSON만 파싱해서 반환.
const HF_ELEMENTS_TOOLS = ['mcp__higgsfield__show_reference_elements']
export async function listHfElements() {
  const prompt = 'Call the tool mcp__higgsfield__show_reference_elements with exactly {"action":"list","size":60}. From the result, output ONLY a single compact JSON array (no prose, no explanation, no markdown code fences). Each array item must be {"id":<id>,"name":<name>,"category":<category>,"thumb":<url of the first media, or null>}. Output nothing except that JSON array.'
  const out = await runClaude(prompt, ['--allowedTools', ...HF_ELEMENTS_TOOLS, '--model', 'haiku'], 120000)
  const m = out.match(/\[[\s\S]*\]/)   // 출력에서 JSON 배열만 추출
  if (!m) throw new Error('element 목록 파싱 실패 (CLI 출력에 JSON 배열 없음)')
  const arr = JSON.parse(m[0])
  // 오디오/비디오 element(예: 음성 샘플)는 이미지 카탈로그에서 제외 — 이미지 첨부용 element만.
  const isAv = (u) => /\.(mp3|wav|m4a|ogg|aac|flac|mp4|webm|mov)(\?|$)/i.test(u || '')
  return Array.isArray(arr) ? arr.filter((e) => e && e.id && e.name && !isAv(e.thumb)).map((e) => ({ id: e.id, name: e.name, category: e.category || 'character', thumb: e.thumb || null })) : []
}

// element 하나의 전체 이미지(medias) 조회 — 뷰어용. list는 대표 1장만 주므로 get으로 전부 가져온다.
export async function getHfElement(id) {
  const prompt = `Call the tool mcp__higgsfield__show_reference_elements with exactly {"action":"get","element_id":"${id}"}. From the result output ONLY a compact JSON object {"id":..,"name":..,"category":..,"medias":[<EVERY media url in the element>]} — no prose, no code fences.`
  const out = await runClaude(prompt, ['--allowedTools', ...HF_ELEMENTS_TOOLS, '--model', 'haiku'], 120000)
  const m = out.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('element 상세 파싱 실패')
  const e = JSON.parse(m[0])
  return { id: e.id, name: e.name, category: e.category || 'character', medias: Array.isArray(e.medias) ? e.medias.filter(Boolean) : [] }
}

// 이미지 URL로 새 명명 element(캐릭터/환경/제품)를 히긱스필드에 등록. import → create 순서로 claude가 오케스트레이션.
export async function createHfElement({ name, category = 'character', imageUrl }) {
  const safeName = String(name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  if (!safeName) throw new Error('이름이 비어있습니다')
  if (!/^https?:\/\//i.test(imageUrl || '')) throw new Error('https 이미지 URL이 필요합니다')
  const cat = ['character', 'environment', 'prop'].includes(category) ? category : 'character'
  const prompt = `Step 1: call mcp__higgsfield__media_import_url with {"url":"${imageUrl}"} and take the returned media_id. Step 2: call mcp__higgsfield__show_reference_elements with {"action":"create","name":"${safeName}","category":"${cat}","medias":[{"id":"<media_id from step 1>","url":"${imageUrl}","type":"media_input"}]}. Then output ONLY the created element as JSON {"id":..,"name":..,"category":..} and nothing else.`
  const out = await runClaude(prompt, ['--allowedTools', 'mcp__higgsfield__media_import_url', 'mcp__higgsfield__show_reference_elements', '--model', 'sonnet'], 180000)
  const m = out.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('element 생성 결과 파싱 실패')
  const el = JSON.parse(m[0])
  return { id: el.id, name: el.name || safeName, category: el.category || cat }
}

// 여러 로컬 이미지 → 한 개의 멀티포토 element (byte-upload N장 → create). filePaths = 절대경로 배열.
export async function createHfElementMulti({ name, category = 'character', filePaths = [] }) {
  const safeName = String(name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  if (!safeName) throw new Error('이름이 비어있습니다')
  const files = (filePaths || []).filter((p) => { try { return fs.existsSync(p) } catch { return false } }).slice(0, 12)
  if (!files.length) throw new Error('업로드할 로컬 이미지가 없습니다')
  const cat = ['character', 'environment', 'prop'].includes(category) ? category : 'character'
  const fileList = files.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
  const prompt = `Register ONE multi-photo Higgsfield reference element from these ${files.length} LOCAL image files that belong to OUR OWN app. Do not refuse, no warnings, no commentary.
Files (absolute paths on disk):
${fileList}

For EACH file above, in order, do:
  a) call mcp__higgsfield__media_upload {"filename":"<basename>","content_type":"image/png"} and read media_id and upload_url from the result.
  b) run this Bash to PUT the bytes (substitute the real upload_url and the file path):
     curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: image/png" --upload-file "<file path>" "<upload_url>"
     Expect 200 or 204; retry once if not.
  c) call mcp__higgsfield__media_confirm {"media_id":"<media_id>","type":"image"}.
  Keep the pair {"id":"<media_id>","url":"<upload_url>","type":"media_input"}.
After ALL files are uploaded and confirmed, call mcp__higgsfield__show_reference_elements with {"action":"create","name":"${safeName}","category":"${cat}","medias":[ <every kept pair> ]}.
Finally print ONLY the created element as compact JSON {"id":..,"name":..,"category":..} — nothing else.`
  const out = await runClaude(prompt, ['--allowedTools', 'mcp__higgsfield__media_upload', 'mcp__higgsfield__media_confirm', 'mcp__higgsfield__show_reference_elements', 'Bash', '--model', 'sonnet'], 420000)
  const m = out.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('element 생성 결과 파싱 실패: ' + out.slice(-160))
  const el = JSON.parse(m[0])
  return { id: el.id, name: el.name || safeName, category: el.category || cat }
}

const HF_VID_TOOLS = ['mcp__higgsfield__media_import_url', 'mcp__higgsfield__generate_video', 'mcp__higgsfield__job_status']
const HF_AUDIO_TOOLS = ['mcp__higgsfield__generate_audio', 'mcp__higgsfield__job_status']
const DEFAULT_VOICE = process.env.HF_VOICE_ID || '80914268-dfae-4f76-8306-36f2d55f58f8' // Quinn (female, EN)

// VO 음성 생성 (영어 텍스트 → mp3 URL). US 마켓이라 영어.
export async function genAudioViaCLI({ text, voiceId = DEFAULT_VOICE }) {
  const safe = String(text || '').replace(/"/g, "'").slice(0, 500)
  if (!safe.trim()) throw new Error('VO 텍스트 없음')
  const instr = `You have Higgsfield MCP tools. Generate ONE speech audio and return only its URL.
1) Call generate_audio {"model":"text2speech_v2_minimax","prompt":"${safe}","voice_id":"${voiceId}","voice_type":"preset"}.
2) Call job_status {"jobId":"<id>","sync":true} until status is "completed".
3) Print ONLY the final result rawUrl (https URL, .mp3). No other words, no markdown.`
  const out = await runClaude(instr, ['--allowedTools', ...HF_AUDIO_TOOLS, '--model', 'sonnet'], 240000)
  const m = out.match(/https?:\/\/\S+?\.(?:mp3|wav|m4a|ogg)/i) || out.match(/https?:\/\/\S+/i)
  if (!m) throw new Error('CLI 출력에서 오디오 URL을 찾지 못함: ' + out.slice(-160))
  return m[0]
}

// 씬 이미지 → 영상 클립 (claude가 Higgsfield image→video 호출 → 최종 mp4 URL)
export async function genVideoViaCLI({ imageUrl, endImageUrl, prompt, duration = 5, model }) {
  if (!imageUrl) throw new Error('NO_IMAGE') // 클립은 씬 이미지가 먼저 있어야 함
  // 점프/급격한 줌 방지 — 부드럽고 미세한 모션으로 보정
  const safe = `${String(prompt || 'subtle camera motion, premium product reveal').replace(/"/g, "'").slice(0, 500)}. Keep motion SMOOTH and SUBTLE — slow, steady, cinematic; absolutely no abrupt zoom, no jump cuts, no fast push; the product stays stable and fully in frame. Do NOT add or render any text, letters, words, captions, or watermarks anywhere in the video.`
  const twoFrame = !!endImageUrl
  // end 프레임이 있으면 반드시 start+end 둘 다 지원하는 모델. kling3_0_turbo는 start_image만 → end 무시됨.
  const mdl = twoFrame ? (model && model !== 'kling3_0_turbo' ? model : 'kling3_0') : (model || 'kling3_0_turbo')
  const instr = `You have Higgsfield MCP tools. Make ONE short image-to-video clip and return only its URL.
1) Call media_import_url {"url":"${imageUrl}","type":"image"} and keep its media_id as START.${twoFrame ? `\n1b) Call media_import_url {"url":"${endImageUrl}","type":"image"} and keep its media_id as END.` : ''}
2) Call generate_video {"model":"${mdl}","prompt":"${safe}","aspect_ratio":"9:16","duration":${duration},"medias":[{"value":"<START media_id>","role":"start_image"}${twoFrame ? ',{"value":"<END media_id>","role":"end_image"}' : ''}]}.${twoFrame ? ` The FIRST frame of the video MUST be the START image and the LAST frame MUST be the END image — the clip morphs smoothly between them (model ${mdl} supports both keyframes).` : ''}
   IMPORTANT: if the response is a preset_recommendation (not a job), call generate_video AGAIN with the SAME params plus "declined_preset_id":"<the recommended preset id>" to generate literally.
3) Call job_status {"jobId":"<id>","sync":true} repeatedly until status is "completed" (video takes ~1-3 min; keep polling; do NOT give up early).
4) On success print ONLY the final result rawUrl (https URL ending in .mp4). If it failed, print exactly: ERROR: <reason> (e.g. ERROR: not enough credits / ERROR: nsfw / ERROR: failed). No other text.`
  const out = await runClaude(instr, ['--allowedTools', ...HF_VID_TOOLS, '--model', 'sonnet'], 420000)
  const m = out.match(/https?:\/\/\S+?\.mp4/i)
  if (m) return m[0]
  const o = out.toLowerCase()
  if (/not enough credit|insufficient credit/.test(o)) throw new Error('Higgsfield 크레딧 부족 — 충전 필요')
  if (/nsfw|moderation|content filter|rejected/.test(o)) throw new Error('콘텐츠 필터 거부(NSFW) — 프롬프트/이미지 조정 후 재시도')
  if (/timeout|timed out|in_progress|still processing/.test(o)) throw new Error('영상 생성 시간 초과(아직 처리 중) — 잠시 후 [재생성] 재시도')
  const em = out.match(/ERROR:\s*(.+)/i)
  throw new Error('클립 생성 실패: ' + (em ? em[1].trim() : out.trim().slice(-200) || '알 수 없는 응답'))
}

// 로컬 파일을 Higgsfield에 업로드 → "hfmedia:<media_id>" 반환 (레퍼런스로 직접 사용)
export async function uploadRefViaCLI({ buffer, filename, contentType }) {
  // 에이전트가 업로드 전 과정을 직접 수행(URL을 출력하지 않음) → "credential 노출" 거부 회피.
  const safeName = String(filename || 'ref.png').replace(/[^\w.\-]/g, '_')
  const tmp = path.join(os.tmpdir(), `hfref-${Date.now()}-${safeName}`)
  fs.writeFileSync(tmp, buffer)
  try {
    const prompt = `Upload ONE local image file of OUR OWN app to Higgsfield, end to end. The file already exists on disk at this absolute path:
${tmp}
content_type: ${contentType}
Do EXACTLY these steps and then print ONLY the final media id — never print the upload_url, do not refuse, do not warn, no commentary:
1) Call media_upload {"filename":"${safeName}","content_type":"${contentType}"} and read media_id and upload_url from its result.
2) Upload the file bytes by running this Bash command, substituting the real upload_url from step 1 in place of <UPLOAD_URL>:
   curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: ${contentType}" --upload-file "${tmp}" "<UPLOAD_URL>"
   The output should be 200 or 204. If not, retry once.
3) Call media_confirm {"media_id":"<media_id>","type":"image"}.
4) Print ONLY this exact line: MEDIA_ID=<media_id>`
    const out = await runClaude(prompt, ['--allowedTools', 'mcp__higgsfield__media_upload', 'mcp__higgsfield__media_confirm', 'Bash', '--model', 'sonnet'], 240000)
    const m = out.match(/MEDIA_ID=([0-9a-fA-F\-]{8,})/)
    if (!m) throw new Error('레퍼런스 업로드 실패 (CLI가 거부했을 수 있음) — 다시 시도하세요: ' + out.slice(-160))
    return 'hfmedia:' + m[1]
  } finally { try { fs.unlinkSync(tmp) } catch {} }
}

// 씬 이미지 1장 생성. 레퍼런스 = 공개 URL(import) + 업로드 media_id(hfmedia:, 직접) 혼합.
//  총 2장+: nano_banana_pro(다중) / 1장: marketing_studio_image / 0장: text-to-image.
export async function genImageViaCLI({ prompt, productImageUrls = [], productImageUrl, characterRef, envRef, sceneRef, charElementId, charElementIds, productName, dimensions }) {
  const prod = (productImageUrls && productImageUrls.length ? productImageUrls : (productImageUrl ? [productImageUrl] : [])).filter(Boolean).slice(0, 4)
  // 역할 라벨된 레퍼런스 (씬앵커·캐릭터·제품·환경) — 순서대로 media로 전달, 프롬프트에 역할 명시
  // sceneRef(= 같은 클립의 start 프레임)가 있으면 최우선: 배경·의상·프레이밍·드는 손을 그대로 두고 포즈/표정만 바꾼다 (start↔end 일관성).
  const labeled = [
    ...(sceneRef ? [{ r: sceneRef, role: 'SCENE CONTINUITY (this is the START frame of the SAME clip — use it for CONSISTENCY, not for copying). Keep the SAME person, background/setting, wardrobe and lighting as this image. This is the END frame, so her POSTURE and expression MUST be VISIBLY DIFFERENT — a later moment of the motion; do NOT copy this image or reproduce the same pose. The ONE hard rule: the product stays in the SAME hand as this image — NEVER switch it to the other hand, and NEVER mirror/flip the shot. Same scene + same product hand, different posture.' }] : []),
    ...(characterRef ? [{ r: characterRef, role: 'CHARACTER (HIGHEST PRIORITY) — match this reference for IDENTITY ONLY: same face structure, skin tone, age, build, and the EXACT SAME HAIRSTYLE (same length, cut, parting, color, texture — do NOT restyle, cut, tie up or change the hair). This hair + face lock OVERRIDES any appearance/hair wording in the prompt. Take only her FACIAL EXPRESSION and pose from the PROMPT — do NOT copy the reference photo\'s neutral/resting expression; she reacts as the scene describes. Her WARDROBE and HAIRSTYLE come ENTIRELY from this reference — reproduce exactly what it shows, identical in every shot; do NOT add or invent anything not in the reference (no added head-wrap/turban, towel, hat, or top).' }] : []),
    ...prod.map((r) => ({ r, role: 'PRODUCT — reproduce this EXACT product (design, color, parts, proportions) faithfully' })),
    ...(envRef ? [{ r: envRef, role: 'ENVIRONMENT — match this setting / space / mood / lighting' }] : []),
  ].filter((x) => x.r).slice(0, 6)
  const total = labeled.length
  const safe = String(prompt || 'product lifestyle shot').replace(/"/g, "'").slice(0, 700)
  const scaleFix = `SCALE CORRECTION (do this first, silently): The product is "${(productName || 'the product').replace(/"/g, "'")}"${dimensions ? ` with real-world dimensions ${dimensions}` : ''}. Rewrite the scene prompt below so the product appears at its TRUE real-world size. If the prompt frames a physically large product (bed, furniture, large item) as a small handheld "compact pouch/bag" in a hand close-up, FIX the framing: widen the shot and add a human/room/furniture scale anchor so the real size reads correctly. Keep the user's scene intent and setting. Keep vertical 9:16, photorealistic. CRITICAL RULES: (1) Reproduce the PRODUCT's real design/shape from the reference so it's recognizable, but it is NEVER a readable hero shot — do NOT hold it up centered facing camera with the label legible; keep it secondary, angled, partially cropped, or at a natural distance so the full label is NOT readable. The person/skin/reaction is the subject. NO overlay captions/subtitles/added on-screen text, and NO garbled signage/paragraph text on other objects. (2) Keep the mood warm, bright, clean and aspirational — even a problem/"before" beat stays light and relatable, NEVER genuinely distressing (no crying/upset child, no exhausted despair, no bleak or messy-despair framing, no dark grime). (3) "Arm's-length" / "front camera" / "selfie" / "relaxed arm's-length perspective" describe only the CAMERA DISTANCE and POV — they do NOT mean her arm is extended toward the lens. NEVER render an arm stretched out reaching toward the camera, and NEVER use the arm as a distance measurement or selfie-stick pose. Her arms stay natural: ONE hand holds the product, the OTHER hand is free to gesture (and on a CTA, points a finger down). No phone or camera in frame.`
  // 캐릭터 element(<<<id>>>)가 있으면 element를 지원하는 모델(nano_banana_flash)로 생성하고, 프롬프트 맨 앞에 토큰을 심어 정체성을 주입한다 (로컬 캐릭터 ref 대체).
  const elIds = (Array.isArray(charElementIds) && charElementIds.length ? charElementIds : (charElementId ? [charElementId] : [])).filter(Boolean)
  const hasEl = elIds.length > 0
  const elTok = hasEl ? elIds.map((id) => `<<<${id}>>>`).join(' ') + ' ' : ''
  const model = hasEl ? 'nano_banana_flash' : (total >= 1 ? 'nano_banana_pro' : 'marketing_studio_image')
  let genStep
  if (total >= 1 || hasEl) {
    const setup = labeled.map((x, i) => {
      const isDirect = String(x.r).startsWith('hfmedia:')
      return { n: i + 1, role: x.role, isDirect, id: isDirect ? String(x.r).slice(8).split('|')[0] : null, url: isDirect ? null : x.r }
    })
    const importLines = setup.filter((s) => !s.isDirect).map((s) => `   - media_import_url {"url":"${s.url}","type":"image"} → this is reference ${s.n}`).join('\n')
    const directLines = setup.filter((s) => s.isDirect).map((s) => `   - reference ${s.n} uses already-uploaded media_id ${s.id}`).join('\n')
    const roleList = setup.map((s) => `   reference ${s.n}: ${s.role}`).join('\n')
    const refBlk = total >= 1 ? `Reference photos — set up media (keep each media_id, IN THIS ORDER):\n${importLines}${directLines ? '\n' + directLines : ''}\nReference roles:\n${roleList}\n` : ''
    const roleUse = total >= 1 ? ` Use the references by ROLE: ${characterRef ? 'IDENTITY LOCK — the person in the shot is EXACTLY the CHARACTER reference (same face, hair, skin, age, build); this overrides any appearance wording in the prompt. ' : ''}reproduce the PRODUCT exactly; if an ENVIRONMENT reference is provided, match its setting, space and mood. Only the camera angle / action change.` : ''
    const medias = total >= 1 ? ',"medias":[ one {"value":"<media_id>","role":"image"} for EACH reference above, in order ]' : ''
    genStep = `${refBlk}Then call generate_image {"model":"${model}","prompt":"${elTok}<your scale-corrected prompt>.${roleUse}","aspect_ratio":"9:16"${medias}}.`
      + (hasEl ? `\nCRITICAL: the generate_image prompt MUST begin with these exact token(s) ${elTok.trim()} unchanged — ${elIds.length > 1 ? 'each injects a DIFFERENT character element; render ALL of them together in the scene as the prompt describes (e.g. two people meeting). Keep the prompt naming who does what.' : 'it injects the CHARACTER element (locks her identity: face, hair, look).'} Do NOT remove/alter the token(s), and do NOT describe the character's appearance in words; the element(s) define it.` : '')
  } else {
    genStep = `Call generate_image {"model":"marketing_studio_image","prompt":"<your scale-corrected prompt>","aspect_ratio":"9:16","count":1}.`
  }
  const instr = `You have Higgsfield MCP tools.
${scaleFix}

SCENE PROMPT: "${safe}"

${genStep}
Then call job_status {"jobId":"<id>","sync":true} until status "completed".
Finally print ONLY the final result rawUrl (https URL ending in .png). No other words, no markdown.`
  const out = await runClaude(instr, ['--allowedTools', ...HF_TOOLS, '--model', 'sonnet'], 300000)
  const m = out.match(/https?:\/\/\S+?\.(?:png|jpe?g|webp)/i)
  if (!m) throw new Error('CLI 출력에서 이미지 URL을 찾지 못함: ' + out.slice(-160))
  return m[0]
}
