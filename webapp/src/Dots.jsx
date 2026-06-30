// 진행 중 표시 — 움직이는 점 3개
export default function Dots({ label }) {
  return (
    <span className="working">
      {label}<span className="d" /><span className="d" /><span className="d" />
    </span>
  )
}
