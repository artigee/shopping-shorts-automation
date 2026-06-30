// 릴스 영상 분석 파이프라인:
//   다운로드(CDP) → 키프레임(ffmpeg) → 비전 분석(claude CLI) → 훅/구조/씬스크립트/에셋
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(__dirname, '../data')
const CDP_URL = process.env.CDP_URL || 'http://localhost:9222'
const CLI_MODEL = process.env.ANALYZE_CLI_MODEL || 'sonnet' // 비전+추론 → sonnet 권장

// ── 유틸: 자식 프로세스 실행 ──
function run(cmd, args, { timeout = 60000, input } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error(`${cmd} timeout`)) }, timeout)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(t); rej(e) })
    child.on('close', (code) => { clearTimeout(t); code === 0 ? res(out) : rej(new Error(`${cmd} exit ${code}: ${err.slice(-300)}`)) })
  })
}

// ── 1) 릴스 mp4 다운로드 (디버그 크롬으로 영상 URL 캡처) ──
export async function downloadReel(reelUrl, outPath) {
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 4000 })
  } catch {
    const e = new Error('디버그 크롬에 못 붙음 — launch-chrome.sh 로 크롬을 먼저 띄워주세요.')
    e.code = 'CHROME_NOT_FOUND'; throw e
  }
  const ctx = browser.contexts()[0] || (await browser.newContext())
  const page = await ctx.newPage()
  let intercepted = null
  page.on('response', (r) => { const u = r.url(); if (!intercepted && /\.mp4/i.test(u) && /fbcdn|cdninstagram/i.test(u)) intercepted = u })
  try {
    await page.goto(reelUrl, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(3500)
    // 1순위: 페이지 HTML의 video_versions (전체 파일). 2순위: 가로챈 mp4.
    const fromHtml = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/"video_versions":\[\{[^]*?"url":"([^"]+\.mp4[^"]*)"/)
      return m ? m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/') : null
    })
    const mp4 = fromHtml || intercepted
    if (!mp4) throw new Error('영상 URL을 못 찾음 (릴스가 아니거나 로그인/페이지 구조 문제)')
    const resp = await fetch(mp4)
    if (!resp.ok) throw new Error('영상 다운로드 실패 HTTP ' + resp.status)
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length < 20000) throw new Error('받은 영상이 너무 작음(' + buf.length + 'B) — 다운로드 깨짐')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, buf)
    return { path: outPath, bytes: buf.length, src: mp4 }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

// 길이 측정 — format 우선, 안 되면 비디오 스트림, 그래도 안 되면 0
async function probeDuration(p) {
  const tries = [
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', p],
  ]
  for (const args of tries) {
    try { const d = parseFloat(await run('ffprobe', args, { timeout: 15000 })); if (d > 0) return d } catch { /* 다음 시도 */ }
  }
  return 0
}

// ── 2) ffmpeg 키프레임 추출 (균등 N장, 480px) — EOF 안전 + 프레임별 실패 허용 ──
export async function extractFrames(mp4Path, outDir, n = 9) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const dur = await probeDuration(mp4Path)
  let stamps
  if (dur > 1) {
    const lo = 0.3, hi = Math.max(lo + 0.1, dur - 0.3) // 끝보다 살짝 앞까지만
    stamps = Array.from({ length: n }, (_, i) => +(lo + (hi - lo) * (i + 0.5) / n).toFixed(2))
  } else {
    stamps = Array.from({ length: n }, (_, i) => i + 1) // 길이 미상 → 1s..n, EOF 만나면 중단
  }

  const frames = []
  let idx = 1
  for (const t of stamps) {
    const out = resolve(outDir, `f${String(idx).padStart(2, '0')}.jpg`)
    try {
      await run('ffmpeg', ['-y', '-ss', String(t), '-i', mp4Path, '-frames:v', '1', '-vf', 'scale=480:-1', '-q:v', '4', out], { timeout: 30000 })
      if (existsSync(out)) { frames.push(out); idx++ }
    } catch {
      if (dur <= 1) break // 길이 미상 모드: 첫 실패 = 영상 끝
      // 길이 있음: 이 타임스탬프만 스킵하고 계속
    }
  }
  if (!frames.length) {
    throw new Error('프레임을 한 장도 못 뽑았습니다 — 영상 다운로드가 깨졌을 수 있어요(파일 크기/형식 확인).')
  }
  return { duration: dur || frames.length, frames }
}

function stripFence(t = '') {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : t).trim()
}

// ── 3) Claude 비전 분석 → 구조화 JSON ──
export async function analyzeFrames({ frames, caption, duration, productName, lang = 'English (US)' }) {
  const prompt = `You analyze Amazon-affiliate shopping shorts. Below are time-ordered keyframes of one Instagram shopping reel plus its caption. Analyze its STRUCTURE so we can remake it (pick-and-assemble), and output JSON.
Write all human-readable text fields (openingLine, why, pacing, cta, onScreenText, vo, beats, need) natively in ${lang} (the target audience's language — preserve regional nuance; do not translate). Keep JSON keys/enums in English.

Product: ${productName || '(unspecified)'}
Video length: ${Math.round(duration)}s
Caption: ${(caption || '').replace(/\s+/g, ' ').slice(0, 600)}

Keyframes (in order):
${frames.map((f, i) => `[${i + 1}] ${f}`).join('\n')}

Output ONLY JSON (no explanation):
{
 "hook": {"family":"curiosity|list|urgency|social-proof|transformation","openingLine":"the first 1-2s hook line (in ${lang})","why":"one line: why it holds attention"},
 "structure": {"format":"single|roundup","beats":["beat1","beat2","..."],"pacing":"cut speed/rhythm, one line","cta":"final CTA / funnel form"},
 "sceneScript": [{"t":"0-2s","shot":"shot (angle/movement)","onScreenText":"on-screen caption (in ${lang})","vo":"VO narration (in ${lang})","durationSec":2}],
 "assets": [{"scene":1,"need":"footage/image needed","type":"footage|image|ai"}]
}`
  const out = await run('claude', ['-p', prompt, '--model', CLI_MODEL], { timeout: 120000 })
  const obj = JSON.parse(stripFence(out))
  return obj
}

// ── 전체 실행 ──
export async function analyzeReel({ code, url, caption, productName, lang }) {
  const mp4 = resolve(DATA, 'reels', `${code}.mp4`)
  const dl = await downloadReel(url, mp4)
  const { duration, frames } = await extractFrames(mp4, resolve(DATA, 'frames', code))
  const analysis = await analyzeFrames({ frames, caption, duration, productName, lang })
  return { ...analysis, _meta: { duration, frameCount: frames.length, bytes: dl.bytes } }
}
