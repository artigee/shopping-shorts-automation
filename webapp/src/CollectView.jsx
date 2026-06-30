import { useEffect, useMemo, useState } from 'react'
import { FUNNEL, isCombo, isNoise, fmt, api, postJSON } from './util.js'
import { useT } from './i18n.jsx'
import Dots from './Dots.jsx'

export default function CollectView({ onChange, goAnalyses }) {
  const { t } = useT()
  const DEFAULT_PRESETS = {
    amazon_finds: ['amazonfinds', 'amazonmusthaves', 'tiktokmademebuyit', 'founditonamazon', 'amazonfavorites', 'amazongadgets'],
    kbeauty: ['kbeauty', 'koreanskincare', 'glassskin', 'kbeautyfinds', 'koreanbeauty', 'skincareroutine'],
    home_daily: ['amazonhome', 'homefinds', 'homeorganization', 'kitchenfinds', 'cleantok', 'homehacks'],
    fashion: ['amazonfashion', 'amazonfashionfinds', 'amazonstyle', 'summerfashion', 'outfitinspo'],
    gadgets: ['amazongadgets', 'coolgadgets', 'tiktokmademebuyit', 'gadgetlover', 'techfinds'],
  }
  const [presets, setPresets] = useState(DEFAULT_PRESETS)
  const [tagText, setTagText] = useState(DEFAULT_PRESETS.amazon_finds.join(', '))
  const [region, setRegion] = useState('us')
  const [network, setNetwork] = useState('amazon')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [reels, setReels] = useState([])
  const [perTag, setPerTag] = useState(null)
  const [picking, setPicking] = useState(null) // 분석 생성 중인 릴스 id

  async function toAnalysis(m) {
    setPicking(m.id)
    try { const a = await postJSON(`/api/reels/${m.id}/analysis`, {}); onChange?.(); goAnalyses?.(a.id) }
    catch (e) { setErr(String(e.message || e)) } finally { setPicking(null) }
  }
  const [funnelOnly, setFunnelOnly] = useState(false)
  const [kind, setKind] = useState('all')
  const [minComments, setMinComments] = useState(0)
  const [hideNoise, setHideNoise] = useState(true)
  const [hidePaid, setHidePaid] = useState(false)

  function loadLatest() {
    api('/api/reels/latest').then((d) => { setSnapshot(d.snapshot); setReels(d.reels || []) }).catch(() => {})
  }
  useEffect(() => {
    fetch('/api/presets').then((r) => r.json())
      .then((p) => { if (p && Object.keys(p).length) setPresets(p) }).catch(() => {})
    loadLatest()
  }, [])

  const tags = tagText.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)

  async function runCollect() {
    setErr(null); setLoading(true); setPerTag(null)
    try {
      const data = await postJSON('/api/collect', { tags, region, network })
      setPerTag(data.perTag); loadLatest(); onChange?.()
    } catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }

  const presetLabel = (k) => ({ amazon_finds: '아마존 파인즈', kbeauty: 'K-뷰티', home_daily: '홈·일상용품', fashion: '패션', gadgets: '가전·가젯' }[k] || k)
  const maxComments = useMemo(() => reels.reduce((mx, r) => Math.max(mx, r.comments || 0), 0), [reels])
  const filtered = useMemo(() => reels.filter((m) => {
    const cap = m.caption || ''
    if (funnelOnly && !FUNNEL.test(cap)) return false
    if (kind === 'combo' && !isCombo(cap)) return false
    if (kind === 'single' && isCombo(cap)) return false
    if ((m.comments || 0) < minComments) return false
    if (hideNoise && isNoise(cap)) return false
    if (hidePaid && m.is_paid) return false
    return true
  }), [reels, funnelOnly, kind, minComments, hideNoise, hidePaid])

  return (
    <>
      <div className="hrow" style={{ marginBottom: 14 }}>
        <span className="pill">{t('네트워크')}</span>
        <select value={network} onChange={(e) => setNetwork(e.target.value)}><option value="amazon">Amazon Associates</option></select>
        <span className="pill">{t('지역')}</span>
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="us">{t('US / 영어권')}</option><option value="kr">{t('한국')}</option>
        </select>
      </div>

      <div className="statusbox">
        <h3>{t('해시태그 수집')}</h3>
        <div className="presets">
          {Object.keys(presets).map((k) => (
            <button key={k} className="ghost" onClick={() => setTagText(presets[k].join(', '))}>{t(presetLabel(k))}</button>
          ))}
        </div>
        <textarea className="tags-in" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="amazonfinds, amazonhome, ..." />
        <div className="hrow" style={{ marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>{tags.length}{t('개 해시태그')}</span>
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={loading || !tags.length} onClick={runCollect}>
            {loading ? <Dots label={t('수집')} /> : t('＋ 수집 실행')}
          </button>
        </div>
      </div>

      <p className="muted hint">{t('ⓘ 수집 전')} <code>./scripts/launch-chrome.sh</code> {t('로 디버그 크롬을 띄우고 그 창에서 instagram.com 로그인 상태여야 합니다.')}</p>

      {err && (
        <div className="statusbox errbox">
          <div><span className="dot bad" /><b>{t('수집 실패')}</b></div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>{err}</div>
        </div>
      )}

      <div className="hrow" style={{ margin: '18px 2px 8px' }}>
        <b>{t('릴스 랭킹')} {filtered.length}<span className="muted" style={{ fontWeight: 400 }}>/{reels.length}</span></b>
        {snapshot && <span className="muted" style={{ fontSize: 12 }}>{t('스냅샷')} #{snapshot.id}</span>}
        <span style={{ flex: 1 }} />
        {perTag && perTag.map((tg) => (
          <span key={tg.tag} className={'pill ' + (tg.ok ? '' : 'bad-pill')}>#{tg.tag} {tg.ok ? tg.count : '✘' + tg.status}</span>
        ))}
      </div>

      <div className="filterbar">
        <label className="chk"><input type="checkbox" checked={funnelOnly} onChange={(e) => setFunnelOnly(e.target.checked)} /> {t('펀널만')}</label>
        <span className="seg">
          {[['all', '전체'], ['single', '단일'], ['combo', '모음']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t(l)}</button>
          ))}
        </span>
        <label className="chk"><input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} /> {t('노이즈 제외')}</label>
        <label className="chk"><input type="checkbox" checked={hidePaid} onChange={(e) => setHidePaid(e.target.checked)} /> {t('유료 제외')}</label>
        <span className="slider">{t('최소')} 💬 {fmt(minComments)}
          <input type="range" min="0" max={maxComments} value={minComments} onChange={(e) => setMinComments(+e.target.value)} />
        </span>
      </div>
      <p className="muted hint" style={{ marginTop: 6 }}>{t('썸네일 클릭 → 릴스 분석 자산 생성(②). (썸네일은 새로 수집한 릴스부터 표시)')}</p>

      <div className="rgrid">
        {filtered.map((m, i) => {
          const funnel = FUNNEL.test(m.caption || '')
          const combo = isCombo(m.caption || '')
          return (
            <div key={m.id} className={'rcard' + (picking === m.id ? ' busy' : '')} onClick={() => picking || toAnalysis(m)} title={t('썸네일 클릭 → 릴스 분석 자산 생성(②). (썸네일은 새로 수집한 릴스부터 표시)')}>
              <div className="rthumb">
                {m.thumbnail
                  ? <img src={m.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                  : <div className="noimg">{t('썸네일')}<br /><span>(—)</span></div>}
                <span className="rrank">#{i + 1}</span>
                <span className="rscore">{fmt(Math.round(m.score))}</span>
                <div className="rbadges">
                  {funnel && <span className="badge funnel">{t('펀널')}</span>}
                  {combo ? <span className="badge combo">{t('모음')}</span> : <span className="badge single">{t('단일')}</span>}
                  {m.is_paid ? <span className="badge paid">{t('AD')}</span> : null}
                </div>
              </div>
              <div className="rinfo">
                <div className="rmet"><span className="c-comments">💬 {fmt(m.comments)}</span><span className="muted">▶ {fmt(m.play)}</span></div>
                <div className="ruser">@{m.username}</div>
                <div className="rcap">{m.caption}</div>
              </div>
            </div>
          )
        })}
        {!filtered.length && <div className="muted" style={{ padding: 16, gridColumn: '1/-1' }}>{reels.length ? t('필터에 걸리는 릴스 없음 — 필터를 풀어보세요.') : t('아직 수집된 릴스 없음 — 위에서 수집을 실행하세요.')}</div>}
      </div>
    </>
  )
}
