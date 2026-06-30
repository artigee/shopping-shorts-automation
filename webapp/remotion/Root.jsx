import { Composition } from 'remotion'
import { Short } from './Short.jsx'

const FPS = 30, W = 1080, H = 1920

export const RemotionRoot = () => (
  <Composition
    id="Short"
    component={Short}
    durationInFrames={300}
    fps={FPS}
    width={W}
    height={H}
    defaultProps={{ scenes: [] }}
    calculateMetadata={({ props }) => {
      const total = (props.scenes || []).reduce((a, s) => a + Math.max(15, s.durationInFrames || 90), 0) || 90
      return { durationInFrames: total }
    }}
  />
)
