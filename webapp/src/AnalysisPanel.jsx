import { useState } from 'react'
import { postJSON } from './util.js'
import { useT } from './i18n.jsx'
import Dots from './Dots.jsx'

// 분석 결과 표시 + 실행. data.analysis(JSON) 을 읽고, runUrl 로 영상분석 실행.
export default function AnalysisPanel({ data, runUrl, onUpdated, readOnly }) {
  const { t } = useT()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  let a = null
  try { a = data?.analysis ? JSON.parse(data.analysis) : null } catch { a = null }

  async function run() {
    setLoading(true); setErr(null)
    try { await postJSON(runUrl, {}); onUpdated?.() }
    catch (e) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }

  return (
    <div className="vbox" style={{ marginTop: 14 }}>
      <div className="hrow">
        <h3 style={{ margin: 0, color: 'var(--gold)' }}>{t('🎬 릴스 분석')} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{t('구조·훅·씬 스크립트')}</span></h3>
        <span style={{ flex: 1 }} />
        {!readOnly && (
          <button className="ghost" onClick={run} disabled={loading}>
            {loading ? <Dots label={t('영상 다운로드→프레임→비전 분석 중 (~1분)')} /> : a ? t('🔄 재분석') : t('▶ 영상 분석 실행')}
          </button>
        )}
      </div>
      {!readOnly && <p className="muted hint" style={{ margin: '6px 2px' }}>{t('ⓘ 디버그 크롬이 떠 있어야 영상을 받습니다. 릴스 영상→키프레임→Claude 비전으로 분석.')}</p>}
      {err && <div className="errbox statusbox" style={{ marginTop: 6 }}>{err}</div>}
      {loading && <div className="muted" style={{ padding: 14 }}><Dots label={t('영상 다운로드→프레임→비전 분석 중 (~1분)')} /></div>}

      {a && !loading && (
        <div className="analysis">
          {a.hook && (
            <div className="ablk">
              <h4>{t('훅')} · {a.hook.family}</h4>
              <div className="hookline">“{a.hook.openingLine}”</div>
              <div className="muted" style={{ fontSize: 12 }}>{a.hook.why}</div>
              {a.hook.scrollStopper && <div className="ainfo"><span className="k">Scroll stopper</span><span className="v">{a.hook.scrollStopper}</span></div>}
              {a.hook.emotionalTrigger && <div className="ainfo"><span className="k">Emotional trigger</span><span className="v">{a.hook.emotionalTrigger}</span></div>}
            </div>
          )}
          {a.audience && (a.audience.who || a.audience.painPoint || a.audience.objection) && (
            <div className="ablk">
              <h4>Target viewer</h4>
              {a.audience.who && <div className="ainfo"><span className="k">Who</span><span className="v">{a.audience.who}</span></div>}
              {a.audience.painPoint && <div className="ainfo"><span className="k">Pain point</span><span className="v">{a.audience.painPoint}</span></div>}
              {a.audience.objection && <div className="ainfo"><span className="k">Objection</span><span className="v">{a.audience.objection}</span></div>}
            </div>
          )}
          {a.structure && (
            <div className="ablk">
              <h4>{t('구조')} · {a.structure.format}</h4>
              <ol className="beats">{(a.structure.beats || []).map((b, i) => <li key={i}>{b}</li>)}</ol>
              {a.structure.pacing && <div className="ainfo"><span className="k">Pacing</span><span className="v">{a.structure.pacing}</span></div>}
              {a.structure.turningPoint && <div className="ainfo"><span className="k">Turning point</span><span className="v">{a.structure.turningPoint}</span></div>}
              {a.structure.productIntegration && <div className="ainfo"><span className="k">Product entry</span><span className="v">{a.structure.productIntegration}</span></div>}
              {a.structure.cta && <div className="ainfo"><span className="k">CTA</span><span className="v">{a.structure.cta}</span></div>}
              {a.structure.whyItConverts && <div className="ainfo"><span className="k">Why it converts</span><span className="v">{a.structure.whyItConverts}</span></div>}
            </div>
          )}
          {a.visualStyle && (a.visualStyle.lookFeel || a.visualStyle.lighting || a.visualStyle.palette || a.visualStyle.textStyle || a.visualStyle.editing) && (
            <div className="ablk">
              <h4>Visual style</h4>
              {a.visualStyle.lookFeel && <div className="ainfo"><span className="k">Look &amp; feel</span><span className="v">{a.visualStyle.lookFeel}</span></div>}
              {a.visualStyle.lighting && <div className="ainfo"><span className="k">Lighting</span><span className="v">{a.visualStyle.lighting}</span></div>}
              {a.visualStyle.palette && <div className="ainfo"><span className="k">Palette</span><span className="v">{a.visualStyle.palette}</span></div>}
              {a.visualStyle.textStyle && <div className="ainfo"><span className="k">Text style</span><span className="v">{a.visualStyle.textStyle}</span></div>}
              {a.visualStyle.editing && <div className="ainfo"><span className="k">Editing</span><span className="v">{a.visualStyle.editing}</span></div>}
            </div>
          )}
          {a.sceneScript?.length > 0 && (
            <div className="ablk">
              <h4>{t('씬별 리메이크 스크립트')}</h4>
              <div className="scenes">
                {a.sceneScript.map((s, i) => (
                  <div key={i} className="scene">
                    <span className="st">{s.t}</span>
                    <div className="sbody">
                      <div className="sshot">{s.shot}</div>
                      {s.onScreenText && <div className="stext">{t('자막')}: {s.onScreenText}</div>}
                      {s.vo && <div className="svo">VO: {s.vo}</div>}
                      {(s.purpose || s.emotion) && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{[s.purpose, s.emotion].filter(Boolean).join(' · ')}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {a.viralFactors?.length > 0 && (
            <div className="ablk">
              <h4>Viral factors</h4>
              <ol className="beats">{a.viralFactors.map((f, i) => <li key={i}>{f}</li>)}</ol>
            </div>
          )}
          {a.assets?.length > 0 && (
            <div className="ablk">
              <h4>{t('씬 에셋 리스트')} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{t('(④소싱/⑤조립 연결)')}</span></h4>
              <div className="assets">
                {a.assets.map((s, i) => (
                  <div key={i} className="asset">
                    <span className={'atag ' + (s.type === 'footage' ? 'af' : s.type === 'image' ? 'ai' : 'ag')}>{s.type}</span>
                    <span>#{s.scene} {s.need}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {a._meta && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('영상')} {Math.round(a._meta.duration)}{t('초')} · {t('프레임')} {a._meta.frameCount}{t('장 분석')}</div>}
        </div>
      )}
    </div>
  )
}
