// Remotion 정식 익스포트 — scenes(이미지/클립 + 자막 + VO)를 9:16 mp4로 렌더.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { bundle } from '@remotion/bundler'
import { selectComposition, renderMedia } from '@remotion/renderer'

const FPS = 30
let bundleCache = null
async function getBundle() {
  if (!bundleCache) bundleCache = await bundle({ entryPoint: path.resolve('remotion/index.jsx') })
  return bundleCache
}

export function probeDuration(file) {
  return new Promise((res) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file])
    let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(parseFloat(o) || 0)); p.on('error', () => res(0))
  })
}

// scenes: [{ kind:'image'|'video', src(URL), audio(URL|null), caption, cta, durationInFrames }]
export async function renderShort({ scenes, outPath, onProgress }) {
  const serveUrl = await getBundle()
  const inputProps = { scenes }
  const composition = await selectComposition({ serveUrl, id: 'Short', inputProps })
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: outPath, inputProps,
    onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  })
  return outPath
}

export { FPS }
