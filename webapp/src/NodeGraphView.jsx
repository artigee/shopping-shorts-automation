import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, postJSON, pollJob } from './util.js'
import './nodegraph.css'

// crash guard — a render error in the graph must not blank the whole app (black screen);
// show the error inline instead so it can be reported/fixed.
class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (this.state.err) return (
      <div className="ng-crash">
        <div>⚠ Content Gen 렌더 오류 — 화면이 검게 되는 대신 이 메시지를 표시합니다.</div>
        <pre>{String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}</pre>
        <button onClick={() => this.setState({ err: null })}>다시 시도</button>
      </div>
    )
    return this.props.children
  }
}

// ⑤ Content Gen — node graph for ④ content, ported faithfully from prototypes/node-studio.html.
// Same node model (KIND registry, typed inputs), same drawer layout. Read/edit is local (dirty);
// wiring/run to the ④ endpoints is the next block.

const COL = { input: 40, overall: 300, script: 560, prompt: 820, image: 1080, clip: 1340, vo: 1600, movie: 1860 }
const NODE_W = 210, PITCH = 280
const nodeW = (n) => n && n.kind === 'overall' ? NODE_W + 40 : NODE_W   // Script Engine 노드는 조금 더 크게
const COLOR = { product: '#378ADD', character: '#b98be0', environment: '#7fc7a0', ref: '#5DCAA5' }
const TIERCOLOR = { data: '#8790b5', special: '#4f9fe0', general: '#5DCAA5' }
const EDGE_COLOR = { flow: '#7d8590', global: '#9a86c8', audio: '#e0c85d', product: '#378ADD', character: '#b98be0', environment: '#7fc7a0' }

// node-kind registry — CONFIRMED contracts + typed ports (mirror of node-studio.html)
const KIND = {
  analysis: { out: { t: 'analysis', n: 'reel structure' }, source: true, editor: { field: 'angle', label: 'structure / angle (from reel analysis)' }, config: [] },
  overall: { out: { t: 'text', n: 'scene[] · N ordered', array: true }, editor: { field: 'vo', label: 'overall VO — the through-line' },
    config: [{ f: 'shotCount', ph: 'auto | 1-9  (# scene scripts)' }, { f: 'direction', ph: 'hook·shot direction' }, { f: 'angle' }, { f: 'hookLine' }, { f: 'cta' }, { f: 'beats' }, { f: 'guidance', ph: 'steer re-run' }] },
  script: { out: { t: 'text', n: 'Title + VO' }, editor: { field: 'vo', label: 'scene VO' }, config: [{ f: 'title', ph: 'on-screen title' }, { f: 'guidance', ph: 'steer re-run' }] },
  prompt: { out: { t: 'text', n: 'prompt text' }, editor: { field: 'prompt', label: 'output prompt (generated · feeds downstream)', readOnly: true }, config: [{ f: 'guidance', label: 'input prompt', multiline: true, ph: 'instruction to the LLM — e.g. closer shot · warmer tone · punchier' }] },
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
Object.keys(INPUTS).forEach((k) => { if (KIND[k]) { KIND[k].inputs = INPUTS[k]; KIND[k].accepts = [...new Set(INPUTS[k].map((i) => i.type))] } })
KIND.template.accepts = ['*']; KIND.function.accepts = ['*']; KIND.skill.accepts = ['*']; KIND.analysis.accepts = []
function acceptsOf(n) { const k = KIND[n.kind]; return k ? (k.accepts || []) : null }
function canConnect(from, to) {
  const ot = outTypeOf(from), acc = acceptsOf(to)
  if (!ot || !acc || from.id === to.id) return false
  if (!(acc.includes('*') || acc.includes(ot))) return false
  // an array output (overall's scene[]) must be split by a scene-script node — no direct jump to a single-item consumer
  if (KIND[from.kind]?.out?.array && !(to.kind === 'script' || acc.includes('*'))) return false
  return true
}
function edgeClassFor(ot, from) { return ot === 'imageRef' ? (from.refRole || 'ref') : ot === 'audio' ? 'audio' : (ot === 'context' || ot === 'persona' || ot === 'hook' || ot === 'analysis') ? 'global' : 'flow' }
// right-click create-node menu (faithful to prototype showCtxMenu)
const MENU_ITEMS = [['Sources', 'h'], ['analysis · reel', 'analysis'], ['persona', 'persona'], ['hook', 'hook'], ['animation ref · video', 'animref'], ['Script', 'h'], ['overall + split', 'overall'], ['scene script', 'script'], ['Generate', 'h'], ['prompt', 'prompt'], ['image gen', 'image'], ['clip gen', 'clip'], ['VO', 'vo'], ['Assemble', 'h'], ['movie', 'movie'], ['Custom', 'h'], ['template', 'template'], ['function', 'function'], ['skill call', 'skill']]
const MENU_COLOR = { analysis: '#7fc7c0', persona: '#b98be0', hook: '#b98be0', animref: '#6bc7d9', overall: '#9bb8e8', script: '#c9b3ea', prompt: '#c7b3f0', image: '#5DCAA5', clip: '#F0997B', vo: '#e0c85d', movie: '#378ADD', template: '#9c9a92', function: '#8fb8e0', skill: '#d59be0' }
const menuOut = (k) => (k === 'persona' || k === 'hook') ? 'persona/hook' : k === 'analysis' ? 'analysis' : k === 'animref' ? 'video' : KIND[k] ? KIND[k].out.t : 'node'

const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
const media = (u) => { if (!u) return null; if (u.indexOf('|/output/') >= 0) u = u.split('|')[1]; return u }
// 캐시 버스터 — 재생성 시 같은 파일명이라 브라우저가 옛 이미지를 캐시하는 문제 방지
const bust = (u, v) => u ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'v=' + v : u
const aspectCSS = (a) => String(a || '9:16').replace(':', '/')

function tierOf(n) { if (['overall', 'movie', 'script'].includes(n.kind)) return 'special'; if (n.kind && KIND[n.kind] && !KIND[n.kind].source) return 'general'; return 'data' }
const nodeColor = (n) => (n.refKey !== undefined ? (COLOR[n.refRole] || COLOR.ref) : TIERCOLOR[tierOf(n)])
function typeLabel(n) {
  if (n.role === 'input') return ''
  if (typeof n.id === 'string') { if (n.id.indexOf('promptM-') === 0) return 'motion prompt'; if (n.id.indexOf('promptV-') === 0) return 'VO text' }
  const map = { prompt: 'image prompt', analysis: 'analysis', overall: 'script engine', script: 'scene script', image: 'image gen', clip: 'clip gen', vo: 'VO gen', movie: 'movie', template: 'template', function: 'function', skill: 'skill' }
  return map[n.kind] || n.kind || ''
}
const hasInput = (n) => { if (n.role === 'input' || n.role === 'animref') return false; const k = KIND[n.kind]; if (k && k.source) return false; if (k) return (k.accepts || []).length > 0; return false }
function outTypeOf(n) { if (!n) return null; if (n.role === 'input') return n.hd === 'hook' ? 'hook' : 'persona'; if (n.role === 'animref') return 'video'; if (n.refKey !== undefined) return 'imageRef'; const k = KIND[n.kind]; return k ? k.out.t : null }
const cameraMoveName = (v, moves) => { if (!v) return 'default'; if (v === 'auto') return '✨ auto'; const m = (moves || []).find((x) => x.key === v); return m ? m.name : v }

function adapt(resp) {
  const c = resp.content || resp
  return {
    id: c.id, title: c.title, persona: c.persona, hook: c.hook, style: c.style, final_form: c.final_form,
    shot_count: c.shot_count, direction: c.direction, preview: c.preview, export_mp4: c.export_mp4,
    analysisRow: resp.analysis || {}, product: resp.product || parse(c.product) || {},
    scenes: parse(c.scenes) || [], overall: parse(c.overall) || null, refLibSaved: parse(c.ref_lib) || null, nodeMetaSaved: parse(c.node_meta) || null, mediaVer: Date.now(),
  }
}

// build nodes + edges + reference library from content (faithful to node-studio build/addSceneChain)
function buildGraph(data) {
  const nodes = [], edges = []
  const lv = data.mediaVer || 0                 // 로드 시 캐시 버스터 값
  const scenes = data.scenes || [], o = data.overall || {}
  const ctx = { persona: data.persona || '—', hook: data.hook || '—', angle: o.angle || '—', product: data.product?.title || '—' }
  const midY = 100 + Math.max(0, scenes.length - 1) * PITCH / 2
  const mk = (x) => { nodes.push(x); return x }
  const ar = data.analysisRow || {}, p = data.product || {}
  let aj = {}; try { aj = JSON.parse(ar.analysis || '{}') } catch { aj = {} }

  // reference library — saved(사용자 정리 보존)이 있으면 그대로, 없으면 product image + scene refs로 기본 구성
  const saved = data.refLibSaved
  const hasSaved = saved && ['product', 'character', 'environment'].some((r) => Array.isArray(saved[r]) && saved[r].length)
  const refLib = hasSaved
    ? { product: saved.product || [], character: saved.character || [], environment: saved.environment || [] }
    : { product: [], character: [], environment: [] }
  if (!hasSaved) {
    const seen = new Set(); let lid = 0
    const push = (thumb, role, name) => { if (!thumb || seen.has(thumb)) return; seen.add(thumb); refLib[role].push({ id: 'lib-' + (lid++), thumb, role, name: name || role }) }
    if (p.image) push(p.image, 'product', 'product main')
    scenes.forEach((s) => (s.refs || []).forEach((r) => { const u = media(r); if (u) push(u, 'product', 'ref') }))
  }

  mk({ id: 'in-0', role: 'input', hd: 'persona', t: ctx.persona, sub: 'VO voice', x: COL.input, y: 100, data: {} })
  mk({ id: 'in-1', role: 'input', hd: 'hook', t: ctx.hook, sub: 'story shape', x: COL.input, y: 240, data: {} })
  mk({ id: 'analysis', role: 'analysis', kind: 'analysis', hd: 'reel', x: COL.input, y: 400, data: { angle: ctx.angle, hook: aj.hook || null, audience: aj.audience || null, struct: aj.structure || null, visualStyle: aj.visualStyle || null, sceneScript: aj.sceneScript || null, assets: aj.assets || null, viralFactors: aj.viralFactors || null, reel: { url: ar.reel_url, thumb: ar.reel_thumbnail, user: ar.reel_username, caption: ar.reel_caption, comments: ar.reel_comments, play: ar.reel_play, category: ar.category, title: ar.title }, product: { title: p.title, price: p.price, rating: p.rating, reviews: p.reviewCount, dimensions: p.dimensions, asin: p.asin, url: p.amazon_url, image: p.image } } })
  mk({ id: 'overall', role: 'overall', kind: 'overall', hd: 'Script Engine', x: COL.overall, y: midY, data: { shotCount: data.shot_count ? String(data.shot_count) : '', direction: data.direction || '', angle: ctx.angle, hookLine: o.hookLine || '', vo: o.vo || '', cta: o.cta || '', beats: Array.isArray(o.beats) ? o.beats.join(' / ') : (o.beats || ''), guidance: '' } })
  const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  mk({ id: 'movie', role: 'movie', kind: 'movie', hd: 'final movie', x: COL.movie, y: midY, video: media(data.export_mp4 || data.preview), data: { sceneCount: scenes.length, final_form: data.final_form || 'card', output: data.export_mp4 || data.preview || '', exportMode: 'preview', outputDir: 'output/content-' + (data.id || 'x') + '/', outputName: (slug(ctx.product) || 'short') + '_' + (slug(data.hook) || 'hook') + '_v1' } })
  edges.push({ from: 'analysis', to: 'overall', cls: 'global' }, { from: 'in-0', to: 'overall', cls: 'global' }, { from: 'in-1', to: 'overall', cls: 'global' })

  const defRefs = () => ({ product: refLib.product.map((a) => a.id), character: refLib.character.map((a) => a.id), environment: [] })
  scenes.forEach((s, i) => {
    const k = i + 1, y = 100 + (k - 1) * PITCH
    mk({ id: 'script-' + k, role: 'script', kind: 'script', hd: 'scene ' + k, x: COL.script, y, scene: k, t: s.onScreenText || '', data: { title: s.onScreenText || '', vo: s.vo || '', guidance: '' } })
    mk({ id: 'prompt-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y, scene: k, t: (s.imagePrompt || '').slice(0, 90), data: { prompt: s.imagePrompt || '', guidance: '' } })
    mk({ id: 'promptV-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y: y + 160, scene: k, t: (s.voEn || s.vo || '').slice(0, 90), data: { prompt: s.voEn || s.vo || '', guidance: '' } })
    mk({ id: 'image-' + k, role: 'image', kind: 'image', hd: 'scene ' + k, x: COL.image, y, scene: k, thumb: bust(media(s.image), lv), data: { imagePrompt: s.imagePrompt || '', image: s.image || '', aspect: '9:16', model: 'auto', seed: '', style: data.style || '', frameRole: 'start', guidance: '', refs: (s.graphRefs && typeof s.graphRefs === 'object') ? { product: [], character: [], environment: [], ...s.graphRefs } : defRefs() } })
    mk({ id: 'vo-' + k, role: 'vo', kind: 'vo', hd: 'scene ' + k, x: COL.vo, y, scene: k, audio: bust(media(s.audio), lv), data: { voiceId: data.persona || 'default', lang: 'US EN', audio: s.audio || '' } })
    const clip = s.makeVideo !== false
    if (clip) {
      mk({ id: 'promptM-' + k, role: 'prompt', kind: 'prompt', hd: 'scene ' + k, x: COL.prompt, y: y + 80, scene: k, t: (s.motionPrompt || '').slice(0, 90), data: { prompt: s.motionPrompt || '', guidance: '' } })
      mk({ id: 'clip-' + k, role: 'clip', kind: 'clip', hd: 'scene ' + k, x: COL.clip, y, scene: k, video: bust(media(s.video), lv), image: bust(media(s.image), lv), data: { makeVideo: s.makeVideo === false ? 'still' : 'animate', cameraMove: s.cameraMove || '', duration: s.durationSec || 4, model: 'kling3_0' } })
    }
    edges.push({ from: 'overall', to: 'script-' + k, cls: 'flow' }, { from: 'in-0', to: 'script-' + k, cls: 'global' }, { from: 'in-1', to: 'script-' + k, cls: 'global' })
    edges.push({ from: 'script-' + k, to: 'prompt-' + k, cls: 'flow' }, { from: 'prompt-' + k, to: 'image-' + k, cls: 'flow' })
    edges.push({ from: 'script-' + k, to: 'promptV-' + k, cls: 'flow' }, { from: 'promptV-' + k, to: 'vo-' + k, cls: 'flow' }, { from: 'in-0', to: 'vo-' + k, cls: 'global' })
    if (clip) { edges.push({ from: 'script-' + k, to: 'promptM-' + k, cls: 'flow' }, { from: 'promptM-' + k, to: 'clip-' + k, cls: 'flow' }, { from: 'image-' + k, to: 'clip-' + k, cls: 'flow' }, { from: 'clip-' + k, to: 'movie', cls: 'flow' }) }
    else edges.push({ from: 'image-' + k, to: 'movie', cls: 'flow' })
    edges.push({ from: 'vo-' + k, to: 'movie', cls: 'audio' })
  })
  if (data.nodeMetaSaved) nodes.forEach((n) => { const nm = data.nodeMetaSaved[n.id]; if (nm) n.hd = nm })   // 편집한 노드 이름 복원
  return { nodes, edges, refLib }
}

export default function NodeGraphView({ openId, onOpenHandled }) { return <ErrorBoundary><NodeGraphInner openId={openId} onOpenHandled={onOpenHandled} /></ErrorBoundary> }
function NodeGraphInner({ openId, onOpenHandled }) {
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
  const [closing, setClosing] = useState(false)
  const [drawerH, setDrawerH] = useState(300)
  const [menu, setMenu] = useState(null)
  const [libOpen, setLibOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [wireEnd, setWireEnd] = useState(null)
  const [locked, setLocked] = useState(false)
  const [framing, setFraming] = useState(false)
  const [sourceStale, setSourceStale] = useState(false)   // 소스 분석이 재분석돼 그래프가 오래됨
  const [running, setRunning] = useState(null)            // { id, msg, t0 } — 노드 실행(잡) 진행
  const [, setTick] = useState(0)                         // 실행 경과 시간 갱신용 틱
  const [modes, setModes] = useState([])                  // 콘텐츠 모드(claim-safety) 목록
  const [contentMode, setContentMode] = useState('')      // 현재 콘텐츠 모드
  const [runningIds, setRunningIds] = useState(new Set()) // 실행 중 잡이 있는 콘텐츠 id (보드 뱃지)
  const [genOpen, setGenOpen] = useState(false)           // 배치 생성 선택 메뉴 열림
  const nodeRefs = useRef({})
  const canvasRef = useRef(null)
  const pan = useRef(null), drag = useRef(null), libUid = useRef(0)
  const ngRef = useRef(ng); ngRef.current = ng
  const srcSig = useRef(null)               // 로드 당시 소스 분석 시그니처(analyzed_at)
  const loadedRefKey = useRef('')           // 로드 당시 refLib 시그니처 (변경 감지용)
  const loadedNameKey = useRef('')          // 로드 당시 노드 이름 시그니처
  const hist = useRef({ past: [], future: [], key: null })
  const dragSnap = useRef(null)
  const [histN, setHistN] = useState({ u: 0, r: 0 })

  useLayoutEffect(() => { const h = document.querySelector('header')?.offsetHeight; if (h) setTop(h) }, [])
  useEffect(() => {
    Promise.all([
      api('/api/personas').then((d) => d.personas || []).catch(() => []),
      api('/api/hooks').then((d) => d.hooks || []).catch(() => []),
      api('/api/camera-moves').then((d) => d.moves || []).catch(() => []),
    ]).then(([personas, hooks, moves]) => setLib({ personas, hooks, moves }))
  }, [])
  useEffect(() => {
    api('/api/contents').then((cs) => setList(cs)).catch((e) => setErr(String(e.message || e)))   // cid=null → 카드 보드로 시작
  }, [])
  useEffect(() => { if (openId != null) { setCid(openId); onOpenHandled?.() } }, [openId])   // ③ Select Product → 이 콘텐츠를 그래프로 열기
  const reloadList = () => api('/api/contents').then((cs) => setList(cs)).catch(() => {})
  // 보드에서 실행 중(잡) 콘텐츠 뱃지 — 4s 폴링
  useEffect(() => {
    if (cid != null) return
    let alive = true
    const tick = () => api('/api/jobs?status=running').then((r) => { if (alive) setRunningIds(new Set((r.jobs || []).filter((j) => j.ref_type === 'contents').map((j) => Number(j.ref_id)))) }).catch(() => {})
    tick(); const iv = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [cid])
  useEffect(() => { if (cid == null) return; setData(null); setErr(null); setSel(null); setSourceStale(false); api(`/api/contents/${cid}`).then((r) => { srcSig.current = r.analysis?.analyzed_at || null; setContentMode(r.content?.content_mode || ''); setData(adapt(r)) }).catch((e) => setErr(String(e.message || e))) }, [cid])
  useEffect(() => { api('/api/content-modes').then((r) => setModes(r.modes || [])).catch(() => {}) }, [])
  function saveContentMode(v) { setContentMode(v); if (cid != null) postJSON(`/api/contents/${cid}/content-mode`, { mode: v || null }).catch(() => {}) }
  // 소스 분석 변경 감지 — 재분석(잡)이 끝나 analyzed_at가 바뀌면 stale 배너. 창 포커스 + 25s 주기.
  useEffect(() => {
    if (cid == null) return
    const check = () => api(`/api/contents/${cid}`).then((r) => { const sig = r.analysis?.analyzed_at || null; if (srcSig.current != null && sig !== srcSig.current) setSourceStale(true) }).catch(() => {})
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(check, 25000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [cid])
  function refreshSource() { if (cid == null) return; api(`/api/contents/${cid}`).then((r) => { srcSig.current = r.analysis?.analyzed_at || null; setSel(null); setSourceStale(false); setData(adapt(r)) }).catch((e) => setErr(String(e.message || e))) }
  // 노드 업데이트 + 하류(edge로 도달 가능한 모든 노드) dirty 전파
  function commitRun(nodeId, patchNode) {
    setNg((g) => {
      const down = new Set(); const q = [nodeId]
      while (q.length) { const cur = q.shift(); g.edges.forEach((e) => { if (e.from === cur && !down.has(e.to)) { down.add(e.to); q.push(e.to) } }) }
      const nodes = g.nodes.map((x) => x.id === nodeId ? patchNode(x) : (down.has(x.id) ? { ...x, dirty: true } : x))
      const nn = { ...g, nodes }; ngRef.current = nn; return nn
    })
  }
  // persona + hook 추천 (analysis+product 기반) → 두 입력 노드에 적용 + 저장 + 하류 stale
  async function applyRecommend() {
    if (cid == null || running) return
    setErr(null); setRunning({ id: 'in-0', msg: 'recommending persona + hook…', t0: Date.now() })
    try {
      const r = await postJSON(`/api/contents/${cid}/recommend`, {})
      if (r.persona) await postJSON(`/api/contents/${cid}/persona`, { persona: r.persona })
      if (r.hook) await postJSON(`/api/contents/${cid}/hook`, { hook: r.hook })
      setNg((g) => {
        const down = new Set(['in-0', 'in-1'])
        let changed = true
        while (changed) { changed = false; g.edges.forEach((e) => { if (down.has(e.from) && !down.has(e.to)) { down.add(e.to); changed = true } }) }
        const nodes = g.nodes.map((x) => {
          if (x.id === 'in-0' && r.persona) return { ...x, t: r.persona }
          if (x.id === 'in-1' && r.hook) return { ...x, t: r.hook }
          return (x.id !== 'in-0' && x.id !== 'in-1' && down.has(x.id)) ? { ...x, dirty: true } : x
        })
        const nn = { ...g, nodes }; ngRef.current = nn; return nn
      })
    } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
  }
  // 노드 실행 — 각 노드를 백엔드 엔드포인트로 재생성하고 결과를 노드에 반영. 지원: overall · image-prompt · image · clip · vo.
  async function runNode(n) {
    if (cid == null || running) return
    setErr(null)
    const t0 = Date.now()
    if (n.kind === 'overall') {
      setRunning({ id: n.id, msg: 'starting…', t0 })
      try {
        const resp = await postJSON(`/api/contents/${cid}/overall`, {})
        const o = resp && resp.jobId ? await pollJob(resp.jobId, (jb) => setRunning({ id: n.id, msg: jb.message || '', t0 })) : resp
        if (o) commitRun(n.id, (x) => ({ ...x, dirty: false, data: { ...x.data, angle: o.angle ?? x.data.angle, hookLine: o.hookLine || '', vo: o.vo || '', cta: o.cta || '', beats: Array.isArray(o.beats) ? o.beats.join(' / ') : (o.beats || '') } }))
      } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
      return
    }
    if (n.kind === 'movie') {                                     // preview(ffmpeg+VO) 또는 remotion(고품질)
      const mode = n.data.exportMode === 'remotion' ? 'remotion' : 'preview'
      setRunning({ id: n.id, msg: mode === 'remotion' ? 'remotion render… (~수분)' : 'ffmpeg preview + VO…', t0 })
      try {
        const r = await postJSON(`/api/contents/${cid}/${mode === 'remotion' ? 'remotion' : 'movie'}`, {})
        const url = r.preview || r.url
        if (url) commitRun(n.id, (x) => ({ ...x, dirty: false, video: bust(media(url), Date.now()) }))
      } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
      return
    }
    const k = n.scene ? n.scene - 1 : null                        // 0-based 씬 index
    const id = typeof n.id === 'string' ? n.id : ''
    const ep = id.startsWith('prompt-') ? 'prompt' : id.startsWith('promptV-') ? 'votext' : id.startsWith('promptM-') ? 'motion'
      : n.kind === 'image' ? 'image' : n.kind === 'clip' ? 'clip' : n.kind === 'vo' ? 'vo' : null
    if (!ep || k == null) { setErr(`'${n.hd}' re-run isn't wired (supported: overall · image-prompt · motion · VO-text · image · clip · vo).`); return }
    setRunning({ id: n.id, msg: 'running…', t0 })
    try {
      const body = (ep === 'prompt' || ep === 'motion' || ep === 'votext') ? { guidance: n.data.guidance || '' } : {}
      await postJSON(`/api/contents/${cid}/scene/${k}/${ep}`, body)   // 씬 스크립트 + input prompt(guidance) 기반 생성
      const r = await api(`/api/contents/${cid}`)                   // 새 씬 데이터 가져와 (buildGraph와 동일 필드로) 노드 갱신
      const s = (parse(r.content?.scenes) || [])[k] || {}
      commitRun(n.id, (x) => {
        if (id.startsWith('prompt-')) return { ...x, dirty: false, t: (s.imagePrompt || '').slice(0, 90), data: { ...x.data, prompt: s.imagePrompt || '' } }
        if (id.startsWith('promptV-')) return { ...x, dirty: false, t: (s.voEn || '').slice(0, 90), data: { ...x.data, prompt: s.voEn || '' } }
        if (id.startsWith('promptM-')) return { ...x, dirty: false, t: (s.motionPrompt || '').slice(0, 90), data: { ...x.data, prompt: s.motionPrompt || '' } }
        if (x.kind === 'image') return { ...x, dirty: false, thumb: bust(media(s.image), Date.now()), data: { ...x.data, image: s.image || '', imagePrompt: s.imagePrompt || '' } }
        if (x.kind === 'clip') return { ...x, dirty: false, video: bust(media(s.video), Date.now()), image: bust(media(s.image), Date.now()) }
        if (x.kind === 'vo') return { ...x, dirty: false, audio: bust(media(s.audio), Date.now()) }
        return { ...x, dirty: false }
      })
    } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
  }
  // 배치 후 씬 노드 미디어(이미지/클립/VO)만 최신으로 갱신 (그래프 편집/위치 보존)
  async function refreshSceneMedia() {
    const r = await api(`/api/contents/${cid}`), scenes = parse(r.content?.scenes) || [], v = Date.now()
    setNg((g) => {
      const nodes = g.nodes.map((x) => {
        const k = x.scene; if (!k) return x
        const s = scenes[k - 1]; if (!s) return x
        if (x.kind === 'image') return { ...x, dirty: false, thumb: bust(media(s.image), v), data: { ...x.data, image: s.image || '', imagePrompt: s.imagePrompt || '' } }
        if (x.kind === 'clip') return { ...x, dirty: false, video: bust(media(s.video), v), image: bust(media(s.image), v) }
        if (x.kind === 'vo') return { ...x, dirty: false, audio: bust(media(s.audio), v) }
        return x
      })
      const nn = { ...g, nodes }; ngRef.current = nn; return nn
    })
  }
  // 배치 생성 (순차 큐) — 기존 /batch 엔드포인트 재사용. kind: images | clips | vo
  async function runBatchKind(kind) {
    if (cid == null || running) return
    setErr(null)
    const prefix = kind === 'clips' ? 'clip-' : kind === 'vo' ? 'vo-' : 'image-', t0 = Date.now()
    try {
      const resp = await postJSON(`/api/contents/${cid}/batch`, { kind })
      let job = resp && resp.job
      while (job && job.status === 'running') {
        setRunning({ id: prefix + ((job.current ?? 0) + 1), msg: `${kind} ${job.done}/${job.total}`, t0 })
        await new Promise((res) => setTimeout(res, 1500))
        job = (await api(`/api/contents/${cid}/batch`)).job
      }
      await refreshSceneMedia()
      if (job && job.fails && job.fails.length) setErr(`${kind}: ${job.fails.length} scene(s) failed${job.lastError ? ' — ' + job.lastError : ''}`)
    } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
  }
  async function runBatchAll() { for (const k of ['images', 'clips', 'vo']) await runBatchKind(k) }
  // 씬 스크립트 생성 (overall → scene[] 분해) — 구조가 바뀌므로 재로드/재빌드. 기존 씬 자산은 초기화됨.
  async function runScenes() {
    if (cid == null || running) return
    if (!window.confirm('Generate scene scripts from the Script Engine? This rebuilds the scene chain and clears existing scene images/clips/VO.')) return
    setErr(null); setRunning({ id: 'overall', msg: 'generating scene scripts…', t0: Date.now() })
    try {
      await postJSON(`/api/contents/${cid}/script`, {})
      const r = await api(`/api/contents/${cid}`)
      srcSig.current = r.analysis?.analyzed_at || null; setContentMode(r.content?.content_mode || ''); setSel(null); setData(adapt(r))
    } catch (e) { setErr(String(e.message || e)) } finally { setRunning(null) }
  }
  // 편집 저장 — 노드의 텍스트를 백엔드에 반영(자산은 보존)하고, 편집 노드 dirty 해제 + 하류 dirty 전파.
  // scene-script / VO text / motion prompt / image prompt는 재생성이 아니라 "편집"이 소스가 된다.
  async function persistNode(n) {
    if (cid == null || !n) return
    try {
      if (n.kind === 'overall') {
        const d = n.data || {}, r = await api(`/api/contents/${cid}`), cur = parse(r.content?.overall) || {}
        const overall = { ...cur, angle: d.angle || '', hookLine: d.hookLine || '', vo: d.vo || '', cta: d.cta || '', beats: (d.beats || '').split('/').map((s) => s.trim()).filter(Boolean) }
        await postJSON(`/api/contents/${cid}/overall`, { overall }, 'PUT')
        postJSON(`/api/contents/${cid}/direction`, { direction: d.direction || '' }).catch(() => {})   // 생성 파라미터도 저장
        postJSON(`/api/contents/${cid}/shot-count`, { shotCount: d.shotCount || '' }).catch(() => {})
        commitRun(n.id, (x) => ({ ...x, dirty: false })); return
      }
      if (n.kind === 'image') { postJSON(`/api/contents/${cid}/style`, { style: n.data.style || '' }).catch(() => {}); return }   // 전 씬 공통 스타일
      const idx = n.scene ? n.scene - 1 : null
      if (idx == null || typeof n.id !== 'string') return
      let patch = null
      if (n.id.startsWith('script-')) patch = { onScreenText: n.data.title || '', vo: n.data.vo || '' }
      else if (n.id.startsWith('promptV-')) patch = { voEn: n.data.prompt || '' }
      else if (n.id.startsWith('promptM-')) patch = { motionPrompt: n.data.prompt || '' }
      else if (n.id.startsWith('prompt-')) patch = { imagePrompt: n.data.prompt || '' }
      if (!patch) return
      const r = await api(`/api/contents/${cid}`), cur = parse(r.content?.scenes) || []   // 최신 씬 → 자산 클로버 방지
      const scenes = cur.map((s, i) => i === idx ? { ...s, ...patch } : s)
      await postJSON(`/api/contents/${cid}/scenes`, { scenes }, 'PUT')
      commitRun(n.id, (x) => ({ ...x, dirty: false }))
    } catch (e) { setErr(String(e.message || e)) }
  }
  useEffect(() => { const g = data ? buildGraph(data) : { nodes: [], edges: [], refLib: { product: [], character: [], environment: [] } }; loadedRefKey.current = JSON.stringify(g.refLib); loadedNameKey.current = g.nodes.map((n) => n.id + '=' + n.hd).join('|'); ngRef.current = g; hist.current = { past: [], future: [], key: null }; setHistN({ u: 0, r: 0 }); setNg(g) }, [data])
  // 레퍼런스 라이브러리 정리(추가/이동/삭제)를 자동 저장 — 로드값과 다를 때만
  const refLibKey = JSON.stringify(ng.refLib)
  useEffect(() => {
    if (cid == null || !data || refLibKey === loadedRefKey.current) return
    postJSON(`/api/contents/${cid}/ref-lib`, { refLib: ng.refLib }, 'PUT').catch(() => {})
  }, [refLibKey])
  // 편집한 노드 이름 자동 저장 (디바운스) — 로드값과 다를 때만
  const nameKey = ng.nodes.map((n) => n.id + '=' + n.hd).join('|')
  useEffect(() => {
    if (cid == null || !data || nameKey === loadedNameKey.current) return
    const t = setTimeout(() => { const meta = {}; ng.nodes.forEach((n) => { meta[n.id] = n.hd }); postJSON(`/api/contents/${cid}/node-meta`, { nodeMeta: meta }, 'PUT').catch(() => {}) }, 700)
    return () => clearTimeout(t)
  }, [nameKey])

  const graph = ng
  const nodeById = useMemo(() => { const m = {}; graph.nodes.forEach((n) => (m[n.id] = n)); return m }, [graph])
  const ctx = useMemo(() => ({ persona: data?.persona || '—', hook: data?.hook || '—', angle: data?.overall?.angle || '—', product: data?.product?.title || '—' }), [data])
  const selNode = nodeById[selId]
  const lastSel = useRef(null)
  if (selNode) lastSel.current = selNode
  const drawerNode = selNode || (closing ? lastSel.current : null)
  useEffect(() => {
    if (selId) { setClosing(false); return }
    if (lastSel.current) { setClosing(true); const t = setTimeout(() => { setClosing(false); lastSel.current = null }, 220); return () => clearTimeout(t) }
  }, [selId])

  useLayoutEffect(() => { const h = {}; graph.nodes.forEach((n) => { const el = nodeRefs.current[n.id]; if (el) h[n.id] = el.offsetHeight }); setHeights(h) }, [graph])

  const anchor = (n, side) => ({ x: n.x + (side === 'out' ? nodeW(n) : 0), y: n.y + (heights[n.id] || 90) / 2 })
  const paths = graph.edges.map((e, i) => { const a = nodeById[e.from], b = nodeById[e.to]; if (!a || !b) return null; const p1 = anchor(a, 'out'), p2 = anchor(b, 'in'), dx = Math.max(40, (p2.x - p1.x) * 0.5); return { key: i, i, d: `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`, color: EDGE_COLOR[e.cls] || '#7d8590', dashed: e.cls === 'global', editable: ['ref', 'product', 'character', 'environment'].includes(e.cls), label: (e.from === 'overall' && e.to.indexOf('script-') === 0 && b.scene != null) ? { x: p2.x - 34, y: p2.y - 5, t: b.scene } : null, from: e.from, to: e.to } }).filter(Boolean)
  // spotlight: selecting a node keeps it + its direct neighbors bright, dims the rest
  const near = selId ? (() => { const s = new Set([selId]); graph.edges.forEach((e) => { if (e.from === selId || e.to === selId) { s.add(e.from); s.add(e.to) } }); return s })() : null
  const selFromArray = drawerNode ? graph.edges.some((e) => e.to === drawerNode.id && KIND[nodeById[e.from]?.kind]?.out?.array) : false
  const wireFrom = wireEnd ? nodeById[wireEnd.fromId] : null

  // ── undo / redo (snapshot stack over the graph) ──
  const sync = () => setHistN({ u: hist.current.past.length, r: hist.current.future.length })
  function pushSnap(snap, coalesceKey) {
    const h = hist.current
    if (coalesceKey && h.key === coalesceKey && h.past.length) return   // same continuous edit → keep first snapshot
    h.past.push(snap); if (h.past.length > 200) h.past.shift(); h.future = []; h.key = coalesceKey || null; sync()
  }
  function commit(updater, coalesceKey) {
    const prev = ngRef.current
    const next = typeof updater === 'function' ? updater(prev) : updater
    if (next === prev) return                                            // no-op (e.g. duplicate edge)
    pushSnap(prev, coalesceKey); ngRef.current = next; setNg(next)
  }
  function undo() { const h = hist.current; if (!h.past.length) return; h.future.push(ngRef.current); const p = h.past.pop(); h.key = null; ngRef.current = p; setNg(p); sync() }
  function redo() { const h = hist.current; if (!h.future.length) return; h.past.push(ngRef.current); const n = h.future.pop(); h.key = null; ngRef.current = n; setNg(n); sync() }
  useEffect(() => { hist.current.key = null }, [selId])                  // node switch breaks edit-coalescing
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return                  // let text fields keep native editing
      if (!(e.metaKey || e.ctrlKey)) return
      const z = e.key === 'z' || e.key === 'Z'
      if (z && e.shiftKey) { e.preventDefault(); redo() }
      else if (z) { e.preventDefault(); undo() }
      else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onWheel(ev) { ev.preventDefault(); const r = ev.currentTarget.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; setView((v) => { const k = Math.min(2, Math.max(0.2, v.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1))); return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) } }) }
  function startNodeDrag(ev, n) { if (ev.target.closest('video, button, select, a, input, .ng-del, .ng-voplayer')) return; ev.stopPropagation(); dragSnap.current = ngRef.current; drag.current = { id: n.id, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false } }
  function onDown(ev) { if (ev.target.closest('.ng-node')) return; if (!locked) setSel(null); pan.current = { sx: ev.clientX, sy: ev.clientY, x: view.x, y: view.y } }
  function frameNode(id) {
    const n = nodeById[id]; if (!n || !canvasRef.current) return
    const r = canvasRef.current.getBoundingClientRect()
    const cx = n.x + NODE_W / 2, cy = n.y + (heights[id] || 100) / 2, dh = drawerH
    setFraming(true)
    setView((v) => ({ ...v, x: r.width / 2 - cx * v.k, y: (r.height - dh) / 2 - cy * v.k }))
    setSel(id)
    setTimeout(() => setFraming(false), 480)
  }
  function onMove(ev) {
    if (drag.current) { const d = drag.current; if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 3) d.moved = true; const dx = (ev.clientX - d.sx) / view.k, dy = (ev.clientY - d.sy) / view.k; setNg((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: d.ox + dx, y: d.oy + dy } : n) })); return }
    const p = pan.current; if (!p) return; const nx = p.x + (ev.clientX - p.sx), ny = p.y + (ev.clientY - p.sy); setView((v) => ({ ...v, x: nx, y: ny }))
  }
  function onUp() { if (drag.current) { const d = drag.current; drag.current = null; if (!d.moved) setSel(d.id); else { pushSnap(dragSnap.current); setNg((g) => { const n = { ...g, nodes: g.nodes.map((x) => x.id === d.id ? { ...x, x: Math.round(x.x / 20) * 20, y: Math.round(x.y / 20) * 20 } : x) }; ngRef.current = n; return n }) } } pan.current = null }
  function deleteNode(id) { commit((g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) })); if (selId === id) setSel(null) }
  function setNodeData(id, patch) { commit((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, data: { ...n.data, ...patch } } : n) }), 'data:' + id + ':' + Object.keys(patch).join(',')) }
  function setNodeField(id, patch) { commit((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, ...patch } : n) }), 'field:' + id + ':' + Object.keys(patch).join(',')) }
  function setNodeScene(id, v) { if (!(v > 0)) return; commit((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === id ? { ...n, dirty: true, scene: v, hd: /^scene \d+$/.test(n.hd || '') ? 'scene ' + v : n.hd } : n) })) }
  function toggleRef(id, role, refId) {
    commit((g) => ({ ...g, nodes: g.nodes.map((n) => { if (n.id !== id) return n; const refs = { product: [], character: [], environment: [], ...(n.data.refs || {}) }; const arr = refs[role] = [...(refs[role] || [])]; const i = arr.indexOf(refId); if (i >= 0) arr.splice(i, 1); else arr.push(refId); return { ...n, dirty: true, data: { ...n.data, refs } } }) }))
    const node = ngRef.current.nodes.find((n) => n.id === id)   // 이미지 노드의 ref 배정을 씬에 저장 (생성에 반영)
    if (node && node.scene) persistSceneRefs(node.scene - 1, node.data.refs)
  }
  async function persistSceneRefs(idx, refs) {
    if (cid == null) return
    try { const r = await api(`/api/contents/${cid}`), cur = parse(r.content?.scenes) || []; const scenes = cur.map((s, i) => i === idx ? { ...s, graphRefs: refs } : s); await postJSON(`/api/contents/${cid}/scenes`, { scenes }, 'PUT') } catch { /* ignore */ }
  }
  let uidN = useRef(0)
  function createNode(kind, wx, wy) {
    const id = kind + '-u' + (uidN.current++), x = Math.round(wx / 20) * 20, y = Math.round(wy / 20) * 20
    let node
    if (kind === 'persona' || kind === 'hook') node = { id, role: 'input', hd: kind, t: '(set value)', sub: kind === 'persona' ? 'VO voice' : 'story shape', x, y, data: {} }
    else if (kind === 'animref') node = { id, role: 'animref', hd: 'animation ref', t: 'drop a video · or ✎ URL', sub: 'motion / acting', x, y, data: { clip: '' } }
    else node = { id, role: kind, kind: KIND[kind] ? kind : undefined, hd: kind, x, y, data: {} }
    commit((g) => ({ ...g, nodes: [...g.nodes, { ...node, dirty: true }] })); setMenu(null)
  }
  function onCanvasMenu(ev) { ev.preventDefault(); const r = ev.currentTarget.getBoundingClientRect(); setMenu({ sx: ev.clientX, sy: ev.clientY, wx: (ev.clientX - r.left - view.x) / view.k, wy: (ev.clientY - r.top - view.y) / view.k }) }
  function addEdge(fromId, toId) { commit((g) => { if (g.edges.some((e) => e.from === fromId && e.to === toId)) return g; const from = g.nodes.find((n) => n.id === fromId); return { ...g, edges: [...g.edges, { from: fromId, to: toId, cls: edgeClassFor(outTypeOf(from), from), key: from?.refKey }] } }) }
  function cutEdge(idx) { commit((g) => ({ ...g, edges: g.edges.filter((_, i) => i !== idx) })) }
  function startWire(ev, n) {
    ev.stopPropagation(); ev.preventDefault()
    const world = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k } }
    const mv = (e) => { const p = world(e); const nd = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ng-node'); const tid = nd?.dataset.id; const valid = tid && tid !== n.id && canConnect(n, nodeById[tid]); setWireEnd({ ...p, fromId: n.id, targetId: tid && tid !== n.id ? tid : null, valid }) }
    const up = (e) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); const tid = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ng-node')?.dataset.id; if (tid && tid !== n.id && canConnect(n, nodeById[tid])) addEdge(n.id, tid); setWireEnd(null) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    setWireEnd({ ...anchor(n, 'out'), fromId: n.id, targetId: null, valid: false })
  }
  function startDrawerResize(ev) { ev.preventDefault(); const sy = ev.clientY, h0 = drawerH, maxH = Math.round(window.innerHeight * 0.85); const mv = (e) => setDrawerH(Math.min(maxH, Math.max(140, h0 - (e.clientY - sy)))); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up) }
  function addRefAsset(role, thumb, name) { if (!thumb) return; commit((g) => ({ ...g, refLib: { ...g.refLib, [role]: [...(g.refLib[role] || []), { id: 'lib-' + (libUid.current++), thumb, role, name: name || role }] } })) }
  function deleteRefAsset(role, id) { commit((g) => ({ ...g, refLib: { ...g.refLib, [role]: (g.refLib[role] || []).filter((a) => a.id !== id) }, nodes: g.nodes.map((n) => (n.data && n.data.refs && n.data.refs[role]) ? { ...n, data: { ...n.data, refs: { ...n.data.refs, [role]: n.data.refs[role].filter((x) => x !== id) } } } : n) })) }
  async function dropRefs(ev, role) {
    ev.preventDefault(); ev.currentTarget.classList.remove('drag')
    const files = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) {   // 파일 드롭 → 서버 업로드(Higgsfield) → 생성에 쓸 수 있는 ref 저장
      if (cid == null) { setErr('open a content first'); return }
      for (const f of files) {
        try {
          const dataB64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
          const p = await postJSON(`/api/contents/${cid}/ref-upload`, { filename: f.name, contentType: f.type, dataB64 })
          const ref = (p.images && p.images[0]) || null
          if (ref) addRefAsset(role, ref, f.name)
        } catch (e) { setErr(String(e.message || e)) }
      }
      return
    }
    const uri = ev.dataTransfer?.getData('text/uri-list') || ev.dataTransfer?.getData('text/plain') || ''
    if (/^https?:/.test(uri)) addRefAsset(role, uri.trim(), role)
  }
  const hoverPreview = { onMouseEnter: (e) => setPreview({ url: e.target.src, x: e.clientX, y: e.clientY }), onMouseMove: (e) => setPreview((p) => p ? { ...p, x: e.clientX, y: e.clientY } : p), onMouseLeave: () => setPreview(null) }

  useEffect(() => { if (!running) return; const iv = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(iv) }, [running])
  const runSecs = running ? Math.floor((Date.now() - running.t0) / 1000) : 0
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="ng-wrap" style={{ top }}>
      {cid == null ? <Board list={list} running={runningIds} onOpen={setCid} reload={reloadList} /> : <>
      <div className="ng-bar">
        <button className="ng-libtoggle ng-backbtn" onClick={() => { setSel(null); setCid(null) }} title="back to the board">← Board</button>
        <span className="ng-barsep" />
        <button className={'ng-libtoggle' + (libOpen ? ' on' : '')} onClick={() => setLibOpen((o) => !o)} title="reference asset library">▤ refs</button>
        <button className="ng-libtoggle" onClick={undo} disabled={!histN.u} title="undo (⌘Z)">↶</button>
        <button className="ng-libtoggle" onClick={redo} disabled={!histN.r} title="redo (⇧⌘Z)">↷</button>
        <button className={'ng-libtoggle' + (sourceStale ? ' stale' : '')} onClick={refreshSource} title="reload graph from the latest source analysis (discards local graph edits)">↻ source{sourceStale ? ' •' : ''}</button>
        <button className="ng-libtoggle" onClick={refreshSceneMedia} disabled={cid == null || !!running} title="refresh image/clip/VO thumbnails to the latest generated files (keeps your layout)">↻ media</button>
        <select value={cid ?? ''} onChange={(e) => setCid(Number(e.target.value))}>{list.map((c) => <option key={c.id} value={c.id}>#{c.id} {(c.title || 'untitled').slice(0, 30)}</option>)}</select>
        <span className="ng-barsep" />
        <select value={contentMode} onChange={(e) => saveContentMode(e.target.value)} title={(() => { const m = modes.find((x) => x.key === contentMode); return m ? `${m.use_when} · allow: ${(m.allow || []).join(', ')} · never: ${(m.ban || []).join(', ')}` : 'safe default (Curated Find) — result claims softened to observations' })()}>
          <option value="">◇ mode: safe default</option>
          {modes.map((m) => <option key={m.key} value={m.key}>◇ {m.label}{m.requires_footage ? ' (needs footage)' : ''}</option>)}
        </select>
        <span className="ng-barsep" />
        <div className="ng-genwrap">
          <button className={'ng-libtoggle' + (genOpen ? ' on' : '')} disabled={!!running} onClick={() => setGenOpen((o) => !o)} title="batch generate (sequential, one at a time)">⚙ generate ▾</button>
          {genOpen && <>
            <div className="ng-genbd" onClick={() => setGenOpen(false)} />
            <div className="ng-genmenu">
              <div className="ng-genitem" onClick={() => { setGenOpen(false); runScenes() }}>▶ scene scripts<span>from Script Engine (rebuilds)</span></div>
              <div className="ng-genitem" onClick={() => { setGenOpen(false); runBatchAll() }}>▶ all<span>images → clips → VO</span></div>
              <div className="ng-genitem" onClick={() => { setGenOpen(false); runBatchKind('images') }}>▶ all images<span>every scene</span></div>
              <div className="ng-genitem" onClick={() => { setGenOpen(false); runBatchKind('clips') }}>▶ all clips<span>needs images first</span></div>
              <div className="ng-genitem" onClick={() => { setGenOpen(false); runBatchKind('vo') }}>▶ all VO<span>every scene</span></div>
            </div>
          </>}
        </div>
      </div>
      {sourceStale && (
        <div className="ng-stale">
          <span>⟳ Source analysis was updated.</span>
          <button onClick={refreshSource} title="rebuild graph from the new analysis — discards local graph edits">Refresh graph</button>
          <button className="dismiss" onClick={() => setSourceStale(false)}>Dismiss</button>
        </div>
      )}
      {err && <div className="ng-err">{err}</div>}
      <div className="ng-canvas" ref={canvasRef} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onContextMenu={onCanvasMenu}>
        {!data && <div className="ng-loading">loading #{cid}…</div>}
        <div className="ng-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`, transition: framing ? 'transform .46s cubic-bezier(.22,.61,.36,1)' : 'none' }}>
          <svg className="ng-edges">
            {paths.map((p) => (<g key={p.key}>
              {p.editable && <path className="ng-edge-hit" d={p.d} onClick={() => cutEdge(p.i)} />}
              {(() => { const hot = selId && (p.from === selId || p.to === selId); const op = selId ? (hot ? 0.98 : 0.06) : (p.dashed ? 0.5 : 0.9); return <path d={p.d} stroke={p.color} strokeWidth={hot ? 2.6 : 1.6} fill="none" strokeDasharray={p.dashed ? '5 4' : 'none'} opacity={op} style={{ transition: 'opacity .16s, stroke-width .12s' }} /> })()}
              {p.label && <text x={p.label.x} y={p.label.y} fill="#c9b3ea" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fontWeight="600">{p.label.t}</text>}
            </g>))}
            {wireEnd && wireFrom && (() => { const p1 = anchor(wireFrom, 'out'), dx = Math.max(40, (wireEnd.x - p1.x) * 0.5); return <path className="ng-tmp-edge" d={`M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${wireEnd.x - dx},${wireEnd.y} ${wireEnd.x},${wireEnd.y}`} /> })()}
          </svg>
          {graph.nodes.map((n) => {
            const c = nodeColor(n), tl = typeLabel(n)
            const inWired = graph.edges.some((e) => e.to === n.id), outWired = graph.edges.some((e) => e.from === n.id)
            const wt = wireEnd && wireEnd.targetId === n.id ? (wireEnd.valid ? ' wire-target' : ' wire-bad') : ''
            return (
              <div key={n.id} data-id={n.id} ref={(el) => (nodeRefs.current[n.id] = el)} className={'ng-node tier-' + tierOf(n) + (n.kind === 'overall' ? ' ng-engine' : '') + (n.id === selId ? ' sel' : '') + (near && !near.has(n.id) ? ' dim' : '') + (n.dirty ? ' dirty' : '') + (running && running.id === n.id ? ' running' : '') + wt} style={{ left: n.x, top: n.y, width: nodeW(n), color: c, '--nc': c, borderColor: (n.id === selId ? c : c + '99') }} onPointerDown={(e) => startNodeDrag(e, n)}>
                {tl && <span className="ng-type" style={{ color: c, borderColor: c + '66' }}>{tl}</span>}
                {running && running.id === n.id && <span className="ng-node-timer">⏳ {fmtDur(runSecs)}{running.msg && running.msg !== 'running…' ? ' · ' + running.msg : ''}</span>}
                <button className="ng-del" title="delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id) }}>×</button>
                {n.kind === 'image' && (n.thumb ? <img className="ng-thumb" style={{ aspectRatio: aspectCSS(n.data?.aspect) }} src={n.thumb} loading="lazy" {...hoverPreview} onError={(e) => { e.target.style.opacity = .2 }} /> : <div className="ng-thumb ph" style={{ aspectRatio: aspectCSS(n.data?.aspect) }}>{n.data?.aspect || '9:16'}</div>)}
                {n.kind === 'clip' && (n.video ? <video className="ng-thumb" src={n.video} muted loop playsInline preload="metadata" onMouseOver={(e) => e.target.play()} onMouseOut={(e) => e.target.pause()} /> : n.image ? <img className="ng-thumb" style={{ opacity: .4 }} src={n.image} /> : null)}
                {n.kind === 'movie' && n.video && <video className="ng-thumb" src={n.video} controls playsInline preload="metadata" />}
                {n.kind === 'analysis' && n.data?.reel?.thumb && <img className="ng-thumb" src={n.data.reel.thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
                <div className="ng-hd" style={{ color: c }}><span className="ng-dot" style={{ background: c }} />{n.hd}</div>
                {n.t && n.kind !== 'prompt' && <div className="ng-t">{n.t}</div>}
                {n.sub && <div className="ng-sub">{n.sub}</div>}
                {n.kind === 'vo' && (n.audio ? <VoPlayer src={n.audio} /> : <div className="ng-sub">no VO yet</div>)}
                {n.kind === 'clip' && <div className="ng-pill">{n.data?.makeVideo === 'still' ? '🖼 still' : '🎥 ' + cameraMoveName(n.data?.cameraMove, lib.moves)}</div>}
                {hasInput(n) && <span className={'ng-port in' + (inWired ? ' wired' : '')} style={{ '--pc': c, borderColor: c }} />}
                <span className={'ng-port out' + (outWired ? ' wired' : '')} style={{ '--pc': c, borderColor: c }} onPointerDown={(e) => startWire(e, n)} title="drag to connect" />
              </div>
            )
          })}
        </div>
      </div>

      {libOpen && (
        <div className="ng-libpanel" style={{ bottom: drawerNode ? drawerH : 0 }}>
          {['product', 'character', 'environment'].map((role) => {
            const items = graph.refLib[role] || []
            return (
              <div key={role} className="ng-libzone" onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag') }} onDragLeave={(e) => e.currentTarget.classList.remove('drag')} onDrop={(e) => dropRefs(e, role)}>
                <h4><span className="d" style={{ background: COLOR[role] }} />{role}<span className="add" title="add by URL" onClick={() => { const url = window.prompt(role + ' reference — image URL:'); if (url) addRefAsset(role, url, role + ' ' + (items.length + 1)) }}>＋</span></h4>
                {items.length
                  ? <div className="ng-libgrid">{items.map((a) => (
                    <div key={a.id} className="ng-libitem">
                      <img src={media(a.thumb)} onError={(e) => { e.target.style.opacity = .2 }} {...hoverPreview} />
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
        <div className="ng-ctxmenu" style={{ left: menu.sx, top: menu.sy }}>
          {MENU_ITEMS.map(([label, k], i) => k === 'h'
            ? <div key={i} className="mh">{label}</div>
            : <div key={i} className="mi" onClick={() => createNode(k, menu.wx, menu.wy)}><span className="dotk" style={{ background: MENU_COLOR[k] || '#888' }} />{label}<span className="sub">{menuOut(k)}</span></div>)}
        </div>
      </>)}

      {drawerNode && <Drawer n={drawerNode} closing={closing && !selId} ctx={ctx} lib={lib} refLib={graph.refLib} h={drawerH} onResize={startDrawerResize}
        fromArray={selFromArray} onScene={(v) => setNodeScene(drawerNode.id, v)} locked={locked} onLock={() => setLocked((l) => !l)} onFrame={frameNode}
        onRun={() => runNode(drawerNode)} runMsg={running && running.id === drawerNode.id ? (fmtDur(runSecs) + (running.msg && running.msg !== 'running…' ? ' · ' + running.msg : ' · running…')) : null} runBusy={!!running} onCommit={() => persistNode(drawerNode)} onRecommend={applyRecommend}
        onClose={() => { setLocked(false); setSel(null) }} onRename={(v) => setNodeField(drawerNode.id, { hd: v })}
        onField={(f, v) => {
          if (f === '__nodeval') {   // persona/hook 선택 → 노드 값 + 하류 stale + 콘텐츠에 저장(생성에 반영)
            commitRun(drawerNode.id, (x) => ({ ...x, t: v }))
            if (drawerNode.hd === 'persona') postJSON(`/api/contents/${cid}/persona`, { persona: v }).catch(() => {})
            else if (drawerNode.hd === 'hook') postJSON(`/api/contents/${cid}/hook`, { hook: v }).catch(() => {})
          } else setNodeData(drawerNode.id, { [f]: v })
        }}
        onToggleRef={(role, id) => toggleRef(drawerNode.id, role, id)} onDelete={() => deleteNode(drawerNode.id)} hoverPreview={hoverPreview}
        incoming={graph.edges.filter((e) => e.to === drawerNode.id).map((e) => nodeById[e.from]).filter(Boolean)}
        outgoing={graph.edges.filter((e) => e.from === drawerNode.id).map((e) => nodeById[e.to]).filter(Boolean)} />}
      </>}
    </div>
  )
}

// ── BOARD — collapsed content cards (grid, app theme); click to open the full graph ──
function Board({ list, running, onOpen, reload }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recent')
  const [confirmDel, setConfirmDel] = useState(null)   // 인라인 2-클릭 삭제 확인
  async function create() { try { const c = await postJSON('/api/contents', {}); await reload(); if (c?.id) onOpen(c.id) } catch { /* ignore */ } }
  async function dup(e, id) { e.stopPropagation(); try { await postJSON(`/api/contents/${id}/duplicate`, {}); reload() } catch { /* ignore */ } }
  async function del(e, id) {
    e.stopPropagation(); e.preventDefault()
    if (confirmDel !== id) { setConfirmDel(id); setTimeout(() => setConfirmDel((c) => (c === id ? null : c)), 2600); return }   // 1클릭 = 무장, 2클릭 = 삭제
    setConfirmDel(null)
    try { await api(`/api/contents/${id}`, { method: 'DELETE' }); await reload() } catch (err) { window.alert('Delete failed: ' + (err.message || err)) }
  }
  let items = list
  if (q.trim()) { const s = q.toLowerCase(); items = items.filter((c) => `${c.title || ''} ${c.product_name || ''} ${c.persona || ''} ${c.hook || ''}`.toLowerCase().includes(s)) }
  if (sort === 'title') items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  else if (sort === 'movie') items = [...items].sort((a, b) => ((b.preview || b.export_mp4) ? 1 : 0) - ((a.preview || a.export_mp4) ? 1 : 0))
  // 'recent' = default (list already id DESC)
  return (
    <div className="ng-board">
      <div className="ng-board-bar">
        <button className="ng-newbtn" onClick={create}>+ New</button>
        <input className="ng-search" placeholder="search  ·  product / persona / hook" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">recent</option>
          <option value="title">title A–Z</option>
          <option value="movie">movie ready</option>
        </select>
        <span className="ng-board-count">{items.length}/{list.length}</span>
      </div>
      <div className="pgrid">
        {items.map((c) => {
          let sc = []; try { sc = c.scenes ? JSON.parse(c.scenes) : [] } catch { sc = [] }
          const thumb = c.product_image || c.reel_thumbnail || null
          const hasOverall = !!c.overall, hasMovie = !!c.preview || !!c.export_mp4
          const imgs = sc.filter((s) => s && (s.image || s.imageSrc)).length
          const title = c.title || c.product_name || c.analysis_title || 'untitled'
          return (
            <div key={c.id} className="pcard ng-pcard" onClick={() => onOpen(c.id)} title="open graph">
              {running?.has(c.id) && <span className="ng-card-run">● running</span>}
              <div className="ng-card-acts" onPointerDown={(e) => e.stopPropagation()}>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => dup(e, c.id)} title="duplicate">⧉</button>
                <button className={confirmDel === c.id ? 'ng-delarm' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => del(e, c.id)} title={confirmDel === c.id ? 'click again to delete' : 'delete'}>{confirmDel === c.id ? 'delete?' : '✕'}</button>
              </div>
              <div className="pbody">
                {thumb ? <img className="pthumb" src={thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} /> : <div className="pthumb ng-pthumb-ph">#{c.id}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pname">{title}</div>
                  <div className="pmet"><span className="muted">{c.persona || '—'} · {c.hook || '—'}</span></div>
                  <div className="pmet" style={{ marginTop: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
                    <span className="badge" style={{ color: 'var(--mut)', whiteSpace: 'nowrap' }}>{sc.length} sc · {imgs}/{sc.length} img</span>
                    {hasMovie ? <span className="badge" style={{ color: 'var(--green)' }}>🎬 movie</span> : hasOverall ? <span className="badge" style={{ color: 'var(--blue)' }}>overall</span> : <span className="badge" style={{ color: 'var(--acc)' }}>draft</span>}
                    {c.content_mode && <span className="badge" style={{ color: '#b9a3e6' }}>{c.content_mode.replace('_', ' ')}</span>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {!items.length && <div className="ng-card-empty">{list.length ? 'No matching content.' : 'No content yet — + New to start one.'}</div>}
      </div>
    </div>
  )
}

// VO 오디오 플레이어 — 재생/일시정지 + 스크러버(슬라이드바) + 시간 (프로토타입 voplayer)
function VoPlayer({ src }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const fmt = (s) => (isFinite(s) && s >= 0) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00'
  const toggle = (e) => { e.stopPropagation(); const a = ref.current; if (!a) return; if (a.paused) { a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) } }
  const seek = (e) => { const a = ref.current; if (a) { a.currentTime = Number(e.target.value); setCur(a.currentTime) } }
  return (
    <div className="ng-voplayer" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ng-voplay" onClick={toggle} title={playing ? 'pause' : 'play VO'}>{playing ? '❚❚' : '▶'}</button>
      <input type="range" className="ng-voseek" min={0} max={dur || 0} step="0.01" value={cur} onChange={seek} onClick={(e) => e.stopPropagation()} />
      <span className="ng-votime">{fmt(cur)} / {fmt(dur)}</span>
      <audio ref={ref} src={src} preload="metadata" onLoadedMetadata={(e) => setDur(e.target.duration || 0)} onTimeUpdate={(e) => setCur(e.target.currentTime)} onEnded={() => setPlaying(false)} />
    </div>
  )
}

// ── DRAWER — faithful to node-studio.html drawerHTML ──
function Field({ c, d, onField, onCommit }) {
  const cur = d[c.f] ?? ''
  if (c.fixed) return <span className="ng-fixed">{c.fixed}</span>
  let choices = c.choices
  if (c.cameraLib) choices = ['', 'auto'].concat((c._moves || []).map((m) => m.key))
  if (choices && choices.length) {
    const nameOf = (v) => { if (c.cameraLib) { if (v === '') return 'default (slow push-in)'; if (v === 'auto') return '✨ auto'; const m = (c._moves || []).find((x) => x.key === v); return m ? m.name : v } return v }
    return <select value={cur} onChange={(e) => { onField(c.f, e.target.value); onCommit?.() }}>{choices.map((v) => <option key={v} value={v}>{nameOf(v)}</option>)}</select>
  }
  if (c.multiline) return <textarea className="ng-smalltext" value={cur} placeholder={c.ph || ''} onChange={(e) => onField(c.f, e.target.value)} onBlur={onCommit} />
  return <input value={cur} placeholder={c.ph || ''} onChange={(e) => onField(c.f, e.target.value)} onBlur={onCommit} />
}

function Drawer({ n, closing, ctx, lib, refLib, h, onResize, onClose, onRename, onField, onToggleRef, onDelete, hoverPreview, fromArray, onScene, locked, onLock, onFrame, onRun, runMsg, runBusy, onCommit, onRecommend, incoming, outgoing }) {
  const c = nodeColor(n), k = KIND[n.kind], d = n.data || {}
  // re-run = 씬 스크립트 기반으로 생성하는 노드: overall · image-prompt · motion-prompt · VO-text · image · clip · vo.
  // scene-script(script-)만 "편집이 소스" → re-run 없음. 생성된 노드들은 생성 후 편집 가능.
  const isGenPrompt = typeof n.id === 'string' && (n.id.startsWith('prompt-') || n.id.startsWith('promptV-') || n.id.startsWith('promptM-'))
  const canRun = !!k && !k.source && (n.kind === 'overall' || n.kind === 'image' || n.kind === 'clip' || n.kind === 'vo' || n.kind === 'movie' || isGenPrompt)
  const header = (
    <div className="ng-dh">
      <span className="ng-k" style={{ background: c }} />
      <input className="ng-title-edit" value={n.hd} spellCheck={false} onChange={(e) => onRename(e.target.value)} />
      <span className="ng-kind">#{n.id}</span>
      {k && <span className="ng-out">→ {k.out.n} ({k.out.t})</span>}
      {canRun && <button className={'ng-run' + (runMsg ? ' running' : '')} onClick={onRun} disabled={runBusy} title={runMsg || 'run this node'}>▶ re-run</button>}
      <span className="ng-wctrl">
        <button className={'ng-icn' + (locked ? ' on' : '')} onClick={onLock} title={locked ? 'locked — stays open' : 'lock — keep open when clicking elsewhere'}>{locked ? '📌' : '📍'}</button>
        <button className="ng-icn" onClick={onClose} title="close">✕</button>
      </span>
    </div>
  )

  let body
  if (n.kind === 'analysis') {
    const r = d.reel || {}, p = d.product || {}, hk = d.hook || {}, st = d.struct || {}, aud = d.audience || {}, vs = d.visualStyle || {}
    const ss = Array.isArray(d.sceneScript) ? d.sceneScript : [], assets = Array.isArray(d.assets) ? d.assets : [], vf = Array.isArray(d.viralFactors) ? d.viralFactors : []
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
          {hk.scrollStopper && <div className="ng-kv"><span className="l">scroll stop</span><span className="v">{hk.scrollStopper}</span></div>}
          {hk.emotionalTrigger && <div className="ng-kv"><span className="l">emotion</span><span className="v">{hk.emotionalTrigger}</span></div>}
          {(aud.who || aud.painPoint || aud.objection) && <>
            <div className="ng-sh top">audience</div>
            {aud.who && <div className="ng-kv"><span className="l">who</span><span className="v">{aud.who}</span></div>}
            {aud.painPoint && <div className="ng-kv"><span className="l">pain</span><span className="v">{aud.painPoint}</span></div>}
            {aud.objection && <div className="ng-kv"><span className="l">objection</span><span className="v">{aud.objection}</span></div>}
          </>}
          <div className="ng-sh top">structure</div>
          <div className="ng-kv"><span className="l">format</span><span className="v">{st.format || '—'}</span></div>
          <div className="ng-kv"><span className="l">pacing</span><span className="v">{st.pacing || '—'}</span></div>
          {st.turningPoint && <div className="ng-kv"><span className="l">turn</span><span className="v">{st.turningPoint}</span></div>}
          {st.productIntegration && <div className="ng-kv"><span className="l">product in</span><span className="v">{st.productIntegration}</span></div>}
          <div className="ng-kv"><span className="l">cta</span><span className="v">{st.cta || '—'}</span></div>
          {st.whyItConverts && <div className="ng-kv"><span className="l">converts</span><span className="v">{st.whyItConverts}</span></div>}
          {(Array.isArray(st.beats) ? st.beats : []).map((b, i) => <div key={i} className="ng-kv"><span className="l">beat {i + 1}</span><span className="v">{typeof b === 'string' ? b : JSON.stringify(b)}</span></div>)}
          {(vs.lookFeel || vs.lighting || vs.palette || vs.textStyle || vs.editing) && <>
            <div className="ng-sh top">visual style</div>
            {vs.lookFeel && <div className="ng-kv"><span className="l">look</span><span className="v">{vs.lookFeel}</span></div>}
            {vs.lighting && <div className="ng-kv"><span className="l">lighting</span><span className="v">{vs.lighting}</span></div>}
            {vs.palette && <div className="ng-kv"><span className="l">palette</span><span className="v">{vs.palette}</span></div>}
            {vs.textStyle && <div className="ng-kv"><span className="l">text</span><span className="v">{vs.textStyle}</span></div>}
            {vs.editing && <div className="ng-kv"><span className="l">editing</span><span className="v">{vs.editing}</span></div>}
          </>}
        </div>
        <div className="ng-col right">
          <div className="ng-sh" style={{ color: '#5DCAA5' }}>matched product</div>
          {p.image && <img className="ng-athumb" src={p.image} style={{ background: '#fff' }} />}
          <div className="ng-kv"><span className="l">title</span><span className="v">{p.title || '—'}</span></div>
          <div className="ng-kv"><span className="l">price</span><span className="v">{p.price || '—'}</span></div>
          <div className="ng-kv"><span className="l">rating</span><span className="v">{p.rating ? '★ ' + p.rating + ' · ' + (p.reviews || 0) : '—'}</span></div>
          {p.dimensions && <div className="ng-kv"><span className="l">dims</span><span className="v">{p.dimensions}</span></div>}
          {p.asin && <div className="ng-kv"><span className="l" /><span className="v"><a href={'https://www.amazon.com/dp/' + p.asin} target="_blank" rel="noreferrer">Amazon ↗</a></span></div>}
          {ss.length > 0 && <>
            <div className="ng-sh top">scene script</div>
            {ss.map((s, i) => <div key={i} className="ng-kvtext"><b style={{ color: '#c9b3ea' }}>{s.t || `#${i + 1}`}</b> {s.shot || ''}{s.onScreenText ? ` · “${s.onScreenText}”` : ''}{s.vo ? ` · VO: ${s.vo}` : ''}</div>)}
          </>}
          {assets.length > 0 && <>
            <div className="ng-sh top">scene assets</div>
            {assets.map((s, i) => <div key={i} className="ng-kv"><span className="l">#{s.scene} {s.type}</span><span className="v">{s.need}</span></div>)}
          </>}
          {vf.length > 0 && <>
            <div className="ng-sh top">viral factors</div>
            {vf.map((f, i) => <div key={i} className="ng-kvtext">• {typeof f === 'string' ? f : JSON.stringify(f)}</div>)}
          </>}
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
            <button className="ng-recbtn" onClick={onRecommend} disabled={runBusy} style={{ marginTop: 11 }}>✨ recommend persona + hook</button>
          </> : <><div className="ng-sh">value</div><div className="ng-wired">{n.t || n.hd}</div></>}
        </div>
        <div className="ng-col right"><div className="ng-sh">context</div><div className="ng-ctxrow">persona <b>{ctx.persona}</b> · hook <b>{ctx.hook}</b></div><div className="ng-ctxrow">angle {ctx.angle}</div></div>
      </div>
    )
  } else if (n.kind === 'prompt') {
    // image-prompt / motion-prompt / VO-text: ① input(scene script) ② instruction ③ output(read-only)
    const scr = incoming.find((x) => x.kind === 'script')
    const outLabel = typeof n.id === 'string' && n.id.startsWith('promptV-') ? 'VO text' : (typeof n.id === 'string' && n.id.startsWith('promptM-')) ? 'motion' : 'image prompt'
    body = (
      <div className="ng-db">
        <div className="ng-col">
          <div className="ng-sh">① input · from scene script</div>
          <div className="ng-srcbox">
            {scr ? <>
              {scr.data?.title ? <div className="ng-kvtext"><b style={{ color: '#c9b3ea' }}>title</b> {scr.data.title}</div> : null}
              {scr.data?.vo ? <div className="ng-kvtext"><b style={{ color: '#c9b3ea' }}>VO</b> {scr.data.vo}</div> : null}
              {!scr.data?.title && !scr.data?.vo ? <span className="ng-none">— scene script empty —</span> : null}
            </> : <span className="ng-none">— not linked to a scene script —</span>}
          </div>
          <div className="ng-sh top">② instruction <em style={{ color: '#6b6a64', fontStyle: 'normal' }}>· steer the LLM (optional)</em></div>
          <textarea className="ng-instruct" value={d.guidance || ''} placeholder="e.g. tighter close-up · warmer tone · slower motion — then ▶ re-run" onChange={(e) => onField('guidance', e.target.value)} onBlur={onCommit} />
        </div>
        <div className="ng-col right">
          <div className="ng-sh">③ output prompt <em style={{ color: '#6b6a64', fontStyle: 'normal' }}>· {outLabel} · read-only, feeds downstream</em></div>
          <textarea className="ng-big ro" value={d.prompt || ''} readOnly placeholder="— run to generate —" />
          <div className="ng-sh top">→ feeds</div>
          <div className="ng-wired">{outgoing && outgoing.length ? outgoing.map((s) => <span key={s.id} className="ng-chip src" onClick={() => onFrame(s.id)} title="jump to node">◦ {s.hd}</span>) : <span className="ng-none">— not connected —</span>}</div>
          <div className="ng-ctxrow" style={{ marginTop: 10 }}>persona <b>{ctx.persona}</b> · hook <b>{ctx.hook}</b></div>
        </div>
      </div>
    )
  } else {
    const ed = k.editor
    const fedBy = incoming.filter((s) => outTypeOf(s) === 'text')
    const cfg = (k.config || []).map((cc) => ({ ...cc, _moves: lib.moves }))
    const hasMedia = (n.kind === 'image' && n.thumb) || ((n.kind === 'clip' || n.kind === 'movie') && n.video) || (n.kind === 'vo' && n.audio)
    body = (
      <div className="ng-db">
        <div className="ng-col">
          {n.kind === 'image' && n.thumb && <img className="ng-media-big" style={{ aspectRatio: aspectCSS(d.aspect), maxHeight: Math.max(130, h - 132) }} src={n.thumb} referrerPolicy="no-referrer" onError={(e) => { e.target.style.opacity = .25 }} />}
          {(n.kind === 'clip' || n.kind === 'movie') && n.video && <video className="ng-media-big" src={n.video} controls playsInline preload="metadata" style={{ maxHeight: Math.max(130, h - 132), width: 'auto', maxWidth: '100%', margin: '0 auto' }} />}
          {n.kind === 'vo' && n.audio && <div style={{ marginBottom: 8 }}><VoPlayer src={n.audio} /></div>}
          {ed && <>
            <div className={'ng-sh' + (hasMedia ? ' top' : '')}>{ed.label}</div>
            <div className={'ng-fed' + (fedBy.length ? '' : ' manual')}>{fedBy.length ? '◦ from ' + fedBy.map((s) => s.hd).join(', ') : '✎ manual'}</div>
            <textarea className={'ng-big' + (ed.readOnly ? ' ro' : '')} value={d[ed.field] || ''} readOnly={ed.readOnly} onChange={ed.readOnly ? undefined : (e) => onField(ed.field, e.target.value)} onBlur={ed.readOnly ? undefined : onCommit} />
          </>}
          {n.kind === 'image' && <>
            <div className="ng-sh top">references (from library)</div>
            {['product', 'character', 'environment'].map((role) => {
              const items = refLib[role] || [], on = (d.refs && d.refs[role]) || []
              return <div key={role} className="ng-refblk"><div className="ng-slot-h"><span style={{ color: COLOR[role] }}>{role}</span><em>{on.length} applied</em></div>
                <div className="ng-refchips">{items.length ? items.map((a) => <span key={a.id} className={'ng-refchip' + (on.includes(a.id) ? ' on' : '')} style={on.includes(a.id) ? { borderColor: COLOR[role], color: COLOR[role] } : null} onClick={() => onToggleRef(role, a.id)}><img src={media(a.thumb)} {...hoverPreview} />{a.name}</span>) : <span className="ng-none">— none —</span>}</div></div>
            })}
          </>}
        </div>
        <div className="ng-col right">
          <div className="ng-sh">properties</div>
          {fromArray && <div className="ng-prop"><label>index</label><select value={n.scene ?? ''} onChange={(e) => onScene(parseInt(e.target.value, 10))} style={{ color: '#c9b3ea', maxWidth: 110 }}>{n.scene == null && <option value="">— pick —</option>}{Array.from({ length: 100 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
          {cfg.length ? cfg.map((cc) => <div key={cc.f} className="ng-prop"><label>{cc.label || cc.f}</label><Field c={cc} d={d} onField={onField} onCommit={onCommit} /></div>) : <div className="ng-prop"><span className="ng-fixed">— none —</span></div>}
          <div className="ng-sh top">connections</div>
          <div className="ng-connlabel">← inputs <em>from</em></div>
          {(k.inputs && k.inputs.length) ? k.inputs.map((slot) => {
            const listS = slot.frame ? incoming.filter((s) => outTypeOf(s) === 'image' && ((s.data && s.data.frameRole) || 'start') === slot.frame) : incoming.filter((s) => outTypeOf(s) === slot.type)
            return <div key={slot.key} className="ng-slot"><div className="ng-slot-h"><span>{slot.label || slot.key}</span><em>{slot.type}{slot.multi ? '[]' : ''}</em></div><div className="ng-wired">{listS.length ? listS.map((s) => <span key={s.id} className="ng-chip src" onClick={() => onFrame(s.id)} title="jump to node">◦ {s.hd}</span>) : <span className="ng-none">— none —</span>}</div></div>
          }) : <div className="ng-wired"><span className="ng-none">— no inputs —</span></div>}
          <div className="ng-connlabel">→ output <em>{k.out.n} · {k.out.t}</em></div>
          <div className="ng-wired">{outgoing && outgoing.length ? outgoing.map((s) => <span key={s.id} className="ng-chip src" onClick={() => onFrame(s.id)} title="jump to node">◦ {s.hd}</span>) : <span className="ng-none">— not connected —</span>}</div>
          <div className="ng-sh top">context</div>
          <div className="ng-ctxrow">persona <b>{ctx.persona}</b> · hook <b>{ctx.hook}</b></div>
          <div className="ng-ctxrow">{ctx.product}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={'ng-drawer' + (closing ? ' closing' : '')} style={{ height: h }}>
      <div className="ng-drawer-grip" onPointerDown={onResize} />
      {header}
      {body}
    </div>
  )
}
