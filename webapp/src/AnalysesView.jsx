import { useEffect, useState } from 'react'
import { fmt, api, postJSON } from './util.js'
import { useT } from './i18n.jsx'
import AnalysisPanel from './AnalysisPanel.jsx'

// ② 릴스 분석 — 재사용 가능한 구조 라이브러리. 릴스 🎯 로 생성됨.
export default function AnalysesView({ openId, onOpenHandled, goProducts }) {
  const { t } = useT()
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  const [menu, setMenu] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [reelUrl, setReelUrl] = useState('')
  const [prodUrl, setProdUrl] = useState('')
  const [creating, setCreating] = useState(false)

  const load = () => api('/api/analyses').then(setList).catch((e) => setErr(String(e.message || e)))
  useEffect(() => { load() }, [])
  function show(id) { api(`/api/analyses/${id}`).then(setOpen).catch((e) => setErr(String(e.message || e))) }
  useEffect(() => { if (openId) { show(openId); onOpenHandled?.() } }, [openId])

  async function createFromUrl() {
    if (!reelUrl.trim()) return
    setCreating(true); setErr(null)
    try {
      const a = await postJSON('/api/analyses/from-url', { reelUrl: reelUrl.trim(), productUrl: prodUrl.trim() || undefined })
      setReelUrl(''); setProdUrl(''); setShowAdd(false); await load(); show(a.id)
    } catch (e) { setErr(String(e.message || e)) } finally { setCreating(false) }
  }
  async function del(a) {
    if (!confirm(`"${a.title}" — ${t('삭제')}?`)) { setMenu(null); return }
    try { await api(`/api/analyses/${a.id}`, { method: 'DELETE' }) } catch (e) { setErr(String(e.message || e)) }
    setMenu(null); if (open?.id === a.id) setOpen(null); load()
  }

  if (err) return <div className="errbox statusbox">{err}</div>
  if (!list) return <div className="muted" style={{ padding: 24 }}>{t('불러오는 중…')}</div>

  return (
    <>
      <div className="hrow" style={{ margin: '2px 2px 12px' }}>
        <b>{t('릴스 분석')} {list.length}</b>
        <span className="muted" style={{ fontSize: 11 }}>{t('좌클릭 열기 · 우클릭 메뉴(삭제)')}</span>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => setShowAdd((s) => !s)}>＋ {t('직접 추가 (URL)')}</button>
      </div>
      {showAdd && (
        <div className="vbox prodpick" style={{ marginBottom: 12, borderColor: 'var(--gold)' }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>{t('발굴 없이 릴스를 직접 가져와 리믹스. 릴스 URL 필수 · 제품 링크(아마존)는 선택 — 비우면 분석이 비전으로 매칭.')}</div>
          <label className="fld"><span>{t('릴스 URL')}</span><input value={reelUrl} onChange={(e) => setReelUrl(e.target.value)} placeholder="https://www.instagram.com/reel/XXXXXXX/" onKeyDown={(e) => e.key === 'Enter' && createFromUrl()} /></label>
          <label className="fld" style={{ marginTop: 6 }}><span>{t('제품 링크 (선택)')}</span><input value={prodUrl} onChange={(e) => setProdUrl(e.target.value)} placeholder={t('아마존 URL/ASIN (지금) · TikTok Shop·올리브영·쿠팡 등은 추후')} onKeyDown={(e) => e.key === 'Enter' && createFromUrl()} /></label>
          <div className="hrow" style={{ marginTop: 8 }}>
            <span style={{ flex: 1 }} />
            <button className="ghost" onClick={() => setShowAdd(false)}>{t('취소')}</button>
            <button className="primary" onClick={createFromUrl} disabled={creating || !reelUrl.trim()}>{creating ? t('생성 중…') : t('＋ 분석 만들기')}</button>
          </div>
        </div>
      )}
      {!list.length && (
        <div className="statusbox"><h3>{t('분석 없음')}</h3>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{t('① 발굴에서 릴스 썸네일을 클릭(🎯)하거나, 위 [직접 추가 (URL)]로 릴스를 직접 가져오세요.')}</p>
        </div>
      )}
      <div className="pgrid">
        {list.map((a) => (
          <div key={a.id} className="pcard" onClick={() => show(a.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, a }) }}>
            <div className="pbody">
              {a.reel_thumbnail && <img className="pthumb" src={a.reel_thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pname">{a.title}</div>
                <div className="pmet"><span className="muted">@{a.reel_username} · 💬{fmt(a.reel_comments)}</span></div>
                <div className="pmet" style={{ marginTop: 4 }}>
                  <span className="badge" style={{ color: a.analysis ? 'var(--green)' : 'var(--mut)' }}>{a.analysis ? t('분석 완료') : t('분석 전')}</span>
                  {a.category && <span className="pcat">{a.category}</span>}
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
            <button onClick={() => { show(menu.a.id); setMenu(null) }}>{t('열기 / 편집')}</button>
            <button className="danger" onClick={() => del(menu.a)}>{t('삭제')}</button>
          </div>
        </>
      )}

      {open && <AnalysisDetail a={open} onClose={() => setOpen(null)} onChange={() => { show(open.id); load() }} goProducts={goProducts} />}
    </>
  )
}

function AnalysisDetail({ a, onClose, onChange, goProducts }) {
  const { t } = useT()
  const [title, setTitle] = useState(a.title || '')
  const [busy, setBusy] = useState(false)

  async function saveTitle() {
    if (title === a.title) return
    setBusy(true)
    try { await postJSON(`/api/analyses/${a.id}`, { title }); onChange?.() } finally { setBusy(false) }
  }
  // 제품 선택 → : 분석으로 콘텐츠(카드)를 만들고 ③ 제품 선택으로 이동
  async function makeContent() {
    setBusy(true)
    try { const c = await postJSON('/api/contents', { analysisId: a.id }); goProducts?.(c.id) }
    finally { setBusy(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="hrow">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} style={{ flex: 1, fontSize: 15, fontWeight: 600 }} />
          <button className="primary" onClick={makeContent} disabled={busy || !a.analysis} title={a.analysis ? '' : t('먼저 영상 분석을 실행하세요.')}>{t('제품 선택 →')}</button>
          <button className="ghost" onClick={onClose}>{t('닫기')}</button>
        </div>
        <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>📌 @{a.reel_username} · 💬{fmt(a.reel_comments)} · ▶{fmt(a.reel_play)}</div>

        <div className="refrow">
          {a.reel_thumbnail && <img className="refimg" src={a.reel_thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
          <div className="refinfo">
            <div style={{ fontSize: 11, color: 'var(--gold)' }}>{t('📌 분석 대상 릴스 (씬 분석·구조 템플릿)')}</div>
            <div className="refcap">{a.reel_caption}</div>
            <a className="open" href={a.reel_url} target="_blank" rel="noopener">{t('릴스 열어 영상 확인 ↗')}</a>
          </div>
        </div>

        <AnalysisPanel data={a} runUrl={`/api/analyses/${a.id}/analyze`} onUpdated={onChange} />
      </div>
    </div>
  )
}
