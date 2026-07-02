import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from './util.js'
import './nodegraph.css'

// ⑤ Content Gen — node graph for ④ content, ported faithfully from prototypes/node-studio.html.
// Same node model (KIND registry, typed inputs), same drawer layout. Read/edit is local (dirty);
// wiring/run to the ④ endpoints is the next block.

const COL = { input: 40, overall: 300, script: 560, prompt: 820, image: 1080, clip: 1340, vo: 1600, movie: 1860 }
const NODE_W = 210, PITCH = 280
const COLOR = { product: '#378ADD', character: '#b98be0', environment: '#7fc7a0', ref: '#5DCAA5' }
const TIERCOLOR = { data: '#8790b5', special: '#4f9fe0', general: '#5DCAA5' }
const EDGE_COLOR = { flow: '#7d8590', global: '#9a86c8', audio: '#e0c85d', product: '#378ADD', character: '#b98be0', environment: '#7fc7a0' }

// node-kind registry — CONFIRMED contracts + typed ports (mirror of node-studio.html)
const KIND = {
  analysis: { out: { t: 'analysis', n: 'reel structure' }, source: true, editor: { field: 'angle', label: 'structure / angle (from reel analysis)' }, config: [] },
  overall: { out: { t: 'text', n: 'scene[] · N ordered', array: true }, editor: { field: 'vo', label: 'overall VO — the through-line' },
    config: [{ f: 'shotCount', ph: 'auto | 1-9  (# scene scripts)' }, { f: 'direction', ph: 'hook·shot direction' }, { f: 'angle' }, { f: 'hookLine' }, { f: 'cta' }, { f: 'beats' }, { f: 'guidance', ph: 'steer re-run' }] },
  script: { out: { t: 'text', n: 'Title + VO' }, editor: { field: 'vo', label: 'scene VO' }, config: [{ f: 'title', ph: 'on-screen title' }, { f: 'guidance', ph: 'steer re-run' }] },
  prompt: { out: { t: 'text', n: 'prompt text' }, editor: { field: 'prompt', label: 'prompt' }, config: [{ f: 'guidance', ph: 'idea / instruction' }] },
  image: { out: { t: 'image', n: 'scene .png' }, config: [{ f: 'frameRole', choices: ['start', 'end'] }, { f: 'aspect', choices: ['9:16', '4:5', '1:1', '16:9'] }, { f: 'model', choices: ['auto', 'nano_banana_pro', 'marketing_studio_image'] }, { f: 'style', ph: 'all-scene style' }, { f: 'seed', ph: 'random' }, { f: 'guidance', ph: 'steer re-run' }] },
  clip: { out: { t: 'video', n: 'clip .mp4' }, config: [{ f: 'makeVideo', choices: ['animate', 'still'] }, { f: 'cameraMove', cameraLib: true }, { f: 'duration' }, { f: 'model', choices: ['kling3_0', 'seedance', 'hailuo', 'wan', 'kling3_0_turbo'] }] },
  vo: { out: { t: 'audio', n: '.mp3' }, config: [{ f: 'voiceId' }, { f: 'lang', fixed: 'US EN' }] },
  movie: { out: { t: 'video', n: 'final .mp4' }, config: [{ f: 'final_form', choices: ['card', 'movie'] }, { f: 'exportMode', choices: ['preview', 'remotion'] }, { f: 'fps', fixed: '30' }, { f: 'outputDir', ph: 'output/ (folder)' }, { f: 'outputName', ph: '{product}_{hook}_v1' }] },
  template: { out: { t: 'graph', n: 'reusable subgraph' }, config: [] },
  function: { out: { t: 'data', n: 'typed output' }, config: [] },
  skill: { out: { t: 'data', n: 'skill result' }, editor: { field: 'goal', label: 'goal / args' }, config: [] },
}
const INPUTS = {
  overall: [{ key: 'analysis', type: 'analysis' }, { key: 'persona', type: 'persona' }, { key: 'hook', type: 'hook' }],
  script: [{ key: 'overall', type: 'text', label: 'overall · scene[]' }, { key: 'persona', type: 'persona' }, { key: 'hook', type: 'hook' }],
  prompt: [{ key: 'script', type: 'text', label: 'scene script (Title + VO)' }],
  image: [{ key: 'prompt', type: 'text', label: 'image prompt' }],
  clip: [{ key: 'startImage', type: 'image', frame: 'start', label: 'start image (required)' }, { key: 'endImage', type: 'image', frame: 'end', label: 'end image (optional · 2nd keyframe)' }, { key: 'motion', type: 'text', label: 'motion prompt' }, { key: 'animationRef', type: 'video', label: 'animation ref (acting · motion transfer)' }],
  vo: [{ key: 'voText', type: 'text', label: 'VO text' }, { key: 'persona', type: 'persona', label: 'persona (voice)' }],
  movie: [{ key: 'clips', type: 'video', label: 'clips', multi: true }, { key: 'stills', type: 'image', label: 'stills', multi: true }, { key: 'audio', type: 'audio', label: 'VO audio', multi: true }],
}
Object.keys(INPUTS).forEach((k) => { if (KIND[k]) KIND[k].inputs = INPUTS[k] })

const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
const media = (u) => { if (!u) return null; if (u.indexOf('|/output/') >= 0) u = u.split('|')[1]; return u }
const aspectCSS = (a) => String(a || '9:16').replace(':', '/')

function tierOf(n) { if (['overall', 'movie', 'script'].includes(n.kind)) return 'special'; if (n.kind && KIND[n.kind] && !KIND[n.kind].source) return 'general'; return 'data' }
const nodeColor = (n) => (n.refKey !== undefined ? (COLOR[n.refRole] || COLOR.ref) : TIERCOLOR[tierOf(n)])
function typeLabel(n) {
  if (n.role === 'input') return ''
  if (typeof n.id === 'string') { if (n.id.indexOf('promptM-') === 0) return 'motion prompt'; if (n.id.indexOf('promptV-') === 0) return 'VO text' }
  const map = { prompt: 'image prompt', analysis: 'analysis', overall: 'overall', script: 'scene script', image: 'image gen', clip: 'clip gen', vo: 'VO gen', movie: 'movie', template: 'template', function: 'function', skill: 'skill' }
  return map[n.kind] || n.kind || ''
}
const hasInput = (n) => { if (n.role === 'input') return false; const k = KIND[n.kind]; if (!k || k.source) return false; return (k.inputs || []).length > 0 }
function outTypeOf(n) { if (!n) return null; if (n.role === 'input') return n.hd === 'hook' ? 'hook' : 'persona'; if (n.refKey !== undefined) return 'imageRef'; const k = KIND[n.kind]; return k ? k.out.t : null }
const cameraMoveName = (v, moves) => { if (!v) return 'default'; if (v === 'auto') return '✨ auto'; const m = (moves || []).find((x) => x.key === v); return m ? m.name : v }

function adapt(resp) {
  const c = resp.content || resp
  return {
    id: c.id, title: c.title, persona: c.persona, hook: c.hook, style: c.style, final_form: c.final_form,
    shot_count: c.shot_count, direction: c.direction, preview: c.preview, export_mp4: c.export_mp4,
    analysisRow: resp.analysis || {}, product: resp.product || parse(c.product) || {},
    scenes: parse(c.scenes) || [], overall: parse(c.overall) || null,
  }
}

// build nodes + edges + reference library from content (faithful to node-studio build/addSceneChain)
function buildGraph(data) {
  const nodes = [], edges = []
  const scenes = data.scenes || [], o = data.overall || {}
  const ctx = { persona: data.persona || '—', hook: data.hook || '—', angle: o.angle || '—', product: data.product?.title || '—' }
  const midY = 100 + Math.max(0, scenes.length - 1) * PITCH / 2
  const mk = (x) => { nodes.push(x); return x }
  const ar = data.analysisRow || {}, p = data.product || {}
  let aj = {}; try { aj = JSON.parse(ar.analysis || '{}') } catch { aj = {} }

  // reference library (product / character / environment) from product image + scene refs
  const refLib = { product: [], character: [], environment: [] }
  const seen = new Set(); let lid = 0
  const push = (thumb, role, name) => { if (!thumb || seen.has(thumb)) return; seen.add(thumb); refLib[role].push({ id: 'lib-' + (lid++), thumb, role, name: name || role }) }
  if (p.image) push(p.image, 'product', 'product main')
  scenes.forEach((s) => (s.refs || []).forEach((r) => { const u = media(r); if (u) push(u, 'product', 'ref') }))

  mk({ id: 'in-0', role: 'input', hd: 'persona', t: ctx.persona, sub: 'VO voice', x: COL.input, y: 100, data: {} })
  mk({ id: 'in-1', role: 'input', hd: 'hook', t: ctx.hook, sub: 'story shape', x: COL.input, y: 240, data: {} })
  mk({ id: 'analysis', role: 'analysis', kind: 'analysis', hd: 'reel', x: COL.input, y: 400, data: { angle: ctx.angle, hook: aj.hook || null, struct: aj.structure || null, sceneScript: aj.sceneScript || null, reel: { url: ar.reel_url, thumb: ar.reel_thumbnail, user: ar.reel_username, caption: ar.reel_caption, comments: ar.reel_comments, play: ar.reel_play, category: ar.category, title: ar.title }, product: { title: p.title, price: p.price, rating: p.rating, reviews: p.reviewCount, dimensions: p.dimensions, asin: p.asin, url: p.amazon_url, image: p.image } } })
  mk({ id: 'overall', role: 'overall', kind: 'overall', hd: 'overall', x: COL.overall, y: midY, data: { shotCount: data.shot_count ? String(data.shot_count) : '', direction: data.direction || '', angle: ctx.angle, hookLine: o.hookLine || '', vo: o.vo || '', cta: o.cta || '', beats: Array.isArray(o.beats) ? o.beats.join(' / ') : (o.beats || ''), guidance: '' } })
  const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  mk({ id: 'movie', role: 'movie', kind: 'movie', hd: 'final movie', x: COL.movie, y: midY, video: media(data.export_mp4 || data.preview), data: { sceneCount: scenes.length, final_form: data.final_form || 'card', output: data.export_mp4 || data.preview || '', exportMode: 'preview', outputDir: 'output/content-' + (data.id || 'x') + '/', outputName: (slug(ctx.product) || 'short') + '_' + (slug(data.hook) || 'hook') + '_v1' } })
  edges.push({ from: 'analysis', to: 'overall', cls: 'global' }, { from: 'in-0', to: 'overall', cls: 'global' }, { from: 'in-1', to: 'overall', cls: 'global' })

  const defRefs = () => ({ product: refLib.product.map((a) => a.id), character: refLib.character.map((a) => a.id), environment: [] })
  scenes.forEach((s, i) => {
    const k = i + 1, y = 100 + (k - 1) * PITCH
    mk({ id: 'script-' + k, role: 'script', kind: 'script', hd: 'scene ' + k, x: COL.script, y, scene: k, t: s.onScreenText || '', data: { title: s.onScreenText || '', vo: s.vo || '', guidance: '' } })
    mk({ id: 'prompt-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y, scene: k, t: (s.imagePrompt || '').slice(0, 90), data: { prompt: s.imagePrompt || '', guidance: '' } })
    mk({ id: 'promptV-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y: y + 160, scene: k, t: (s.voEn || s.vo || '').slice(0, 90), data: { prompt: s.voEn || s.vo || '', guidance: '' } })
    mk({ id: 'image-' + k, role: 'image', kind: 'image', hd: 'scene ' + k, x: COL.image, y, scene: k, thumb: media(s.image), data: { imagePrompt: s.imagePrompt || '', image: s.image || '', aspect: '9:16', model: 'auto', seed: '', style: data.style || '', frameRole: 'start', guidance: '', refs: defRefs() } })
    mk({ id: 'vo-' + k, role: 'vo', kind: 'vo', hd: 'scene ' + k, x: COL.vo, y, scene: k, audio: media(s.audio), data: { voiceId: data.persona || 'default', lang: 'US EN', audio: s.audio || '' } })
    const clip = s.makeVideo !== false
    if (clip) {
      mk({ id: 'promptM-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y: y + 80, scene: k, t: (s.motionPrompt || '').slice(0, 90), data: { prompt: s.motionPrompt || '', guidance: '' } })
      mk({ id: 'clip-' + k, role: 'clip', kind: 'clip', hd: 'scene ' + k, x: COL.clip, y, scene: k, video: media(s.video), image: media(s.image), data: { makeVideo: s.makeVideo === false ? 'still' : 'animate', cameraMove: s.cameraMove || '', duration: s.durationSec || 4, model: 'kling3_0' } })
    }
    edges.push({ from: 'overall', to: 'script-' + k, cls: 'flow' }, { from: 'in-0', to: 'script-' + k, cls: 'global' }, { from: 'in-1', to: 'script-' + k, cls: 'global' })
    edges.push({ from: 'script-' + k, to: 'prompt-' + k, cls: 'flow' }, { from: 'prompt-' + k, to: 'image-' + k, cls: 'flow' })
    edges.push({ from: 'script-' + k, to: 'promptV-' + k, cls: 'flow' }, { from: 'promptV-' + k, to: 'vo-' + k, cls: 'flow' }, { from: 'in-0', to: 'vo-' + k, cls: 'global' })
    if (clip) { edges.push({ from: 'script-' + k, to: 'promptM-' + k, cls: 'flow' }, { from: 'promptM-' + k, to: 'clip-' + k, cls: 'flow' }, { from: 'image-' + k, to: 'clip-' + k, cls: 'flow' }, { from: 'clip-' + k, to: 'movie', cls: 'flow' }) }
    else edges.push({ from: 'image-' + k, to: 'movie', cls: 'flow' })
    edges.push({ from: 'vo-' + k, to: 'movie', cls: 'audio' })
  })
  return { nodes, edges, refLib }
}

export default function NodeGraphView() {
  const [list, setList] = useState([])
  const [cid, setCid] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [ng, setNg] = useState({ nodes: [], edges: [], refLib: { product: [], character: [], environment: [] } })
  const [lib, setLib] = useState({ personas: [], hooks: [], moves: [] })
  const [view, setView] = useState({ x: 30, y: 20, k: 0.62 })
  const [heights, setHeights] = useState({})
  const [top, setTop] = useState(96)
  const [selId, setSel] = useState(null)
  const [drawerH, setDrawerH] = useState(300)
  const [menu, setMenu] = useState(null)
  const [libOpen, setLibOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const nodeRefs = useRef({})
  const pan = useRef(null), drag = useRef(null), libUid = useRef(0)

  useLayoutEffect(() => { const h = document.querySelector('header')?.offsetHeight; if (h) setTop(h) }, [])
  useEffect(() => {
    Promise.all([
      api('/api/personas').then((d) => d.personas || []).catch(() => []),
      api('/api/hooks').then((d) => d.hooks || []).catch(() => []),
      api('/api/camera-moves').then((d) => d.moves || []).catch(() => []),
    ]).then(([personas, hooks, moves]) => setLib({ personas, hooks, moves }))
  }, [])
  useEffect(() => {
    api('/api/contents').then((cs) => { setList(cs); setCid((prev) => prev ?? (cs.find((c) => c.id === 27)?.id ?? cs.find((c) => c.scenes)?.id ?? cs[0]?.id ?? null)) }).catch((e) => setErr(String(e.message || e)))
  }, [])
  useEffect(() => { if (cid == null) return; setData(null); setErr(null); setSel(null); api(`/api/contents/${cid}`).then((r) => setData(adapt(r))).catch((e) => setErr(String(e.message || e))) }, [cid])
  useEffect(() => { setNg(data ? buildGraph(data) : { nodes: [], edges: [], refLib: { product: [], character: [], environment: [] } }) }, [data])

  const graph = ng
  const nodeById = useMemo(() => { const m = {}; graph.nodes.forEach((n) => (m[n.id] = n)); return m }, [graph])
  const ctx = useMemo(() => ({ persona: data?.persona || '—', hook: data?.hook || '—', angle: data?.overall?.angle || '—', product: data?.product?.title || '—' }), [data])
  const selNode = nodeById[selId]

  useLayoutEffect(() => { const h = {}; graph.nodes.forEach((n) => { const el = nodeRefs.current[n.id]; if (el) h[n.id] = el.offsetHeight }); setHeights(h) }, [graph])

  const anchor = (n, side) => ({ x: n.x + (side === 'out' ? NODE_W : 0), y: n.y + (heights[n.id] || 90) / 2 })
  const paths = graph.edges.map((e, i) => { const a = nodeById[e.from], b = nodeById[e.to]; if (!a || !b) return null; const p1 = anchor(a, 'out'), p2 = anchor(b, 'in'), dx = Math.max(40, (p2.x - p1.x) * 0.5); return { key: i, d: `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`, color: EDGE_COLOR[e.cls] || '#7d8590', dashed: e.cls === 'global' } }).filter(Boolean)

  function onWheel(ev) { ev.preventDefault(); const r = ev.currentTarget.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; setView((v) => { const k = Math.min(2, Math.max(0.2, v.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1))); return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) } }) }
  function startNodeDrag(ev, n) { if (ev.target.closest('video, button, select, a, .ng-del')) return; ev.stopPropagation(); drag.current = { id: n.id, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false } }
  function onDown(ev) { if (ev.target.closest('.ng-node')) return; setSel(null); pan.current = { sx: ev.clientX, sy: ev.clientY, x: view.x, y: view.y } }
  function onMove(ev) {
    if (drag.current) { const d = drag.current; if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 3) d.moved = true; const dx = (ev.clientX - d.sx) / view.k, dy = (ev.clientY - d.sy) / view.k; setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: d.ox + dx, y: d.oy + dy } : n) })); return }
    if (!pan.current) return; setView((v) => ({ ...v, x: pan.current.x + (ev.clientX - pan.current.sx), y: pan.current.y + (ev.clientY - pan.current.sy) }))
  }
  function onUp() { if (drag.current) { const d = drag.current; drag.current = null; if (!d.moved) setSel(d.id); else setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: Math.round(n.x / 20) * 20, y: Math.round(n.y / 20) * 20 } : n) })) } pan.current = null }
  function deleteNode(id) { setNg((g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) })); if (selId === id) setSel(null) }
  function setNodeData(id, patch) { setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, data: { ...n.data, ...patch } } : n) })) }
  function setNodeField(id, patch) { setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, ...patch } : n) })) }
  function toggleRef(id, role, refId) { setNg((g) => ({ ...g, nodes: g.nodes.map((n) => { if (n.id !== id) return n; const refs = { product: [], character: [], environment: [], ...(n.data.refs || {}) }; const arr = refs[role] = [...(refs[role] || [])]; const i = arr.indexOf(refId); if (i >= 0) arr.splice(i, 1); else arr.push(refId); return { ...n, dirty: true, data: { ...n.data, refs } } }) })) }
  function addNode(kind, wx, wy) { const id = kind + '-' + Math.round(wx) + '-' + Math.round(wy); setNg((g) => ({ ...g, nodes: [...g.nodes, { id, role: kind, kind, hd: kind, x: Math.round(wx / 20) * 20, y: Math.round(wy / 20) * 20, data: {}, dirty: true }] })); setMenu(null) }
  function onCanvasMenu(ev) { ev.preventDefault(); const r = ev.currentTarget.getBoundingClientRect(); setMenu({ sx: ev.clientX, sy: ev.clientY, wx: (ev.clientX - r.left - view.x) / view.k, wy: (ev.clientY - r.top - view.y) / view.k }) }
  function startDrawerResize(ev) { ev.preventDefault(); const sy = ev.clientY, h0 = drawerH; const mv = (e) => setDrawerH(Math.min(560, Math.max(140, h0 - (e.clientY - sy)))); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up) }
  function addRefAsset(role, thumb, name) { if (!thumb) return; setNg((g) => ({ ...g, refLib: { ...g.refLib, [role]: [...(g.refLib[role] || []), { id: 'lib-' + (libUid.current++), thumb, role, name: name || role }] } })) }
  function deleteRefAsset(role, id) { setNg((g) => ({ ...g, refLib: { ...g.refLib, [role]: (g.refLib[role] || []).filter((a) => a.id !== id) }, nodes: g.nodes.map((n) => (n.data && n.data.refs && n.data.refs[role]) ? { ...n, data: { ...n.data, refs: { ...n.data.refs, [role]: n.data.refs[role].filter((x) => x !== id) } } } : n) })) }
  function dropRefs(ev, role) { ev.preventDefault(); ev.currentTarget.classList.remove('drag'); const files = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/')); files.forEach((f) => addRefAsset(role, URL.createObjectURL(f), f.name)); if (!files.length) { const uri = ev.dataTransfer?.getData('text/uri-list') || ev.dataTransfer?.getData('text/plain') || ''; if (/^https?:/.test(uri)) addRefAsset(role, uri.trim(), role) } }
  const hoverPreview = { onMouseEnter: (e) => setPreview({ url: e.target.src, x: e.clientX, y: e.clientY }), onMouseMove: (e) => setPreview((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p), onMouseLeave: () => setPreview(null) }

  return (
    <div className="ng-wrap" style={{ top }}>
      <div className="ng-bar">
        <button className={'ng-libtoggle' + (libOpen ? ' on' : '')} onClick={() => setLibOpen((o) => !o)} title="reference asset library">▤ refs</button>
        <select value={cid ?? ''} onChange={(e) => setCid(Number(e.target.value))}>{list.map((c) => <option key={c.id} value={c.id}>#{c.id} {(c.title || 'untitled').slice(0, 30)}</option>)}</select>
      </div>
      {err && <div className="ng-err">{err}</div>}
      <div className="ng-canvas" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={onCanvasMenu}>
        <div className="ng-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}>
          <svg className="ng-edges">{paths.map((p) => <path key={p.key} d={p.d} stroke={p.color} strokeWidth="1.6" fill="none" strokeDasharray={p.dashed ? '5 4' : 'none'} opacity={p.dashed ? 0.5 : 0.9} />)}</svg>
          {graph.nodes.map((n) => {
            const c = nodeColor(n), tl = typeLabel(n)
            return (
              <div key={n.id} ref={(el) => (nodeRefs.current[n.id] = el)} className={'ng-node tier-' + tierOf(n) + (n.id === selId ? ' sel' : '') + (n.dirty ? ' dirty' : '')} style={{ left: n.x, top: n.y, width: NODE_W, color: c, borderColor: (n.id === selId ? c : c + '99') }} onPointerDown={(e) => startNodeDrag(e, n)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ sx: e.clientX, sy: e.clientY, nodeId: n.id }) }}>
                {tl && <span className="ng-type" style={{ color: c, borderColor: c + '66' }}>{tl}</span>}
                <button className="ng-del" title="delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id) }}>×</button>
                {n.kind === 'image' && (n.thumb ? <img className="ng-thumb" style={{ aspectRatio: aspectCSS(n.data?.aspect) }} src={n.thumb} loading="lazy" onError={(e) => { e.target.style.opacity = .2 }} /> : <div className="ng-thumb ph" style={{ aspectRatio: aspectCSS(n.data?.aspect) }}>{n.data?.aspect || '9:16'}</div>)}
                {n.kind === 'clip' && (n.video ? <video className="ng-thumb" src={n.video} muted loop playsInline preload="metadata" onMouseOver={(e) => e.target.play()} onMouseOut={(e) => e.target.pause()} /> : n.image ? <img className="ng-thumb" style={{ opacity: .4 }} src={n.image} /> : null)}
                {n.kind === 'movie' && n.video && <video className="ng-thumb" src={n.video} controls playsInline preload="metadata" />}
                {n.kind === 'analysis' && n.data?.reel?.thumb && <img className="ng-thumb" src={n.data.reel.thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
                <div className="ng-hd" style={{ color: c }}><span className="ng-dot" style={{ background: c }} />{n.hd}</div>
                {n.t && <div className="ng-t">{n.t}</div>}
                {n.sub && <div className="ng-sub">{n.sub}</div>}
                {n.kind === 'vo' && <div className="ng-sub">{n.audio ? '🔊 VO ready' : 'no VO yet'}</div>}
                {n.kind === 'clip' && <div className="ng-pill">{n.data?.makeVideo === 'still' ? '🖼 still' : '🎥 ' + cameraMoveName(n.data?.cameraMove, lib.moves)}</div>}
                {hasInput(n) && <span className="ng-port in" style={{ borderColor: c }} />}
                <span className="ng-port out" style={{ borderColor: c }} />
              </div>
            )
          })}
        </div>
      </div>

      {libOpen && (
        <div className="ng-libpanel">
          {['product', 'character', 'environment'].map((role) => {
            const items = graph.refLib[role] || []
            return (
              <div key={role} className="ng-libzone" onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag') }} onDragLeave={(e) => e.currentTarget.classList.remove('drag')} onDrop={(e) => dropRefs(e, role)}>
                <h4><span className="d" style={{ background: COLOR[role] }} />{role}<span className="add" title="add by URL" onClick={() => { const url = window.prompt(role + ' reference — image URL:'); if (url) addRefAsset(role, url, role + ' ' + (items.length + 1)) }}>＋</span></h4>
                {items.length
                  ? <div className="ng-libgrid">{items.map((a) => (
                    <div key={a.id} className="ng-libitem">
                      <img src={a.thumb} onError={(e) => { e.target.style.opacity = .2 }} {...hoverPreview} />
                      <span className="ng-libdel" title="delete" onClick={() => deleteRefAsset(role, a.id)}>×</span>
                      <div className="nm">{a.name}</div>
                    </div>))}</div>
                  : <div className="ng-empty">drop image here · or ＋ URL</div>}
              </div>
            )
          })}
        </div>
      )}
      {preview && <div className="ng-refpreview" style={{ left: Math.min(preview.x + 18, window.innerWidth - 280), top: Math.min(preview.y + 18, window.innerHeight - 280) }}><img src={preview.url} /></div>}

      {menu && (<>
        <div className="ng-menu-bd" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
        <div className="ng-menu" style={{ left: menu.sx, top: menu.sy }}>
          {menu.nodeId ? <button onClick={() => { deleteNode(menu.nodeId); setMenu(null) }}>🗑 delete</button>
            : ['node', 'template', 'function', 'skill'].map((k) => <button key={k} onClick={() => addNode(k, menu.wx, menu.wy)}>＋ {k}</button>)}
        </div>
      </>)}

      {selNode && <Drawer n={selNode} ctx={ctx} lib={lib} refLib={graph.refLib} h={drawerH} onResize={startDrawerResize}
        onClose={() => setSel(null)} onRename={(v) => setNodeField(selNode.id, { hd: v })} onField={(f, v) => f === '__nodeval' ? setNodeField(selNode.id, { t: v }) : setNodeData(selNode.id, { [f]: v })}
        onToggleRef={(role, id) => toggleRef(selNode.id, role, id)} onDelete={() => deleteNode(selNode.id)} hoverPreview={hoverPreview} incoming={graph.edges.filter((e) => e.to === selNode.id).map((e) => nodeById[e.from]).filter(Boolean)} />}
    </div>
  )
}

// ── DRAWER — faithful to node-studio.html drawerHTML ──
function Field({ c, d, onField }) {
  const cur = d[c.f] ?? ''
  if (c.fixed) return <span className="ng-fixed">{c.fixed}</span>
  let choices = c.choices
  if (c.cameraLib) choices = ['', 'auto'].concat((c._moves || []).map((m) => m.key))
  if (choices && choices.length) {
    const nameOf = (v) => { if (c.cameraLib) { if (v === '') return 'default (slow push-in)'; if (v === 'auto') return '✨ auto'; const m = (c._moves || []).find((x) => x.key === v); return m ? m.name : v } return v }
    return <select value={cur} onChange={(e) => onField(c.f, e.target.value)}>{choices.map((v) => <option key={v} value={v}>{nameOf(v)}</option>)}</select>
  }
  return <input value={cur} placeholder={c.ph || ''} onChange={(e) => onField(c.f, e.target.value)} />
}

function Drawer({ n, ctx, lib, refLib, h, onResize, onClose, onRename, onField, onToggleRef, onDelete, hoverPreview, incoming }) {
  const c = nodeColor(n), k = KIND[n.kind], d = n.data || {}
  const runnable = k && !k.source
  const header = (
    <div className="ng-dh">
      <span className="ng-k" style={{ background: c }} />
      <input className="ng-title-edit" value={n.hd} spellCheck={false} onChange={(e) => onRename(e.target.value)} />
      <span className="ng-kind">#{n.id}</span>
      {k && <span className="ng-out">→ {k.out.n} ({k.out.t})</span>}
      {runnable && <button className="ng-run" title="run (next block)">▶ re-run</button>}
      <span className="ng-wctrl"><button className="ng-icn" onClick={onClose} title="close">✕</button></span>
    </div>
  )

  let body
  if (n.kind === 'analysis') {
    const r = d.reel || {}, p = d.product || {}, hk = d.hook || {}, st = d.struct || {}
    body = (
      <div className="ng-db ng-analysis">
        <div className="ng-col">
          <div className="ng-sh" style={{ color: '#9bb8e8' }}>reference reel</div>
          {r.thumb && <img className="ng-athumb" src={r.thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
          <div className="ng-kv"><span className="l">@</span><span className="v">{r.user || '—'}</span></div>
          <div className="ng-kv"><span className="l">category</span><span className="v">{r.category || '—'}</span></div>
          <div className="ng-kv"><span className="l">comments</span><span className="v">{r.comments ?? '—'}</span></div>
          {r.url && <div className="ng-kv"><span className="l" /><span className="v"><a href={r.url} target="_blank" rel="noreferrer">open reel ↗</a></span></div>}
          <div className="ng-sh top" style={{ color: '#c9b3ea' }}>hook{hk.family ? ' · ' + hk.family : ''}</div>
          {hk.openingLine && <div className="ng-kvtext">"{hk.openingLine}"</div>}
          {hk.why && <div className="ng-kvtext">{hk.why}</div>}
          <div className="ng-sh top">structure</div>
          <div className="ng-kv"><span className="l">format</span><span className="v">{st.format || '—'}</span></div>
          <div className="ng-kv"><span className="l">pacing</span><span className="v">{st.pacing || '—'}</span></div>
          <div className="ng-kv"><span className="l">cta</span><span className="v">{st.cta || '—'}</span></div>
          {(st.beats || []).map((b, i) => <div key={i} className="ng-kv"><span className="l">beat {i + 1}</span><span className="v">{b}</span></div>)}
        </div>
        <div className="ng-col right">
          <div className="ng-sh" style={{ color: '#5DCAA5' }}>matched product</div>
          {p.image && <img className="ng-athumb" src={p.image} style={{ background: '#fff' }} />}
          <div className="ng-kv"><span className="l">title</span><span className="v">{p.title || '—'}</span></div>
          <div className="ng-kv"><span className="l">price</span><span className="v">{p.price || '—'}</span></div>
          <div className="ng-kv"><span className="l">rating</span><span className="v">{p.rating ? '★ ' + p.rating + ' · ' + (p.reviews || 0) : '—'}</span></div>
          {p.dimensions && <div className="ng-kv"><span className="l">dims</span><span className="v">{p.dimensions}</span></div>}
          {p.asin && <div className="ng-kv"><span className="l" /><span className="v"><a href={'https://www.amazon.com/dp/' + p.asin} target="_blank" rel="noreferrer">Amazon ↗</a></span></div>}
        </div>
      </div>
    )
  } else if (!k) { // input (persona / hook)
    const isP = n.hd === 'persona', L = isP ? lib.personas : n.hd === 'hook' ? lib.hooks : null
    const cur = n.t || '', opt = (L || []).find((o) => o.key === cur)
    body = (
      <div className="ng-db">
        <div className="ng-col">
          {L ? <>
            <div className="ng-sh">choose {n.hd} · {L.length} options</div>
            <select className="ng-bigsel" value={cur} onChange={(e) => onField('__nodeval', e.target.value)}>
              <option value="">— default —</option>{L.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
            </select>
            {opt ? <div className="ng-fed" style={{ marginTop: 9 }}>{opt.register || opt.when_to_use || ''}</div> : <div className="ng-fed manual" style={{ marginTop: 9 }}>— default (choose one) —</div>}
          </> : <><div className="ng-sh">value</div><div className="ng-wired">{n.t || n.hd}</div></>}
        </div>
        <div className="ng-col right"><div className="ng-sh">context</div><div className="ng-ctxrow">persona <b>{ctx.persona}</b> · hook <b>{ctx.hook}</b></div><div className="ng-ctxrow">angle {ctx.angle}</div></div>
      </div>
    )
  } else {
    const ed = k.editor
    const fedBy = incoming.filter((s) => outTypeOf(s) === 'text')
    const cfg = (k.config || []).map((cc) => ({ ...cc, _moves: lib.moves }))
    body = (
      <div className="ng-db">
        <div className="ng-col">
          {ed && <>
            <div className="ng-sh">{ed.label}</div>
            <div className={'ng-fed' + (fedBy.length ? '' : ' manual')}>{fedBy.length ? '◦ from ' + fedBy.map((s) => s.hd).join(', ') : '✎ manual'}</div>
            <textarea className="ng-big" value={d[ed.field] || ''} onChange={(e) => onField(ed.field, e.target.value)} />
          </>}
          <div className="ng-sh top">inputs</div>
          {(k.inputs && k.inputs.length) ? k.inputs.map((slot) => {
            const listS = slot.frame ? incoming.filter((s) => outTypeOf(s) === 'image' && ((s.data && s.data.frameRole) || 'start') === slot.frame) : incoming.filter((s) => outTypeOf(s) === slot.type)
            return <div key={slot.key} className="ng-slot"><div className="ng-slot-h"><span>{slot.label || slot.key}</span><em>{slot.type}{slot.multi ? '[]' : ''}</em></div><div className="ng-wired">{listS.length ? listS.map((s) => <span key={s.id} className="ng-chip">◦ {s.hd}</span>) : <span className="ng-none">— none —</span>}</div></div>
          }) : <div className="ng-wired"><span className="ng-none">— no inputs —</span></div>}
          {n.kind === 'image' && <>
            <div className="ng-sh top">references (from library)</div>
            {['product', 'character', 'environment'].map((role) => {
              const items = refLib[role] || [], on = (d.refs && d.refs[role]) || []
              return <div key={role} className="ng-refblk"><div className="ng-slot-h"><span style={{ color: COLOR[role] }}>{role}</span><em>{on.length} applied</em></div>
                <div className="ng-refchips">{items.length ? items.map((a) => <span key={a.id} className={'ng-refchip' + (on.includes(a.id) ? ' on' : '')} style={on.includes(a.id) ? { borderColor: COLOR[role], color: COLOR[role] } : null} onClick={() => onToggleRef(role, a.id)}><img src={a.thumb} {...hoverPreview} />{a.name}</span>) : <span className="ng-none">— none —</span>}</div></div>
            })}
          </>}
        </div>
        <div className="ng-col right">
          <div className="ng-sh">properties</div>
          {cfg.length ? cfg.map((cc) => <div key={cc.f} className="ng-prop"><label>{cc.f}</label><Field c={cc} d={d} onField={onField} /></div>) : <div className="ng-prop"><span className="ng-fixed">— none —</span></div>}
          <div className="ng-sh top">output</div>
          <div className="ng-wired"><span className="ng-chip">{k.out.t === 'image' || k.out.t === 'video' ? '🎞' : '⤷'} {k.out.n}<em>{k.out.t}</em></span></div>
          <div className="ng-sh top">context</div>
          <div className="ng-ctxrow">persona <b>{ctx.persona}</b> · hook <b>{ctx.hook}</b></div>
          <div className="ng-ctxrow">{ctx.product}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="ng-drawer" style={{ height: h }}>
      <div className="ng-drawer-grip" onPointerDown={onResize} />
      {header}
      {body}
    </div>
  )
}
