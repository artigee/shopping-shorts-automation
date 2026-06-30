import { AbsoluteFill, Sequence, Img, OffthreadVideo, Audio, useCurrentFrame, interpolate } from 'remotion'

// 하단 자막 (페이드 인) — 영어, US 쇼츠 스타일
const Caption = ({ text, cta }) => {
  const frame = useCurrentFrame()
  const op = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (!text) return null
  return (
    <AbsoluteFill style={{ justifyContent: cta ? 'center' : 'flex-end', alignItems: 'center', padding: '0 70px 170px' }}>
      <div style={{
        opacity: op, transform: `translateY(${(1 - op) * 20}px)`,
        background: cta ? 'rgba(255,206,77,0.95)' : 'rgba(0,0,0,0.6)',
        color: cta ? '#111' : '#fff', fontSize: cta ? 64 : 56, fontWeight: 800,
        padding: '20px 30px', borderRadius: 20, textAlign: 'center',
        fontFamily: 'Helvetica, Arial, sans-serif', maxWidth: '92%', lineHeight: 1.18,
        textShadow: cta ? 'none' : '0 2px 8px rgba(0,0,0,.5)', letterSpacing: '-0.5px',
      }}>{text}</div>
    </AbsoluteFill>
  )
}

const Scene = ({ s }) => {
  const frame = useCurrentFrame()
  const fade = interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) // 크로스 페이드 인
  // 정지 이미지엔 가벼운 Ken Burns
  const scale = s.kind === 'image' ? interpolate(frame, [0, s.durationInFrames || 90], [1.06, 1.12]) : 1
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: '#000' }}>
      {s.kind === 'video'
        ? <OffthreadVideo src={s.src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <Img src={s.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }} />}
      {s.audio ? <Audio src={s.audio} /> : null}
      <Caption text={s.caption} cta={s.cta} />
    </AbsoluteFill>
  )
}

export const Short = ({ scenes = [] }) => {
  let acc = 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {scenes.map((s, i) => {
        const dur = Math.max(15, s.durationInFrames || 90)
        const from = acc; acc += dur
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Scene s={s} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
