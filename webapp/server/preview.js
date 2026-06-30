// 임시 프리뷰 무비 — ffmpeg로 씬별 (클립 or 정지이미지) + VO를 이어붙임 (Higgsfield 아님, 테스트용).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const W = 720, H = 1280

function run(cmd, args, timeout = 180000) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); rej(new Error(cmd + ' timeout')) }, timeout)
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => { clearTimeout(t); rej(e) })
    p.on('close', (c) => { clearTimeout(t); c === 0 ? res() : rej(new Error(`${cmd} exit ${c}: ${err.slice(-300)}`)) })
  })
}
function probe(file) {
  return new Promise((res) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file])
    let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(parseFloat(o) || 0)); p.on('error', () => res(0))
  })
}
const local = (dir, rel) => (rel ? path.join(dir, path.basename(rel)) : null)

// scenes 순서대로 합성 → outPath (mp4). 각 씬: video 있으면 클립, 없으면 image 정지. audio 있으면 VO.
export async function buildPreview(dir, scenes, outPath) {
  const segs = []
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    const vid = local(dir, s.video); const img = local(dir, s.image); const aud = local(dir, s.audio)
    // 애니메이션(makeVideo) 씬만 클립 사용, 정지 씬은 이미지 사용
    const hasV = s.makeVideo && vid && fs.existsSync(vid); const hasI = img && fs.existsSync(img)
    if (!hasV && !hasI) continue
    const hasA = aud && fs.existsSync(aud)
    let dur = Math.max(2, Math.min(15, Number(s.durationSec) || 4))
    if (hasV) { const vd = await probe(vid); if (vd > 0) dur = Math.min(vd, 15) }
    if (hasA) { const ad = await probe(aud); if (ad > dur) dur = Math.min(ad + 0.3, 15) } // VO가 길면 맞춰 늘림
    const seg = path.join(dir, `seg-${i + 1}.mp4`)
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`
    const args = ['-y']
    if (hasV) args.push('-i', vid); else args.push('-loop', '1', '-i', img)
    if (hasA) args.push('-i', aud); else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    args.push('-t', String(dur),
      '-filter_complex', `[0:v]${vf}[v];[1:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-ar', '44100', seg)
    await run('ffmpeg', args)
    segs.push(seg)
  }
  if (!segs.length) throw new Error('합성할 씬이 없습니다 (이미지나 클립을 먼저 생성하세요).')
  const listFile = path.join(dir, 'concat.txt')
  fs.writeFileSync(listFile, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'))
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath])
  segs.forEach((s) => { try { fs.unlinkSync(s) } catch {} })
  try { fs.unlinkSync(listFile) } catch {}
  return outPath
}
