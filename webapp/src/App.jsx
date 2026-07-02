import { useEffect, useState, useCallback } from 'react'
import CollectView from './CollectView.jsx'
import AnalysesView from './AnalysesView.jsx'
import ProductSelectView from './ProductSelectView.jsx'
import ContentsView from './ContentsView.jsx'
import NodeGraphView from './NodeGraphView.jsx'
import { useT } from './i18n.jsx'

export default function App() {
  const { t, lang, setLang } = useT()
  const [tab, setTab] = useState('collect')
  const [health, setHealth] = useState(null)
  const [analysisOpenId, setAnalysisOpenId] = useState(null)
  const [productOpenId, setProductOpenId] = useState(null)
  const [contentOpenId, setContentOpenId] = useState(null)

  const [genLang, setGenLang] = useState('')   // 글로벌 생성 언어/지역
  const refreshHealth = useCallback(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {})
  }, [])
  useEffect(() => { refreshHealth(); fetch('/api/gen-lang').then((r) => r.json()).then((d) => setGenLang(d.lang)).catch(() => {}) }, [refreshHealth])
  function changeGenLang(v) { setGenLang(v); fetch('/api/gen-lang', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: v }) }).catch(() => {}) }
  const GEN_LANGS = [
    ['English (US, American audience)', '🇺🇸 English (US)'],
    ['Korean (한국어, Korean audience)', '🇰🇷 한국어'],
    ['Japanese (日本語, Japanese audience)', '🇯🇵 日本語'],
    ['Spanish (Español, US Hispanic audience)', '🇪🇸 Español'],
  ]

  const goAnalyses = (id) => { setAnalysisOpenId(id || null); setTab('analyses') }
  const goProducts = (id) => { setProductOpenId(id || null); setTab('products') }
  const goContents = (id) => { setContentOpenId(id || null); setTab('contents') }

  return (
    <>
      <header>
        <div className="hrow" style={{ marginTop: 0 }}>
          <h1>🛰️ {t('발굴 콕핏')} <small>{t('발굴 + 아마존 게이트')}</small></h1>
          <span style={{ flex: 1 }} />
          <label className="muted" style={{ fontSize: 11, marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }} title={t('분석·스크립트·VO가 모두 이 언어/지역으로 생성됩니다 (번역 X)')}>🌐 {t('생성 언어')}
            <select value={genLang} onChange={(e) => changeGenLang(e.target.value)}>
              {!GEN_LANGS.some(([v]) => v === genLang) && genLang && <option value={genLang}>{genLang}</option>}
              {GEN_LANGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <button className="tab" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} title={t('앱 라벨 언어 (콘텐츠 생성 언어와 별개)')}>{lang === 'ko' ? 'EN' : '한국어'}</button>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            {health && <><span className="dot ok" />{t('릴스')} {health.db.reels} · {t('스냅샷')} {health.db.snapshots}</>}
          </span>
        </div>
        <div className="tabs">
          <button className={tab === 'collect' ? 'tab on' : 'tab'} onClick={() => setTab('collect')}>{t('① 발굴')}</button>
          <button className={tab === 'analyses' ? 'tab on' : 'tab'} onClick={() => setTab('analyses')}>{t('② 릴스 분석')}</button>
          <button className={tab === 'products' ? 'tab on' : 'tab'} onClick={() => setTab('products')}>{t('③ 제품 선택')}</button>
          <button className={tab === 'contents' ? 'tab on' : 'tab'} onClick={() => setTab('contents')}>{t('④ 콘텐츠 제작')}</button>
          <button className={tab === 'nodegraph' ? 'tab on' : 'tab'} onClick={() => setTab('nodegraph')}>⑤ 노드 그래프</button>
        </div>
      </header>

      <div className="wrap">
        {tab === 'collect' && <CollectView onChange={refreshHealth} goAnalyses={goAnalyses} />}
        {tab === 'analyses' && <AnalysesView openId={analysisOpenId} onOpenHandled={() => setAnalysisOpenId(null)} goProducts={goProducts} />}
        {tab === 'products' && <ProductSelectView openId={productOpenId} onOpenHandled={() => setProductOpenId(null)} goContents={goContents} />}
        {tab === 'contents' && <ContentsView openId={contentOpenId} onOpenHandled={() => setContentOpenId(null)} goProducts={goProducts} />}
        {tab === 'nodegraph' && <NodeGraphView />}
      </div>
    </>
  )
}
