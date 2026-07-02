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
  const o = data.overall || {}
  const ctx = { persona: data.persona || '—', hook: data.hook || '—', angle: o.angle || '—' }
  const midY = 100 + Math.max(0, scenes.length - 1) * PITCH / 2
  const mk = (x) => { nodes.push(x); return x }
  const ar = data.analysisRow || {}, p = data.product || {}

  mk({ id: 'in-0', role: 'input', hd: 'persona', t: ctx.persona, sub: 'VO voice', x: COL.input, y: 100, data: { value: data.persona || '' } })
  mk({ id: 'in-1', role: 'input', hd: 'hook', t: ctx.hook, sub: 'story shape', x: COL.input, y: 240, data: { value: data.hook || '' } })
  mk({ id: 'analysis', role: 'analysis', kind: 'analysis', hd: 'reel', x: COL.input, y: 400, thumb: ar.reel_thumbnail || null, t: ar.reel_username ? '@' + ar.reel_username : '', data: { '@': ar.reel_username, caption: ar.reel_caption, category: ar.category, url: ar.reel_url, product: p.title, price: p.price } })
  mk({ id: 'overall', role: 'overall', kind: 'overall', hd: 'overall', x: COL.overall, y: midY, t: ctx.angle, data: { angle: o.angle || '', hookLine: o.hookLine || '', cta: o.cta || '', vo: o.vo || '', beats: Array.isArray(o.beats) ? o.beats.join('\n') : (o.beats || '') } })
  mk({ id: 'movie', role: 'movie', kind: 'movie', hd: 'final movie', x: COL.movie, y: midY, video: media(data.export_mp4 || data.preview), sub: (data.final_form === 'movie' ? 'movie' : 'card') + ' · ' + scenes.length + ' scenes', data: { final_form: data.final_form || 'card', scenes: scenes.length } })
  edges.push({ from: 'analysis', to: 'overall', cls: 'global' }, { from: 'in-0', to: 'overall', cls: 'global' }, { from: 'in-1', to: 'overall', cls: 'global' })

  scenes.forEach((s, i) => {
    const k = i + 1, y = 100 + (k - 1) * PITCH
    mk({ id: 'script-' + k, role: 'script', kind: 'script', hd: 'scene ' + k, x: COL.script, y, scene: k, t: s.onScreenText || '', data: { onScreenText: s.onScreenText || '', vo: s.vo || '' } })
    mk({ id: 'prompt-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y, scene: k, t: (s.imagePrompt || '').slice(0, 90), data: { prompt: s.imagePrompt || '' } })
    mk({ id: 'promptV-' + k, role: 'prompt', kind: 'prompt', promptType: 'vo', hd: 'scene ' + k, x: COL.prompt, y: y + 150, scene: k, t: (s.voEn || s.vo || '').slice(0, 90), data: { prompt: s.voEn || s.vo || '' } })
    mk({ id: 'image-' + k, role: 'image', kind: 'image', hd: 'scene ' + k, x: COL.image, y, scene: k, thumb: media(s.image), data: { imagePrompt: s.imagePrompt || '', aspect: '9:16', image: s.image || '' } })
    mk({ id: 'vo-' + k, role: 'vo', kind: 'vo', hd: 'scene ' + k, x: COL.vo, y, scene: k, audio: media(s.audio), data: { voiceId: data.persona || 'default', audio: s.audio || '' } })
    const clip = s.makeVideo !== false
    if (clip) {
      mk({ id: 'promptM-' + k, role: 'prompt', kind: 'prompt', promptType: 'motion', hd: 'scene ' + k, x: COL.prompt, y: y + 75, scene: k, t: (s.motionPrompt || '').slice(0, 90), data: { prompt: s.motionPrompt || '' } })
      mk({ id: 'clip-' + k, role: 'clip', kind: 'clip', hd: 'scene ' + k, x: COL.clip, y, scene: k, video: media(s.video), image: media(s.image), cameraMove: s.cameraMove, data: { cameraMove: s.cameraMove || '', makeVideo: s.makeVideo === false ? 'still' : 'animate', duration: s.durationSec || 4 } })
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
  const [top, setTop] = useState(96) // fill the whole window below the webapp header
  const [selId, setSel] = useState(null)
  const [drawerH, setDrawerH] = useState(240)
  const [menu, setMenu] = useState(null) // context menu {sx, sy, wx, wy, nodeId?}
  const nodeRefs = useRef({})
  const pan = useRef(null)
  const drag = useRef(null)
  const dh = useRef(null) // drawer resize

  useLayoutEffect(() => { const h = document.querySelector('header')?.offsetHeight; if (h) setTop(h) }, [])

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

  const [ng, setNg] = useState({ nodes: [], edges: [] })
  useEffect(() => { setNg(data ? buildGraph(data) : { nodes: [], edges: [] }) }, [data])
  const graph = ng
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
  function startNodeDrag(ev, n) {
    if (ev.target.closest('video, button, select, a, .ng-del')) return
    ev.stopPropagation()
    drag.current = { id: n.id, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false }
  }
  function onDown(ev) { if (ev.target.closest('video, select, button')) return; pan.current = { sx: ev.clientX, sy: ev.clientY, x: view.x, y: view.y } }
  function onMove(ev) {
    if (drag.current) {
      const d = drag.current, dx = (ev.clientX - d.sx) / view.k, dy = (ev.clientY - d.sy) / view.k
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 3) d.moved = true
      setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: d.ox + dx, y: d.oy + dy } : n) }))
      return
    }
    if (!pan.current) return
    setView((v) => ({ ...v, x: pan.current.x + (ev.clientX - pan.current.sx), y: pan.current.y + (ev.clientY - pan.current.sy) }))
  }
  function onUp() {
    if (drag.current) {
      const d = drag.current; drag.current = null
      if (!d.moved) setSel(d.id) // click (no drag) → select → open drawer
      else setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: Math.round(n.x / 20) * 20, y: Math.round(n.y / 20) * 20 } : n) }))
    }
    pan.current = null
  }
  function deleteNode(id) {
    setNg((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }))
    if (selId === id) setSel(null)
  }
  function updateField(id, key, val) {
    setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, data: { ...n.data, [key]: val } } : n) }))
  }
  function startDrawerResize(ev) {
    ev.preventDefault()
    const sy = ev.clientY, h0 = drawerH
    const mv = (e) => setDrawerH(Math.min(560, Math.max(120, h0 - (e.clientY - sy))))
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  function addNode(kind, wx, wy) {
    const id = kind + '-' + Math.round(wx) + '-' + Math.round(wy)
    setNg((g) => ({ ...g, nodes: [...g.nodes, { id, role: kind, kind, hd: kind, x: Math.round(wx / 20) * 20, y: Math.round(wy / 20) * 20, data: {}, dirty: true }] }))
    setMenu(null)
  }
  function onCanvasMenu(ev) {
    ev.preventDefault()
    const r = ev.currentTarget.getBoundingClientRect()
    setMenu({ sx: ev.clientX, sy: ev.clientY, wx: (ev.clientX - r.left - view.x) / view.k, wy: (ev.clientY - r.top - view.y) / view.k })
  }
  const selNode = nodeById[selId]

  return (
    <div className="ng-wrap" style={{ top }}>
      <div className="ng-bar">
        <select value={cid ?? ''} onChange={(e) => setCid(Number(e.target.value))}>
          {list.map((c) => <option key={c.id} value={c.id}>#{c.id} {(c.title || 'untitled').slice(0, 30)}</option>)}
        </select>
      </div>
      {err && <div className="ng-err">{err}</div>}
      <div className="ng-canvas" onWheel={onWheel} onPointerDown={(e) => { if (!e.target.closest('.ng-node')) setSel(null); onDown(e) }} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={onCanvasMenu}>
        <div className="ng-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}>
          <svg className="ng-edges">
            {paths.map((p) => <path key={p.key} d={p.d} stroke={p.color} strokeWidth="1.6" fill="none" strokeDasharray={p.dashed ? '5 4' : 'none'} opacity={p.dashed ? 0.5 : 0.9} />)}
          </svg>
          {graph.nodes.map((n) => {
            const c = nodeColor(n), tl = typeLabel(n)
            return (
              <div key={n.id} ref={(el) => (nodeRefs.current[n.id] = el)} className={'ng-node tier-' + tierOf(n) + (n.id === selId ? ' sel' : '') + (n.dirty ? ' dirty' : '')} style={{ left: n.x, top: n.y, width: NODE_W, borderColor: (n.id === selId ? c : c + '99') }} onPointerDown={(e) => startNodeDrag(e, n)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ sx: e.clientX, sy: e.clientY, nodeId: n.id }) }}>
                {tl && <span className="ng-type" style={{ color: c, borderColor: c + '66' }}>{tl}</span>}
                <button className="ng-del" title="delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id) }}>×</button>
                {n.kind === 'image' && (n.thumb ? <img className="ng-thumb" src={n.thumb} loading="lazy" onError={(e) => { e.target.style.opacity = .2 }} /> : <div className="ng-thumb ph">9:16</div>)}
                {n.kind === 'clip' && (n.video ? <video className="ng-thumb" src={n.video} muted loop playsInline preload="metadata" onMouseOver={(e) => e.target.play()} onMouseOut={(e) => e.target.pause()} /> : n.image ? <img className="ng-thumb" style={{ opacity: .4 }} src={n.image} /> : null)}
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

      {menu && (
        <>
          <div className="ng-menu-bd" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="ng-menu" style={{ left: menu.sx, top: menu.sy }}>
            {menu.nodeId
              ? <button onClick={() => { deleteNode(menu.nodeId); setMenu(null) }}>🗑 delete</button>
              : ['node', 'template', 'function', 'skill'].map((k) => <button key={k} onClick={() => addNode(k, menu.wx, menu.wy)}>＋ {k}</button>)}
          </div>
        </>
      )}

      {selNode && (
        <div className="ng-drawer" style={{ height: drawerH }}>
          <div className="ng-drawer-grip" onPointerDown={startDrawerResize} />
          <div className="ng-drawer-head">
            {typeLabel(selNode) && <span className="ng-type static" style={{ color: nodeColor(selNode), borderColor: nodeColor(selNode) + '66' }}>{typeLabel(selNode)}</span>}
            <b>{selNode.hd}</b>
            <span className="ng-id">#{selNode.id}{selNode.dirty ? ' · stale' : ''}</span>
            <span style={{ flex: 1 }} />
            <button className="ng-x" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="ng-drawer-body">
            {Object.entries(selNode.data || {}).map(([k, v]) => (
              <label key={k} className="ng-field">
                <span>{k}</span>
                <textarea value={v ?? ''} rows={String(v || '').length > 60 ? 3 : 1} onChange={(e) => updateField(selNode.id, k, e.target.value)} />
              </label>
            ))}
            {(!selNode.data || !Object.keys(selNode.data).length) && <div className="ng-id">no editable fields</div>}
          </div>
        </div>
      )}
    </div>
  )
}
