import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from './util.js'
import './nodegraph.css'

// ⑤ Node graph — READ-ONLY render of a content (④) as a node graph.
// Ported from prototypes/node-studio.html build/render logic. Non-destructive:
// the existing ④ ContentsView (form) is untouched; this is a separate view.
// Next steps (after your feedback): dragging, node inspector, wiring actions to the ④ endpoints.

const COL = { input: 40, overall: 300, script: 560, prompt: 820, image: 1080, clip: 1340, vo: 1600, movie: 1860 }
const NODE_W = 210, PITCH = 280
const TIER = { data: '#8790b5', special: '#4f9fe0', general: '#5DCAA5' }
const EDGE_COLOR = { flow: '#7d8590', global: '#9a86c8', audio: '#e0c85d' }

const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
const media = (u) => { if (!u) return null; if (u.indexOf('|/output/') >= 0) u = u.split('|')[1]; return u }

function adapt(resp) {
  const c = resp.content || resp
  return {
    id: c.id, title: c.title, persona: c.persona, hook: c.hook, final_form: c.final_form,
    export_mp4: c.export_mp4, preview: c.preview,
    analysisRow: resp.analysis || {}, product: resp.product || parse(c.product) || {},
    scenes: parse(c.scenes) || [], overall: parse(c.overall) || null,
  }
}

function tierOf(n) {
  if (['overall', 'movie', 'script'].includes(n.kind)) return 'special'
  if (['prompt', 'image', 'clip', 'vo'].includes(n.kind)) return 'general'
  return 'data'
}
const nodeColor = (n) => TIER[tierOf(n)]
function typeLabel(n) {
  if (n.role === 'input') return ''
  if (n.promptType === 'motion') return 'motion prompt'
  if (n.promptType === 'vo') return 'VO text'
  const map = { prompt: 'image prompt', analysis: 'analysis', overall: 'overall', script: 'scene script', image: 'image gen', clip: 'clip gen', vo: 'VO gen', movie: 'movie' }
  return map[n.kind] || ''
}
const hasInput = (n) => !(n.role === 'input' || n.kind === 'analysis')

function buildGraph(data) {
  const nodes = [], edges = []
  const scenes = data.scenes || []
  const ctx = { persona: data.persona || '—', hook: data.hook || '—', angle: data.overall?.angle || '—' }
  const midY = 100 + Math.max(0, scenes.length - 1) * PITCH / 2
  const mk = (o) => { nodes.push(o); return o }
  const ar = data.analysisRow || {}

  mk({ id: 'in-0', role: 'input', hd: 'persona', t: ctx.persona, sub: 'VO voice', x: COL.input, y: 100 })
  mk({ id: 'in-1', role: 'input', hd: 'hook', t: ctx.hook, sub: 'story shape', x: COL.input, y: 240 })
  mk({ id: 'analysis', role: 'analysis', kind: 'analysis', hd: 'reel', x: COL.input, y: 400, thumb: ar.reel_thumbnail || null, t: ar.reel_username ? '@' + ar.reel_username : '' })
  mk({ id: 'overall', role: 'overall', kind: 'overall', hd: 'overall', x: COL.overall, y: midY, t: ctx.angle })
  mk({ id: 'movie', role: 'movie', kind: 'movie', hd: 'final movie', x: COL.movie, y: midY, video: media(data.export_mp4 || data.preview), sub: (data.final_form === 'movie' ? 'movie' : 'card') + ' · ' + scenes.length + ' scenes' })
  edges.push({ from: 'analysis', to: 'overall', cls: 'global' }, { from: 'in-0', to: 'overall', cls: 'global' }, { from: 'in-1', to: 'overall', cls: 'global' })

  scenes.forEach((s, i) => {
    const k = i + 1, y = 100 + (k - 1) * PITCH
    mk({ id: 'script-' + k, role: 'script', kind: 'script', hd: 'scene ' + k, x: COL.script, y, t: s.onScreenText || '' })
    mk({ id: 'prompt-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y, t: (s.imagePrompt || '').slice(0, 90) })
    mk({ id: 'promptV-' + k, role: 'prompt', kind: 'prompt', promptType: 'vo', hd: 'scene ' + k, x: COL.prompt, y: y + 150, t: (s.voEn || s.vo || '').slice(0, 90) })
    mk({ id: 'image-' + k, role: 'image', kind: 'image', hd: 'scene ' + k, x: COL.image, y, thumb: media(s.image) })
    mk({ id: 'vo-' + k, role: 'vo', kind: 'vo', hd: 'scene ' + k, x: COL.vo, y, audio: media(s.audio) })
    const clip = s.makeVideo !== false
    if (clip) {
      mk({ id: 'promptM-' + k, role: 'prompt', kind: 'prompt', promptType: 'motion', hd: 'scene ' + k, x: COL.prompt, y: y + 75, t: (s.motionPrompt || '').slice(0, 90) })
      mk({ id: 'clip-' + k, role: 'clip', kind: 'clip', hd: 'scene ' + k, x: COL.clip, y, video: media(s.video), image: media(s.image), cameraMove: s.cameraMove })
    }
    edges.push({ from: 'overall', to: 'script-' + k, cls: 'flow' }, { from: 'in-0', to: 'script-' + k, cls: 'global' }, { from: 'in-1', to: 'script-' + k, cls: 'global' })
    edges.push({ from: 'script-' + k, to: 'prompt-' + k, cls: 'flow' }, { from: 'prompt-' + k, to: 'image-' + k, cls: 'flow' })
    edges.push({ from: 'script-' + k, to: 'promptV-' + k, cls: 'flow' }, { from: 'promptV-' + k, to: 'vo-' + k, cls: 'flow' }, { from: 'in-0', to: 'vo-' + k, cls: 'global' })
    if (clip) {
      edges.push({ from: 'script-' + k, to: 'promptM-' + k, cls: 'flow' }, { from: 'promptM-' + k, to: 'clip-' + k, cls: 'flow' })
      edges.push({ from: 'image-' + k, to: 'clip-' + k, cls: 'flow' }, { from: 'clip-' + k, to: 'movie', cls: 'flow' })
    } else edges.push({ from: 'image-' + k, to: 'movie', cls: 'flow' })
    edges.push({ from: 'vo-' + k, to: 'movie', cls: 'audio' })
  })
  return { nodes, edges }
}

export default function NodeGraphView() {
  const [list, setList] = useState([])
  const [cid, setCid] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [view, setView] = useState({ x: 30, y: 20, k: 0.62 })
  const [heights, setHeights] = useState({})
  const nodeRefs = useRef({})
  const pan = useRef(null)

  useEffect(() => {
    api('/api/contents').then((cs) => {
      setList(cs)
      setCid((prev) => prev ?? (cs.find((c) => c.id === 27)?.id ?? cs.find((c) => c.scenes)?.id ?? cs[0]?.id ?? null))
    }).catch((e) => setErr(String(e.message || e)))
  }, [])
  useEffect(() => {
    if (cid == null) return
    setData(null); setErr(null)
    api(`/api/contents/${cid}`).then((r) => setData(adapt(r))).catch((e) => setErr(String(e.message || e)))
  }, [cid])

  const graph = useMemo(() => (data ? buildGraph(data) : { nodes: [], edges: [] }), [data])
  const nodeById = useMemo(() => { const m = {}; graph.nodes.forEach((n) => (m[n.id] = n)); return m }, [graph])

  useLayoutEffect(() => {
    const h = {}; graph.nodes.forEach((n) => { const el = nodeRefs.current[n.id]; if (el) h[n.id] = el.offsetHeight })
    setHeights(h)
  }, [graph])

  const anchor = (n, side) => ({ x: n.x + (side === 'out' ? NODE_W : 0), y: n.y + (heights[n.id] || 90) / 2 })
  const paths = graph.edges.map((e, i) => {
    const a = nodeById[e.from], b = nodeById[e.to]; if (!a || !b) return null
    const p1 = anchor(a, 'out'), p2 = anchor(b, 'in'), dx = Math.max(40, (p2.x - p1.x) * 0.5)
    return { key: i, d: `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`, color: EDGE_COLOR[e.cls] || '#7d8590', dashed: e.cls === 'global' }
  }).filter(Boolean)

  function onWheel(ev) {
    ev.preventDefault()
    const rect = ev.currentTarget.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    setView((v) => {
      const k = Math.min(2, Math.max(0.2, v.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)))
      return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }
    })
  }
  function onDown(ev) { if (ev.target.closest('video, select, button')) return; pan.current = { sx: ev.clientX, sy: ev.clientY, x: view.x, y: view.y } }
  function onMove(ev) { if (!pan.current) return; setView((v) => ({ ...v, x: pan.current.x + (ev.clientX - pan.current.sx), y: pan.current.y + (ev.clientY - pan.current.sy) })) }
  function onUp() { pan.current = null }

  return (
    <div className="ng-wrap">
      <div className="ng-bar">
        <b>노드 그래프</b>
        <select value={cid ?? ''} onChange={(e) => setCid(Number(e.target.value))}>
          {list.map((c) => <option key={c.id} value={c.id}>#{c.id} {(c.title || 'untitled').slice(0, 30)}</option>)}
        </select>
        <span className="ng-muted">read-only · wheel = zoom · drag = pan</span>
      </div>
      {err && <div className="ng-err">{err}</div>}
      <div className="ng-canvas" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <div className="ng-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}>
          <svg className="ng-edges">
            {paths.map((p) => <path key={p.key} d={p.d} stroke={p.color} strokeWidth="1.6" fill="none" strokeDasharray={p.dashed ? '5 4' : 'none'} opacity={p.dashed ? 0.5 : 0.9} />)}
          </svg>
          {graph.nodes.map((n) => {
            const c = nodeColor(n), tl = typeLabel(n)
            return (
              <div key={n.id} ref={(el) => (nodeRefs.current[n.id] = el)} className={'ng-node tier-' + tierOf(n)} style={{ left: n.x, top: n.y, width: NODE_W, borderColor: c + '99' }}>
                {tl && <span className="ng-type" style={{ color: c, borderColor: c + '66' }}>{tl}</span>}
                {n.kind === 'image' && (n.thumb ? <img className="ng-thumb" src={n.thumb} loading="lazy" onError={(e) => { e.target.style.opacity = .2 }} /> : <div className="ng-thumb ph">9:16</div>)}
                {n.kind === 'clip' && (n.video ? <video className="ng-thumb" src={n.video} muted loop playsInline preload="metadata" /> : n.image ? <img className="ng-thumb" style={{ opacity: .4 }} src={n.image} /> : null)}
                {n.kind === 'movie' && n.video && <video className="ng-thumb" src={n.video} controls playsInline preload="metadata" />}
                {n.kind === 'analysis' && n.thumb && <img className="ng-thumb" src={n.thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
                <div className="ng-hd" style={{ color: c }}><span className="ng-dot" style={{ background: c }} />{n.hd}</div>
                {n.t && <div className="ng-t">{n.t}</div>}
                {n.sub && <div className="ng-sub">{n.sub}</div>}
                {n.kind === 'vo' && <div className="ng-sub">{n.audio ? '🔊 VO ready' : 'no VO yet'}</div>}
                {n.kind === 'clip' && <div className="ng-pill">🎥 {n.cameraMove || 'default'}</div>}
                {hasInput(n) && <span className="ng-port in" style={{ borderColor: c }} />}
                <span className="ng-port out" style={{ borderColor: c }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
