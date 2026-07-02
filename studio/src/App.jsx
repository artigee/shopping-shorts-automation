import { useEffect, useState } from 'react'

// The pipeline studio: find → analysis → product → content(node graph).
// New UI, but reuses the EXISTING backend endpoints (:5174 via vite proxy).
// Old webapp is untouched; this is the fresh front-end that will grow the node graph at ④.

const STAGES = [
  ['find', '① find'],
  ['analysis', '② analysis'],
  ['product', '③ product'],
  ['content', '④ content · node graph'],
]

const fmt = (n) => (n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact' }).format(n))

// POST helper that surfaces the server's { error } message (not just the status code)
async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const txt = await r.text()
  let data = {}; try { data = txt ? JSON.parse(txt) : {} } catch { /* non-json */ }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`)
  return data
}
async function getJSON(url) {
  const r = await fetch(url)
  const txt = await r.text()
  let data = {}; try { data = txt ? JSON.parse(txt) : {} } catch { /* non-json */ }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`)
  return data
}
function parseAnalysis(a) { try { return a ? (typeof a === 'string' ? JSON.parse(a) : a) : {} } catch { return {} } }

const DEFAULT_PRESETS = {
  amazon_finds: ['amazonfinds', 'amazonmusthaves', 'tiktokmademebuyit', 'founditonamazon', 'amazonfavorites', 'amazongadgets'],
  kbeauty: ['kbeauty', 'koreanskincare', 'glassskin', 'kbeautyfinds', 'koreanbeauty', 'skincareroutine'],
  home_daily: ['amazonhome', 'homefinds', 'homeorganization', 'kitchenfinds', 'cleantok', 'homehacks'],
}

export default function App() {
  const [stage, setStage] = useState('find')
  const [analysisId, setAnalysisId] = useState(null)
  const [contentId, setContentId] = useState(null)
  const [err, setErr] = useState(null)

  // ②→③ bridge: an analysis becomes a CONTENT (POST /api/contents {analysisId}), then ③ sets its product.
  async function goProduct(aid) {
    setErr(null)
    try { const c = await postJSON('/api/contents', { analysisId: aid }); setContentId(c.id || c.content?.id); setStage('product') }
    catch (e) { setErr(String(e.message || e)); setStage('product') }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">◆ shorts pipeline</div>
        <nav className="stages">
          {STAGES.map(([k, l]) => (
            <button key={k} className={'stage' + (stage === k ? ' on' : '')} onClick={() => setStage(k)}>{l}</button>
          ))}
        </nav>
      </header>
      <main className="body">
        {stage === 'find' && <FindStage onPick={(aid) => { setAnalysisId(aid); setStage('analysis') }} />}
        {stage === 'analysis' && <AnalysisStage analysisId={analysisId} onToProduct={goProduct} />}
        {stage === 'product' && <ProductStage contentId={contentId} err={err} onToContent={() => setStage('content')} />}
        {stage === 'content' && <Stub title="④ content · node graph" note={contentId ? `content #${contentId} — port node-studio.html node graph here (next)` : 'port node-studio.html node graph here (next)'} />}
      </main>
    </div>
  )
}

// ① FIND — reuses the working backend (POST /api/collect, GET /api/reels/latest,
// POST /api/reels/:id/analysis). Deterministic IG collect; agentify is a later phase.
function FindStage({ onPick }) {
  const [presets, setPresets] = useState(DEFAULT_PRESETS)
  const [tagText, setTagText] = useState(DEFAULT_PRESETS.amazon_finds.join(', '))
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [reels, setReels] = useState([])
  const [picking, setPicking] = useState(null)

  const loadLatest = () =>
    fetch('/api/reels/latest').then((r) => r.json()).then((d) => { setSnapshot(d.snapshot); setReels(d.reels || []) }).catch(() => {})

  useEffect(() => {
    fetch('/api/presets').then((r) => r.json()).then((p) => { if (p && Object.keys(p).length) setPresets(p) }).catch(() => {})
    loadLatest()
  }, [])

  const tags = tagText.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)

  async function runCollect() {
    setErr(null); setLoading(true)
    try {
      await postJSON('/api/collect', { tags, region: 'us', network: 'amazon' })
      loadLatest()
    } catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }

  async function pick(m) {
    setPicking(m.id)
    try {
      const a = await postJSON(`/api/reels/${m.id}/analysis`, {})
      onPick(a.id)
    } catch (e) { setErr(String(e.message || e)) } finally { setPicking(null) }
  }

  return (
    <div className="page">
      <div className="presets">
        {Object.keys(presets).map((k) => (
          <button key={k} className="ghost" onClick={() => setTagText(presets[k].join(', '))}>{k}</button>
        ))}
      </div>
      <div className="searchrow">
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="amazonfinds, amazonhome, ..." />
        <button className="primary" disabled={loading || !tags.length} onClick={runCollect}>{loading ? 'collecting…' : '＋ collect'}</button>
      </div>
      <p className="hint">ⓘ Before collecting, run <code>./scripts/launch-chrome.sh</code> and log into instagram.com in that window.</p>
      {err && <div className="errbox">{err}</div>}

      <div className="rankhead">reels <b>{reels.length}</b>{snapshot && <span className="muted"> · snapshot #{snapshot.id}</span>}</div>
      <div className="rgrid">
        {reels.map((m, i) => (
          <div key={m.id} className={'rcard' + (picking === m.id ? ' busy' : '')} onClick={() => picking || pick(m)} title="click → create analysis">
            <div className="rthumb">
              {m.thumbnail
                ? <img src={m.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                : <div className="noimg">—</div>}
              <span className="rrank">#{i + 1}</span>
            </div>
            <div className="rinfo">
              <div className="rmet"><span className="c">💬 {fmt(m.comments)}</span><span className="muted">▶ {fmt(m.play)}</span></div>
              <div className="ruser">@{m.username}</div>
              <div className="rcap">{m.caption}</div>
            </div>
          </div>
        ))}
        {!reels.length && <div className="muted pad">No reels yet — run collect above.</div>}
      </div>
    </div>
  )
}

// ② ANALYSIS — RESEARCH view over existing endpoints (GET /api/analyses/:id, POST .../analyze).
// Read-only facts: reel hook + structure/pace + scene-script reference. (Product pick is ③.)
function AnalysisStage({ analysisId, onToProduct }) {
  const [id, setId] = useState(analysisId)
  const [data, setData] = useState(null)
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [running, setRunning] = useState(false)

  useEffect(() => { setId(analysisId) }, [analysisId])
  useEffect(() => {
    setErr(null)
    if (id) { setData(null); getJSON(`/api/analyses/${id}`).then(setData).catch((e) => setErr(String(e.message || e))) }
    else { getJSON('/api/analyses').then(setList).catch(() => {}) }
  }, [id])

  // no analysis chosen → pick from the existing list
  if (!id) {
    return (
      <div className="page">
        <div className="rankhead">analyses <b>{list ? list.length : '…'}</b></div>
        <div className="alist">
          {(list || []).map((a) => (
            <button key={a.id} className="arow" onClick={() => setId(a.id)}>
              <span className={'sdot' + (a.analyzed_at ? ' ok' : '')} />
              <span className="au">@{a.reel_username}</span>
              <span className="ac">{(a.reel_caption || '').slice(0, 52)}</span>
              <span className="ast">{a.analyzed_at ? 'analyzed' : 'not analyzed'}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (err) return <div className="page"><button className="back" onClick={() => setId(null)}>← list</button><div className="errbox">{err}</div></div>
  if (!data) return <div className="page"><p className="muted pad">loading…</p></div>

  const A = parseAnalysis(data.analysis)
  const analyzed = !!data.analyzed_at && A.structure
  const hook = A.hook || {}, st = A.structure || {}, scenes = A.sceneScript || []

  async function runAnalyze() {
    setRunning(true); setErr(null)
    try { await postJSON(`/api/analyses/${id}/analyze`, {}); setData(await getJSON(`/api/analyses/${id}`)) }
    catch (e) { setErr(String(e.message || e)) } finally { setRunning(false) }
  }

  return (
    <div className="page">
      <button className="back" onClick={() => setId(null)}>← analyses</button>
      <div className="pickedbar">📼 <b>@{data.reel_username}</b> <span className="muted">— {(data.reel_caption || '').slice(0, 64)}</span>{data.reel_url && <a href={data.reel_url} target="_blank" rel="noreferrer"> reel ↗</a>}</div>

      {!analyzed && (
        <div className="stub">
          <p className="muted">Not analyzed yet — Claude-vision reads the reel's structure (tens of seconds, claude CLI).</p>
          <button className="primary" disabled={running} onClick={runAnalyze}>{running ? 'analyzing…' : '🔬 run analysis'}</button>
        </div>
      )}

      {analyzed && (
        <>
          <h2>hook</h2>
          <div className="card"><div className="kv2">
            <div className="k">family</div><div className="v"><span className="pillt">{hook.family || '—'}</span></div>
            <div className="k">opening</div><div className="v">"{hook.openingLine || '—'}"</div>
            <div className="k">why</div><div className="v">{hook.why || '—'}</div>
          </div></div>

          <h2>structure</h2>
          <div className="card"><div className="kv2">
            <div className="k">format</div><div className="v">{st.format || '—'}</div>
            <div className="k">pacing</div><div className="v">{st.pacing || '—'}</div>
            <div className="k">cta</div><div className="v">{st.cta || '—'}</div>
            <div className="k">beats</div><div className="v">{(st.beats || []).map((b, i) => <div key={i} className="beat">{i + 1}. {b}</div>)}</div>
          </div></div>

          <h2>scene script — reference (structure · pace · VO)</h2>
          <table className="stab"><thead><tr><th>t</th><th>on-screen</th><th>VO</th><th>shot</th></tr></thead>
            <tbody>{scenes.map((s, i) => (
              <tr key={i}><td className="tc">{s.t}</td><td>{s.onScreenText}</td><td>{s.vo}</td><td className="muted">{s.shot}</td></tr>
            ))}</tbody></table>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <button className="primary" onClick={() => onToProduct(id)}>③ product →</button>
      </div>
    </div>
  )
}

// ③ PRODUCT — confirm the Amazon product for the content (POST /api/contents/:id/product,
// GET /api/amazon/search, POST /api/contents/:id/suggest). Reuses existing endpoints.
function ProductStage({ contentId, err: initErr, onToContent }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(initErr || null)
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = () => getJSON(`/api/contents/${contentId}`).then(setData).catch((e) => setErr(String(e.message || e)))
  useEffect(() => { if (contentId) reload() }, [contentId])

  if (!contentId) return <div className="page">{err && <div className="errbox">{err}</div>}<p className="muted pad">Come from Analysis (②).</p></div>
  if (!data) return <div className="page">{err && <div className="errbox">{err}</div>}<p className="muted pad">loading…</p></div>

  const c = data.content || data
  let product = data.product || null
  if (!product && c.product) { try { product = typeof c.product === 'string' ? JSON.parse(c.product) : c.product } catch { product = null } }

  async function search() {
    setBusy(true); setErr(null); setItems(null)
    try { const d = await getJSON('/api/amazon/search?q=' + encodeURIComponent(q || c.title || '')); setItems(d.items || []) }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  async function choose(it) {
    setBusy(true); setErr(null)
    try { await postJSON(`/api/contents/${contentId}/product`, { asin: it.asin, title: it.title, price: it.price, rating: it.rating, reviewCount: it.reviewCount, image: it.image }); setItems(null); await reload() }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  async function suggest() {
    setBusy(true); setErr(null)
    try { const r = await postJSON(`/api/contents/${contentId}/suggest`, {}); if (r.product) await postJSON(`/api/contents/${contentId}/product`, { setProduct: r.product }); await reload() }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      {err && <div className="errbox">{err}</div>}

      <h2>matched product {busy && <span className="muted">· …</span>}</h2>
      {product ? (
        <div className="pcard big">
          {product.image ? <img src={product.image} alt="" /> : <div className="pnoimg" />}
          <div>
            <div className="pc-t">{product.title}</div>
            {product.price && <div className="pc-p">{product.price}</div>}
            {product.rating && <div className="pc-b">★ {product.rating} · {product.reviewCount || 0} reviews</div>}
            {product.asin && <a className="plink" href={'https://www.amazon.com/dp/' + product.asin} target="_blank" rel="noreferrer">Amazon ↗</a>}
          </div>
        </div>
      ) : <div className="stub"><p className="muted">No product yet — suggest or search to set one.</p></div>}

      <h2>set / change product</h2>
      <div className="searchrow">
        <button className="ghost" disabled={busy} onClick={suggest}>💡 suggest</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.title || 'search products'} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="primary" disabled={busy} onClick={search}>🔍 Amazon search</button>
      </div>
      {items && (
        <div className="candrow" style={{ marginTop: 14 }}>
          {items.map((it, i) => (
            <div key={i} className="pcard pick" onClick={() => !busy && choose(it)}>
              {it.image ? <img src={it.image} alt="" /> : <div className="pnoimg" />}
              <div><div className="pc-t">{it.title}</div>{it.price && <div className="pc-p">{it.price}</div>}<div className="pc-b">★ {it.rating || '—'}</div></div>
            </div>
          ))}
          {!items.length && <div className="muted pad">No results.</div>}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button className="primary" disabled={!product} onClick={onToContent}>④ content →</button>
      </div>
    </div>
  )
}

function Stub({ title, note }) {
  return <div className="page"><div className="stub"><h3>{title}</h3><p className="muted">{note}</p></div></div>
}
