import { useEffect, useState } from 'react'
import { fmt, api, postJSON } from './util.js'
import { useT } from './i18n.jsx'
import Dots from './Dots.jsx'

// ③ 제품 선택 — ② 분석에서 [제품 선택 →]으로 만든 카드들.
// 각 카드 = 원본 릴스 기준 아마존 검색 → 적용 제품 선택 → ④ 콘텐츠 제작.
export default function ProductSelectView({ openId, onOpenHandled, goContents }) {
  const { t } = useT()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  const [menu, setMenu] = useState(null)

  const load = () => api('/api/contents').then(setList).catch((e) => setErr(String(e.message || e)))
  useEffect(() => { load() }, [])
  function show(id) { api(`/api/contents/${id}`).then(setOpen).catch((e) => setErr(String(e.message || e))) }
  useEffect(() => { if (openId) { show(openId); onOpenHandled?.() } }, [openId])

  async function del(c) {
    if (!confirm(`"${c.title}" — ${t('삭제')}?`)) { setMenu(null); return }
    try { await api(`/api/contents/${c.id}`, { method: 'DELETE' }) } catch (e) { setErr(String(e.message || e)) }
    setMenu(null); if (open?.content?.id === c.id) setOpen(null); load()
  }

  if (err && !list) return <div className="errbox statusbox">{err}</div>
  if (!list) return <div className="muted" style={{ padding: 24 }}>{t('불러오는 중…')}</div>

  return (
    <>
      <div className="hrow" style={{ margin: '2px 2px 12px' }}>
        <b>{t('제품 선택 카드')} {list.length}</b>
        <span className="muted" style={{ fontSize: 11 }}>{t('좌클릭 열기 · 우클릭 메뉴(삭제)')}</span>
      </div>
      {!list.length && (
        <div className="statusbox"><h3>{t('카드 없음')}</h3>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{t('② 릴스 분석에서 [제품 선택 →]을 누르면 여기에 카드가 생깁니다.')}</p>
        </div>
      )}
      <div className="pgrid">
        {list.map((c) => (
          <div key={c.id} className="pcard" onClick={() => show(c.id)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, c }) }}>
            <div className="pbody">
              {(c.product_image || c.reel_thumbnail) && <img className="pthumb" src={c.product_image || c.reel_thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pname">{c.analysis_title || c.title}</div>
                <div className="pmet"><span className="muted">📌 @{c.reel_username || '—'}</span></div>
                <div className="pmet" style={{ marginTop: 4 }}>
                  {c.product_name
                    ? <span className="badge" style={{ color: 'var(--green)' }}>🛒 {c.product_name?.slice(0, 22)}</span>
                    : <span className="badge" style={{ color: 'var(--acc)' }}>{t('제품 미선택')}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {menu && (
        <>
          <div className="cmenu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="cmenu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => { show(menu.c.id); setMenu(null) }}>{t('열기 / 편집')}</button>
            <button className="danger" onClick={() => del(menu.c)}>{t('삭제')}</button>
          </div>
        </>
      )}

      {open && <ProductSelectDetail data={open} onClose={() => setOpen(null)} onChange={() => { show(open.content.id); load() }} goContents={goContents} />}
    </>
  )
}

function ProductSelectDetail({ data, onClose, onChange, goContents }) {
  const { t } = useT()
  const { content, analysis, product } = data
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [manual, setManual] = useState('')
  const [items, setItems] = useState(null)
  const [searching, setSearching] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [match, setMatch] = useState(null)   // ②에서 비전 매칭한 결과 메타 {asin,confidence,reason,query}
  const [origName, setOrigName] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  // 카드 열면 ②(Reel Analysis)에서 비전으로 매칭해둔 제품/후보를 그대로 사용 (재검색 X).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setSuggesting(true); setErr(null)
      try {
        const r = await postJSON(`/api/contents/${content.id}/suggest`, {})
        if (cancelled) return
        setMatch(r.match || null)
        setItems(r.candidates && r.candidates.length ? r.candidates : null)
        setQ((r.match && r.match.query) || '')
        if (!product) {
          if (r.product) { await postJSON(`/api/contents/${content.id}/product`, { setProduct: r.product }); onChange?.() }
          else if (r.candidates && r.candidates.length) { setShowSearch(true) }   // 정확 매칭 없음 → 후보에서 고르기
        }
      } catch (e) { if (!cancelled) setErr(String(e.message || e)) }
      finally { if (!cancelled) setSuggesting(false) }
    })()
    return () => { cancelled = true }
  }, [content.id])

  async function search(query) {
    const qq = (query ?? q).trim(); if (!qq) return
    setSearching(true); setErr(null); setItems(null)
    try { const d = await api('/api/amazon/search?q=' + encodeURIComponent(qq)); setItems(d.items) }
    catch (e) { setErr(String(e.message || e)) } finally { setSearching(false) }
  }
  async function fetchManual() {
    if (!manual.trim()) return
    setFetching(true); setErr(null)
    try { const d = await postJSON('/api/amazon/fetch', { input: manual }); if (d.warning) setErr(d.warning); await pick(d.item); setManual('') }
    catch (e) { setErr(String(e.message || e)) } finally { setFetching(false) }
  }
  // 후보 선택 = 원본 대신 이 아마존 제품을 콘텐츠 제품으로 확정 (링크 포함, 영어)
  async function pick(it) {
    setBusy(true); setErr(null)
    try { await postJSON(`/api/contents/${content.id}/product`, { asin: it.asin, title: it.title, price: it.price, rating: it.rating, reviewCount: it.reviewCount, image: it.image }); setItems(null); setShowSearch(false); onChange?.() }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }
  // 원본 제품으로 되돌리기
  async function revertOriginal() { setBusy(true); try { await postJSON(`/api/contents/${content.id}/product`, { original: true, title: origName || analysis?.title }); setShowSearch(false); onChange?.() } finally { setBusy(false) } }

  const isOriginal = product?.source === 'original'
  const needLink = !product?.amazon_url   // 링크 없음 = "링크 붙이기" 모드 (vs "교체")

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="hrow">
          <h3 style={{ margin: 0 }}>🛒 {t('제품 선택')}</h3>
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={!product} title={product ? '' : t('먼저 제품을 선택하세요.')} onClick={() => goContents?.(content.id)}>{t('④ Content Gen →')}</button>
          <button className="ghost" onClick={onClose}>{t('닫기')}</button>
        </div>

        {/* 원본 릴스 */}
        <div className="refrow" style={{ marginTop: 8 }}>
          {analysis?.reel_thumbnail && <img className="refimg" src={analysis.reel_thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
          <div className="refinfo">
            <div style={{ fontSize: 11, color: 'var(--gold)' }}>{t('📌 원본 릴스')}</div>
            <div className="refcap">{analysis?.reel_caption || analysis?.title}</div>
            {analysis?.reel_url && <a className="open" href={analysis.reel_url} target="_blank" rel="noopener">{t('릴스 열기 ↗')}</a>}
          </div>
        </div>

        <p className="muted hint" style={{ margin: '8px 2px' }}>{t('기본 = 릴스의 원본 제품. 아마존 검색은 다른 제품으로 바꾸고 싶을 때만(선택).')}</p>

        {/* ② Reel Analysis에서 비전으로 매칭한 제품 */}
        {suggesting && !product && <div className="muted" style={{ marginTop: 6 }}><Dots label={t('릴스 제품을 생김새로 매칭 중')} /></div>}
        {!suggesting && !product && match && (
          <div className="statusbox" style={{ marginTop: 6 }}>
            <b style={{ color: 'var(--gold)' }}>No exact match on Amazon</b>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{(match.reason || 'None of the Amazon results match the reel product design.') + ' — pick the closest below ↓'}</p>
          </div>
        )}
        {product && (
          <div className="amz" style={{ marginTop: 6, borderColor: 'var(--green)' }}>
            {product.image && <img className="amz-img" src={product.image} alt="" />}
            <div className="amz-info">
              <div className="amz-title">{isOriginal ? `📌 ${t('원본 제품')}` : '🛒'} {product.title || product.asin}</div>
              <div className="amz-met">
                {product.price && <span className="score">{product.price}</span>}
                {product.rating && <span className="muted">★ {product.rating}</span>}
                {product.amazon_url
                  ? <><span style={{ color: 'var(--green)', fontSize: 11 }}>✓ matched from reel (vision){product.match_confidence ? ` ${Math.round(product.match_confidence * 100)}%` : ''}</span> <a className="muted" href={product.amazon_url} target="_blank" rel="noopener">↗ {t('제휴 링크')}</a></>
                  : <span className="muted" style={{ color: 'var(--gold)' }}>pick an Amazon match below ↓</span>}
              </div>
            </div>
            <div className="vbox" style={{ gap: 4 }}>
              <button className="ghost" onClick={() => { setShowSearch((s) => !s); if (!items) search() }} disabled={busy}>{t('🔄 다른 제품으로 교체 (선택)')}</button>
            </div>
          </div>
        )}

        {/* 아마존 검색 (override, 펼쳤을 때만) */}
        {showSearch && (
          <div className="vbox prodpick" style={{ marginTop: 8 }}>
            <div className="hrow"><b style={{ fontSize: 12 }}>{needLink ? t('원본 + 관련 상품 — 하나 골라 콘텐츠 제품으로 (링크 포함)') : t('아마존에서 다른 제품으로 교체')}</b></div>
            <div className="hrow" style={{ marginTop: 6 }}>
              <input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('영어 검색어')} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <button className="primary" onClick={() => search()} disabled={searching || !q.trim()}>{searching ? <Dots label={t('검색')} /> : t('🔍 검색')}</button>
            </div>
            <div className="hrow" style={{ marginTop: 6 }}>
              <input style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t('또는 아마존 URL/ASIN 직접 입력')} onKeyDown={(e) => e.key === 'Enter' && fetchManual()} />
              <button className="ghost" onClick={fetchManual} disabled={fetching || !manual.trim()}>{fetching ? t('가져오는 중…') : t('＋ 가져오기')}</button>
            </div>
            {err && <div className="errbox statusbox" style={{ marginTop: 6 }}>{err}</div>}
            {items && (
              <div className="cands-amz" style={{ marginTop: 8 }}>
                {items.length === 0 && <div className="muted" style={{ padding: 10 }}>{t('검색 결과 없음 — 검색어를 바꿔보세요.')}</div>}
                {items.map((it) => (
                  <div key={it.asin} className="amz">
                    {it.image && <img className="amz-img" src={it.image} alt="" />}
                    <div className="amz-info">
                      <div className="amz-title">{it.title || t('(제목 못 가져옴 — ASIN만)')}</div>
                      <div className="amz-met">{it.price && <span className="score">{it.price}</span>}{it.rating && <span className="muted">★ {it.rating}</span>}<span className="muted">ASIN {it.asin}</span></div>
                    </div>
                    <button className="primary" disabled={busy} onClick={() => pick(it)}>{needLink ? t('이걸로') : t('이걸로 교체')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
