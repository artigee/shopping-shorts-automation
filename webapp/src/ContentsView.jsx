import { useEffect, useRef, useState } from 'react'

// 접기/펼치기 섹션 — 헤더 클릭 토글, 오른쪽 액션은 클릭 전파 차단
function Section({ title, sub, right, open, onToggle, gold, children }) {
  return (
    <div className="vbox prodpick" style={{ marginTop: 12, ...(gold ? { borderColor: 'var(--gold)' } : {}) }}>
      <div className="hrow" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onToggle}>
        <span style={{ color: 'var(--gold)', width: 14, fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        <h3 style={{ margin: 0, color: 'var(--gold)' }}>{title}</h3>
        {sub && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{sub}</span>}
        <span style={{ flex: 1 }} />
        {right && <div className="hrow" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>{right}</div>}
      </div>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}
import { api, postJSON, pollJob } from './util.js'
import { useT } from './i18n.jsx'
import Dots from './Dots.jsx'

// ④ 콘텐츠 제작 — ③에서 제품 선택을 마친 카드로 전체 스크립트 → 씬 스크립트 → (이미지/클립).
export default function ContentsView({ openId, onOpenHandled, goProducts }) {
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
        <b>{t('콘텐츠')} {list.length}</b>
        <span className="muted" style={{ fontSize: 11 }}>{t('좌클릭 열기 · 우클릭 메뉴(삭제)')}</span>
      </div>
      {!list.length && (
        <div className="statusbox"><h3>{t('콘텐츠 없음')}</h3>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{t('② 분석 → [제품 선택 →] → ③ 제품 선택 → [④ 콘텐츠 제작 →] 순서로 진행됩니다.')}</p>
        </div>
      )}
      <div className="pgrid">
        {list.map((c) => {
          let scenes = []; try { scenes = c.scenes ? JSON.parse(c.scenes) : [] } catch { scenes = [] }
          return (
            <div key={c.id} className="pcard" onClick={() => show(c.id)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, c }) }}>
              <div className="pbody">
                {(c.product_image || c.reel_thumbnail) && <img className="pthumb" src={c.product_image || c.reel_thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pname">{c.title}</div>
                  <div className="pmet"><span className="muted">🛒 {c.product_name || t('제품 미선택')}</span></div>
                  <div className="pmet" style={{ marginTop: 4 }}>
                    <span className="badge" style={{ color: scenes.length ? 'var(--green)' : 'var(--mut)' }}>{scenes.length ? `${t('씬')} ${scenes.length}` : t('스크립트 전')}</span>
                    <span className="pcat">{c.final_form === 'movie' ? t('풀무비') : t('카드형')}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
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

      {open && <ContentDetail data={open} onClose={() => setOpen(null)} onChange={() => { show(open.content.id); load() }} goProducts={goProducts} />}
    </>
  )
}

function ContentDetail({ data, onClose, onChange, goProducts }) {
  const { t } = useT()
  const { content, analysis, product } = data
  const [overall, setOverall] = useState(() => { try { return content.overall ? JSON.parse(content.overall) : null } catch { return null } })
  const [scenes, setScenes] = useState(() => { try { return content.scenes ? JSON.parse(content.scenes) : [] } catch { return [] } })
  const [form, setForm] = useState(content.final_form || 'card')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)
  const [hf, setHf] = useState(null)   // Higgsfield 키 설정 여부
  const [genIdx, setGenIdx] = useState(-1)
  const [ver, setVer] = useState(0)    // 미디어 캐시 버스터 (재생성 후 즉시 갱신)
  const bust = (u) => (u ? u + (u.includes('?') ? '&' : '?') + 'v=' + ver : u)
  const disp = (u) => (u && u.includes('|') ? u.split('|')[1] : u)   // 업로드 ref(hfmedia:id|url) → 표시용 url
  const [style, setStyle] = useState(content.style || '')   // 전 씬 공통 이미지 스타일

  const [direction, setDirection] = useState(content.direction || '')   // 연출 지시 (훅·샷)
  const [persona, setPersona] = useState(content.persona || '')          // VO 화자 페르소나 (playbook 키 or 자유텍스트)
  const [hook, setHook] = useState(content.hook || '')                   // 훅/스토리텔링 셰이프 (playbook 키)
  const [personaLib, setPersonaLib] = useState([])                       // shorts-playbook personas.yaml
  const [hookLib, setHookLib] = useState([])                             // shorts-playbook hooks.yaml
  const [moveLib, setMoveLib] = useState([])                             // shorts-playbook camera-moves.yaml

  useEffect(() => { api('/api/hf/status').then((s) => setHf(!!s.ready)).catch(() => setHf(false)) }, [])
  useEffect(() => {
    api('/api/personas').then((d) => setPersonaLib(d.personas || [])).catch(() => {})
    api('/api/hooks').then((d) => setHookLib(d.hooks || [])).catch(() => {})
    api('/api/camera-moves').then((d) => setMoveLib(d.moves || [])).catch(() => {})
  }, [])
  async function saveStyle() { if (style === (content.style || '')) return; try { await postJSON(`/api/contents/${content.id}/style`, { style }) } catch {} }
  async function saveDirection() { if (direction === (content.direction || '')) return; try { await postJSON(`/api/contents/${content.id}/direction`, { direction }) } catch {} }
  async function savePersona(v) { const nv = v ?? persona; setPersona(nv); if (nv === (content.persona || '')) return; try { await postJSON(`/api/contents/${content.id}/persona`, { persona: nv }) } catch {} }
  async function saveHook(v) { const nv = v ?? hook; setHook(nv); if (nv === (content.hook || '')) return; try { await postJSON(`/api/contents/${content.id}/hook`, { hook: nv }) } catch {} }
  // 추천 — 제품 + 릴스 분석 기반 persona + hook 제안
  const [rec, setRec] = useState(null)
  const [recBusy, setRecBusy] = useState(false)
  async function getRec() {
    setRecBusy(true); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/recommend`, {}); setRec(r) }
    catch (e) { setErr(String(e.message || e)) } finally { setRecBusy(false) }
  }
  function applyRec() { if (!rec) return; savePersona(rec.persona); saveHook(rec.hook) }
  const nameOf = (lib, key) => (lib.find((x) => x.key === key)?.name) || key
  // 섹션 접기/펼치기 상태 (기본 전부 펼침)
  const [open, setOpen] = useState({ setup: true, overall: true, scenes: true, images: true, clips: true, export: true })
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const [refUrl, setRefUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  async function addRef() {
    if (!refUrl.trim()) return
    try { await postJSON(`/api/contents/${content.id}/product-ref`, { url: refUrl.trim(), first: true }); setRefUrl(''); onChange?.() }
    catch (e) { setErr(String(e.message || e)) }
  }
  async function removeProductRef(u) {
    if (!confirm(t('이 레퍼런스를 삭제할까요?'))) return
    try { await postJSON(`/api/contents/${content.id}/product-ref`, { url: u, remove: true }); onChange?.() }
    catch (e) { setErr(String(e.message || e)) }
  }
  function uploadRef(file) {
    if (!file) return
    setUploading(true); setErr(null)
    const reader = new FileReader()
    reader.onload = async () => {
      try { await postJSON(`/api/contents/${content.id}/ref-upload`, { filename: file.name, contentType: file.type, dataB64: reader.result }); onChange?.() }
      catch (e) { setErr(String(e.message || e)) } finally { setUploading(false) }
    }
    reader.onerror = () => { setUploading(false); setErr(t('파일 읽기 실패')) }
    reader.readAsDataURL(file)
  }
  // 캐릭터(인물) 레퍼런스 — 콘텐츠 전체
  const [charRef, setCharRef] = useState(content.character_ref || '')
  const [charRefUrl, setCharRefUrl] = useState('')
  async function saveCharRef(body) {
    try { const r = await postJSON(`/api/contents/${content.id}/character-ref`, body); setCharRef(r.character_ref || ''); onChange?.() }
    catch (e) { setErr(String(e.message || e)) }
  }
  function uploadCharRef(file) { if (!file) return; const rd = new FileReader(); rd.onload = () => saveCharRef({ filename: file.name, contentType: file.type, dataB64: rd.result }); rd.readAsDataURL(file) }
  // 씬 환경/무드 레퍼런스 — 씬별
  async function saveEnvRef(i, body) {
    try { const r = await postJSON(`/api/contents/${content.id}/scene/${i}/env-ref`, body); if (r.scene) setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...r.scene } : s))) }
    catch (e) { setErr(String(e.message || e)) }
  }
  function uploadEnvRef(i, file) { if (!file) return; const rd = new FileReader(); rd.onload = () => saveEnvRef(i, { filename: file.name, contentType: file.type, dataB64: rd.result }); rd.readAsDataURL(file) }

  async function setFinalForm(f) { setForm(f); try { await postJSON(`/api/contents/${content.id}/final-form`, { form: f }) } catch {} onChange?.() }

  // 씬 이미지 프롬프트(설명) 생성 — 이미지 생성과 분리. 검수/수정 후 이미지 생성.
  const [promptIdx, setPromptIdx] = useState(-1)
  const [imgGuide, setImgGuide] = useState({})   // 씬별 이미지 아이디어/지시 (✍ 생성에 반영)
  async function genScenePrompt(i, guidance) {
    setPromptIdx(i); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/scene/${i}/prompt`, { guidance: guidance || '' }); setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...r.scene } : s))); setVer((v) => v + 1); return true }
    catch (e) { setErr(`${t('씬')} ${i + 1} ${t('프롬프트 실패')}: ${String(e.message || e)}`); return false } finally { setPromptIdx(-1) }
  }
  // 씬 이미지 생성 (버튼). iterative — 씬 1개씩.
  async function genSceneImage(i) {
    setGenIdx(i); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/scene/${i}/image`, { prompt: scenes[i]?.imagePrompt || '' }); setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...r.scene } : s))); setVer((v) => v + 1); return true }
    catch (e) { setErr(`${t('씬')} ${i + 1} ${t('이미지 실패')}: ${String(e.message || e)}`); return false } finally { setGenIdx(-1) }
  }
  // 씬 클립 생성 (image→video). 이미지가 먼저 있어야 함.
  const [clipIdx, setClipIdx] = useState(-1)
  async function genSceneClip(i) {
    setClipIdx(i); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/scene/${i}/clip`, { prompt: scenes[i]?.motionPrompt || scenes[i]?.shot || '' }); setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...r.scene } : s))); setVer((v) => v + 1); return true }
    catch (e) { setErr(`${t('씬')} ${i + 1} ${t('클립 실패')}: ${String(e.message || e)}`); return false } finally { setClipIdx(-1) }
  }
  // 씬 VO 생성 (영어). 한국어 vo → 영어 음성.
  const [voIdx, setVoIdx] = useState(-1)
  async function genSceneVO(i) {
    setVoIdx(i); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/scene/${i}/vo`, {}); setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, ...r.scene } : s))); setVer((v) => v + 1); return true }
    catch (e) { setErr(`${t('씬')} ${i + 1} VO ${t('실패')}: ${String(e.message || e)}`); return false } finally { setVoIdx(-1) }
  }
  // 매크로 (전체 생성) — 서버 백그라운드 잡. 페이지 이동/새로고침에 안전. 진행은 폴링.
  const [batch, setBatch] = useState('')
  const pollRef = useRef(null)
  const ICON = { prompts: '✍', images: '🖼', clips: '🎬', vo: '🔊' }
  async function reloadScenes() {
    try { const c2 = await api(`/api/contents/${content.id}`); const ss = c2?.scenes ? JSON.parse(c2.scenes) : null; if (ss) { setScenes(ss); setVer((v) => v + 1) } } catch {}
  }
  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  function pollBatch() {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const { job } = await api(`/api/contents/${content.id}/batch`)
        if (!job) { stopPoll(); setBatch(''); return }
        setBatch(`${ICON[job.kind] || '⏳'} ${job.done}/${job.total}`)
        if (job.status !== 'running') {
          stopPoll(); setBatch(''); await reloadScenes()
          if (job.fails?.length) setErr(`${t('일부 실패 — 씬')} ${job.fails.join(', ')}${job.lastError ? ' · ' + job.lastError : ''} (${t('개별 [재생성]으로 다시')})`)
        }
      } catch { /* 일시 오류 무시, 다음 틱 재시도 */ }
    }, 3000)
  }
  async function startBatch(kind, confirmMsg, hasExisting) {
    if (!scenes.length) { setErr(t('먼저 씬 스크립트를 생성하세요.')); return }
    if (hasExisting && !confirm(confirmMsg)) return
    setErr(null); setBatch(`${ICON[kind]} 0/?`)
    try {
      const r = await postJSON(`/api/contents/${content.id}/batch`, { kind })
      if (r?.job) { setBatch(`${ICON[kind]} 0/${r.job.total}`); pollBatch() }
    } catch (e) { setBatch(''); setErr(String(e.message || e)) }
  }
  const genAllPrompts = () => startBatch('prompts', t('모든 씬의 이미지 프롬프트를 생성합니다 (기존 덮어씀). 계속할까요?'), scenes.some((s) => s.imagePrompt))
  const genAllImages = () => { if (!hf) { setErr(t('HF_CREDENTIALS 필요')); return } startBatch('images', t('모든 씬 이미지를 생성합니다 (기존은 덮어씀). 계속할까요?'), scenes.some((s) => s.image)) }
  const genAllClips = () => startBatch('clips', t('영상화 켠 씬의 클립을 모두 생성합니다 (기존 덮어씀). 계속할까요?'), scenes.some((s) => s.makeVideo && s.video))
  const genAllVO = () => startBatch('vo', t('모든 VO를 생성합니다 (기존 덮어씀). 계속할까요?'), scenes.some((s) => s.audio))
  // 마운트 시 진행 중인 배치 있으면 폴링 재개 (다른 탭 갔다 와도 이어서 보임)
  useEffect(() => {
    api(`/api/contents/${content.id}/batch`).then(({ job }) => { if (job && job.status === 'running') { setBatch(`${ICON[job.kind] || '⏳'} ${job.done}/${job.total}`); pollBatch() } }).catch(() => {})
    return () => stopPoll()
  }, [content.id])
  // 임시 프리뷰 무비 (ffmpeg)
  const [movie, setMovie] = useState(content.preview || null)
  const [makingMovie, setMakingMovie] = useState(false)
  async function genMovie() {
    setMakingMovie(true); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/movie`, {}); setMovie(r.preview) }
    catch (e) { setErr(String(e.message || e)) } finally { setMakingMovie(false) }
  }
  // Remotion 정식 익스포트 (자막+전환+VO+CTA)
  const [exporting, setExporting] = useState(false)
  const [exportUrl, setExportUrl] = useState(content.export_mp4 || null)
  async function genExport() {
    setExporting(true); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/remotion`, {}); setExportUrl(r.url) }
    catch (e) { setErr(String(e.message || e)) } finally { setExporting(false) }
  }

  // ③ 전체 스크립트 — 재생성 = 저장된 이전 단계(분석+제품) 기반. 직접 편집은 onBlur 자동저장.
  // (엔드포인트가 잡 방식이라 최소 poll만; 진행률/모드 UI는 노드 그래프 ⑤에 있음)
  async function genOverall() {
    setBusy('overall'); setErr(null)
    try { const resp = await postJSON(`/api/contents/${content.id}/overall`, {}); const o = resp && resp.jobId ? await pollJob(resp.jobId) : resp; setOverall(o) }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy('') }
  }
  function editO(f, v) { setOverall((o) => ({ ...(o || {}), [f]: v })) }
  async function saveOverall() { try { await postJSON(`/api/contents/${content.id}/overall`, { overall }, 'PUT') } catch {} }

  // ④ 씬 스크립트 — 재생성 = 저장된 전체 스크립트 기반. 샷 개수 지정 가능. 자막·VO는 onBlur 자동저장.
  const [shotCount, setShotCount] = useState(content.shot_count ? String(content.shot_count) : '')
  async function genScenes() {
    if (scenes.some((s) => s.image || s.video || s.audio) && !confirm(t('씬을 새로 생성하면 기존 이미지·클립·VO가 모두 초기화됩니다. 계속할까요?'))) return
    setBusy('scenes'); setErr(null)
    try { const r = await postJSON(`/api/contents/${content.id}/script`, { shotCount }); setScenes(r.scenes); if (r.overall) setOverall(r.overall); setMovie(null) }
    catch (e) { setErr(String(e.message || e)) } finally { setBusy('') }
  }
  async function saveScenes() { try { const r = await postJSON(`/api/contents/${content.id}/scenes`, { scenes }, 'PUT'); if (r?.scenes) { setScenes(r.scenes); setVer((v) => v + 1) } onChange?.() } catch {} }
  function editS(i, f, v) { setScenes((ss) => ss.map((s, j) => (j === i ? { ...s, [f]: v } : s))) }
  async function putScenes(ns) { setScenes(ns); try { const r = await postJSON(`/api/contents/${content.id}/scenes`, { scenes: ns }, 'PUT'); if (r?.scenes) setScenes(r.scenes) } catch {} onChange?.() }
  // 씬별 레퍼런스 사진 토글 (갤러리에서 그 씬에 맞는 사진 선택)
  function toggleRef(i, url) {
    const cur = scenes[i].refs || []
    const refs = cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url]
    putScenes(scenes.map((s, j) => (j === i ? { ...s, refs } : s)))
  }
  // 씬 추가 (기본 = CTA 슬롯, 손동작 애니메이션). 이미지·모션·VO는 웹에서 생성.
  function addScene() {
    const id = Math.max(0, ...scenes.map((s) => s.id || 0)) + 1
    putScenes([...scenes, { id, t: '', durationSec: 3, onScreenText: 'Comment "LINK" 👇', vo: "Comment LINK and I'll send you the link!", makeVideo: true }])
  }
  function delScene(i) { if (confirm(t('이 씬을 삭제할까요?'))) putScenes(scenes.filter((_, j) => j !== i)) }
  // 씬 필드 즉시 저장 (영상화 토글 등) — 변경하자마자 DB 반영
  async function setSceneField(i, f, v) {
    const ns = scenes.map((s, j) => (j === i ? { ...s, [f]: v } : s))
    setScenes(ns)
    try { await postJSON(`/api/contents/${content.id}/scenes`, { scenes: ns }, 'PUT') } catch {}
    onChange?.()
  }

  const ready = !!analysis?.analysis

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="hrow"><h3 style={{ margin: 0 }}>{content.title}</h3><span style={{ flex: 1 }} /><button className="ghost" onClick={onClose}>{t('닫기')}</button></div>

        {/* 선택된 제품 (③에서) + 최종형 */}
        <div className="amz" style={{ marginTop: 8, borderColor: product ? 'var(--green)' : '#3a3f4a' }}>
          {product?.image && <img className="amz-img" src={product.image} alt="" />}
          <div className="amz-info">
            <div className="amz-title">{product ? `🛒 ${product.title || product.asin}` : t('제품 미선택')}</div>
            <div className="amz-met">
              {product?.price && <span className="score">{product.price}</span>}
              {product?.dimensions && <span className="muted" title={t('아마존 실제 치수 (스케일에 자동 반영)')}>📏 {product.dimensions}</span>}
              {product?.amazon_url && <a className="muted" href={product.amazon_url} target="_blank" rel="noopener">↗ {t('제휴 링크')}</a>}
              {analysis?.reel_username && <span className="muted">· 📌 @{analysis.reel_username}</span>}
            </div>
          </div>
          <button className="ghost" onClick={() => goProducts?.(content.id)}>{product ? t('③ 제품 변경') : t('③ 제품 선택')}</button>
        </div>

        {/* 커스텀 레퍼런스 추가 (공개 https URL) — 갤러리 맨 앞(첫 레퍼런스)으로 */}
        {product && (
          <div className="hrow" style={{ marginTop: 6, gap: 6 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none' }}>🖼 {t('레퍼런스 추가')}</span>
            <input style={{ flex: 1 }} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder={t('공개 이미지 URL (https://…) — 첫 레퍼런스로 추가')} onKeyDown={(e) => e.key === 'Enter' && addRef()} />
            <button className="ghost" disabled={!refUrl.trim()} onClick={addRef}>＋ {t('추가')}</button>
            <label className="ghost" style={{ cursor: 'pointer', padding: '4px 8px' }}>{uploading ? <Dots label={t('업로드')} /> : '📁 ' + t('파일')}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { uploadRef(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </div>
        )}
        {product?.images?.length > 0 && (
          <div className="refpick" style={{ marginTop: 4 }}>
            <span className="muted" style={{ fontSize: 10 }}>{t('제품 레퍼런스')} {product.images.length}:</span>
            {product.images.map((u) => (
              <span key={u} style={{ position: 'relative', display: 'inline-block' }}>
                <a href={disp(u)} target="_blank" rel="noopener"><img src={disp(u)} alt="" className="refopt on" title={t('클릭해서 크게 보기')} /></a>
                <button className="ghost" onClick={() => removeProductRef(u)} title={t('삭제')} style={{ position: 'absolute', top: -5, right: -5, padding: '0 4px', fontSize: 10, lineHeight: 1.5, borderRadius: 8 }}>✕</button>
              </span>
            ))}
          </div>
        )}
        {/* 🧑 캐릭터(인물) 레퍼런스 — 모든 씬에 같은 인물 적용 */}
        <div className="hrow" style={{ marginTop: 6, gap: 6 }}>
          <span className="muted" style={{ fontSize: 11, flex: 'none' }}>🧑 {t('캐릭터 레퍼런스')}</span>
          {charRef
            ? <><a href={disp(charRef)} target="_blank" rel="noopener"><img src={disp(charRef)} alt="" className="refopt on" title={t('클릭해서 크게 보기')} /></a><button className="ghost" style={{ padding: '2px 6px' }} onClick={() => saveCharRef({ remove: true })}>✕</button></>
            : <>
              <input style={{ flex: 1 }} value={charRefUrl} onChange={(e) => setCharRefUrl(e.target.value)} placeholder={t('인물 사진 URL (https://…) — 모든 씬 동일 인물')} onKeyDown={(e) => { if (e.key === 'Enter' && charRefUrl.trim()) { saveCharRef({ url: charRefUrl.trim() }); setCharRefUrl('') } }} />
              <label className="ghost" style={{ cursor: 'pointer', padding: '4px 8px' }}>📁 {t('파일')}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { uploadCharRef(e.target.files?.[0]); e.target.value = '' }} /></label>
            </>}
        </div>

        <div className="hrow" style={{ marginTop: 10, gap: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>{t('최종형')}:</span>
          <button className={form === 'card' ? 'chip on' : 'chip'} onClick={() => setFinalForm('card')}>🖼 {t('카드형(이미지)')}</button>
          <button className={form === 'movie' ? 'chip on' : 'chip'} onClick={() => setFinalForm('movie')}>🎬 {t('풀무비(클립)')}</button>
          <span className="muted" style={{ fontSize: 10.5 }}>{form === 'movie' ? t('· 씬별 클립 생성') : t('· 클립 생성 스킵')}</span>
        </div>

        {!ready && <div className="errbox statusbox" style={{ marginTop: 10 }}>{t('먼저 ② 릴스 분석에서 🎬 영상 분석을 실행하세요.')}</div>}

        {/* 💡 추천 설정 — 릴스·제품 분석 기반 화자+훅. 정하면 아래 전체/씬 스크립트가 이 톤으로 생성됨 */}
        {ready && (
          <Section title={`💡 ${t('추천 설정')}`} sub={t('릴스·제품 분석 기반')} gold open={open.setup} onToggle={() => toggle('setup')}
            right={<button className="ghost" onClick={getRec} disabled={recBusy}>{recBusy ? <Dots label={t('분석 중')} /> : t('💡 추천 받기')}</button>}>
            {rec && (
              <div className="statusbox" style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12 }}>🎭 <b>{nameOf(personaLib, rec.persona)}</b> <span className="muted">— {rec.personaWhy}</span></div>
                <div style={{ fontSize: 12, marginTop: 2 }}>🎬 <b>{nameOf(hookLib, rec.hook)}</b> <span className="muted">— {rec.hookWhy}</span></div>
                <button className="primary" style={{ marginTop: 6, fontSize: 11, padding: '3px 10px' }} onClick={applyRec}>{t('이 추천 적용')}</button>
              </div>
            )}
            {(() => {
              const isCustom = !!persona && !personaLib.some((p) => p.key === persona)
              return (
                <div className="hrow" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                  <label className="fld" style={{ flex: 1, minWidth: 200 }}><span>🎭 {t('화자 (페르소나)')}</span>
                    <select value={isCustom ? '__custom' : persona} onChange={(e) => { const v = e.target.value; if (v === '__custom') { if (!isCustom) savePersona('') } else savePersona(v) }}>
                      <option value="">{t('— 기본 (회의적·데드팬) —')}</option>
                      {personaLib.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                      <option value="__custom">✏️ {t('직접 입력')}</option>
                    </select>
                    {isCustom && <input style={{ marginTop: 4 }} value={persona} onChange={(e) => setPersona(e.target.value)} onBlur={() => savePersona()} placeholder={t('나만의 화자 — 예: tired night-shift nurse, deadpan')} />}
                  </label>
                  <label className="fld" style={{ flex: 1, minWidth: 200 }}><span>🎬 {t('훅 / 스토리텔링')}</span>
                    <select value={hook} onChange={(e) => saveHook(e.target.value)}>
                      <option value="">{t('— 자동 (분석 구조 따름) —')}</option>
                      {hookLib.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
                    </select>
                  </label>
                </div>
              )
            })()}
            <p className="muted hint" style={{ margin: '4px 2px 0' }}>{t('화자=목소리, 훅=이야기 모양. 정하면 아래 전체·씬 스크립트가 모두 이 톤으로 생성됩니다. 바꾼 뒤 재생성.')}</p>
          </Section>
        )}

        {/* 1. 전체 스크립트 */}
        <Section title={`1. ${t('전체 스크립트')}`} open={open.overall} onToggle={() => toggle('overall')}
          right={<button className="primary" onClick={() => genOverall()} disabled={!ready || !!busy}>{busy === 'overall' ? <Dots label={t('생성')} /> : overall ? t('🔄 재생성') : t('▶ 생성')}</button>}>
          {overall ? (
            <div className="vbox" style={{ gap: 6 }}>
              <label className="fld"><span>{t('각도(angle)')}</span><input value={overall.angle || ''} onChange={(e) => editO('angle', e.target.value)} onBlur={saveOverall} /></label>
              <label className="fld"><span>{t('훅 멘트')}</span><input value={overall.hookLine || ''} onChange={(e) => editO('hookLine', e.target.value)} onBlur={saveOverall} /></label>
              <label className="fld"><span>{t('전체 나레이션')}</span><textarea rows={4} value={overall.vo || ''} onChange={(e) => editO('vo', e.target.value)} onBlur={saveOverall} /></label>
              <label className="fld"><span>{t('비트(줄바꿈 구분)')}</span><textarea rows={3} value={Array.isArray(overall.beats) ? overall.beats.join('\n') : (overall.beats || '')} onChange={(e) => editO('beats', e.target.value.split('\n').filter(Boolean))} onBlur={saveOverall} /></label>
              <label className="fld"><span>CTA</span><input value={overall.cta || ''} onChange={(e) => editO('cta', e.target.value)} onBlur={saveOverall} /></label>
            </div>
          ) : <p className="muted hint" style={{ margin: '0 2px' }}>{t('릴스 분석의 구조를 이해해 선택 제품으로 전체 스크립트를 새로 씁니다. 생성 후 직접 교정하세요.')}</p>}
        </Section>

        {/* 2. 씬 스크립트 */}
        <Section title={`2. ${t('씬 스크립트')}`} open={open.scenes} onToggle={() => toggle('scenes')}
          right={<>
            <label className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>{t('샷 수')}
              <select value={shotCount} onChange={(e) => setShotCount(e.target.value)} disabled={!!busy}>
                <option value="">{t('자동')}</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="primary" onClick={() => genScenes()} disabled={!ready || !overall || !!busy} title={overall ? '' : t('먼저 전체 스크립트를 생성하세요.')}>{busy === 'scenes' ? <Dots label={t('생성')} /> : scenes.length ? t('🔄 재생성') : t('▶ 씬 분해')}</button>
          </>}>
          {/* 연출 지시 — 훅 구조·샷 스타일 (씬 분해에 반영, 스토리는 전체 스크립트 기반) */}
          <label className="fld"><span>🎬 {t('연출 지시 (훅·샷)')}</span>
            <textarea rows={2} value={direction} onChange={(e) => setDirection(e.target.value)} onBlur={saveDirection} placeholder={t('예: 강한 훅(충격 사실/호기심), 다이내믹하고 다양한 샷, 빠른 컷. 스토리는 전체 스크립트 유지.')} />
          </label>
          {err && <div className="errbox statusbox" style={{ marginTop: 6 }}>{err}</div>}
          {scenes.length > 0 && (
            <div className="scenes" style={{ marginTop: 8 }}>
              {scenes.map((s, i) => (
                <div key={i} className="scene-edit">
                  <div className="hrow" style={{ marginBottom: 4, gap: 6 }}>
                    <span className="st">{s.t || `#${i + 1}`}</span>
                    <span style={{ flex: 1 }} />
                    <button className="ghost" title={t('씬 삭제')} onClick={() => delScene(i)}>🗑</button>
                  </div>
                  <input className="se-cap" value={s.onScreenText || ''} onChange={(e) => editS(i, 'onScreenText', e.target.value)} onBlur={saveScenes} placeholder={t('타이틀 (자막)')} />
                  <input className="se-vo" value={s.vo || ''} onChange={(e) => editS(i, 'vo', e.target.value)} onBlur={saveScenes} placeholder="VO" />
                </div>
              ))}
            </div>
          )}
          {scenes.length > 0 && <button className="ghost" style={{ marginTop: 8 }} onClick={addScene}>＋ {t('씬 추가 (예: CTA 손동작)')}</button>}
        </Section>

        {/* 3. 씬 이미지 — 최신(편집된) 프롬프트로 생성/재생성 */}
        {scenes.length > 0 && (
          <Section title={`3. ${t('씬 이미지')}`} open={open.images} onToggle={() => toggle('images')}
            right={<>
              <button className="ghost" disabled={!!batch} onClick={genAllPrompts}>{batch.startsWith('✍') ? <Dots label={batch} /> : t('✍ 전체 프롬프트 생성')}</button>
              <button className="primary" disabled={!hf || !!batch} onClick={genAllImages}>{batch.startsWith('🖼') ? <Dots label={batch} /> : t('🖼 전체 이미지 생성')}</button>
            </>}>
            {hf === false && (
              <div className="callout" style={{ marginTop: 6 }}>
                ⚠️ {t('HF_CREDENTIALS 미설정 — 버튼 생성 불가.')} <b>webapp/.env → HF_CREDENTIALS=KEY_ID:KEY_SECRET</b> {t('넣고 재시작하면 버튼이 켜집니다. 또는 채팅에서')} <b>“{t('콘텐츠')} {content.id} {t('이미지 생성')}”</b> {t('(옵션2)')}
              </div>
            )}
            {hf && <div className="callout" style={{ marginTop: 6 }}>{t('씬별 [생성] → Higgsfield 생성 → output 폴더 저장 → 표시. 프롬프트 고치고 [재생성]으로 반복 (비용=씬 단위).')}</div>}
            <div className="hrow" style={{ marginTop: 8, gap: 6 }}>
              <span className="muted" style={{ fontSize: 11, flex: 'none' }}>🎨 {t('전 씬 스타일')}</span>
              <input style={{ flex: 1 }} value={style} onChange={(e) => setStyle(e.target.value)} onBlur={saveStyle} placeholder={t('예: 여성 손, 한국 가정집, 밝은 자연광 (모든 씬 생성에 자동 적용)')} />
            </div>
            {err && <div className="errbox statusbox" style={{ marginTop: 6 }}>{err}</div>}
            <div className="scenes" style={{ marginTop: 8 }}>
              {scenes.map((s, i) => (
                <div key={i} className="imgrow">
                  <div className="imgthumb">
                    {s.image
                      ? <a href={s.image} target="_blank" rel="noopener" title={t('원본 열기')}><img src={bust(s.image)} alt="" onError={(e) => { e.target.style.display = 'none' }} /></a>
                      : <span className="imgph">{t('미생성')}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hrow" style={{ marginBottom: 3 }}>
                      <span className="st">{s.t || `#${i + 1}`}</span>
                      {product?.image && <img className="refmini" src={product.image} alt="" title={t('제품 레퍼런스')} />}
                      <span style={{ flex: 1 }} />
                      <span className="badge" style={{ color: s.image ? 'var(--green)' : 'var(--mut)' }}>{s.image ? t('생성됨') : t('대기')}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 3, lineHeight: 1.4 }}>💬 {s.onScreenText} {s.vo && <>· 🔊 {s.vo}</>}</div>
                    <textarea rows={3} className="se-prompt" value={s.imagePrompt || ''} onChange={(e) => editS(i, 'imagePrompt', e.target.value)} onBlur={saveScenes} placeholder={t('이미지 설명/프롬프트 — [✍ 프롬프트]로 생성하거나 직접 작성. [재생성]이 이 내용을 사용')} />
                    {product?.images?.length > 1 && (
                      <div className="refpick">
                        <span className="muted" style={{ fontSize: 10 }}>{t('이 씬 레퍼런스')}:</span>
                        {product.images.map((u) => (
                          <img key={u} src={disp(u)} alt="" className={'refopt' + ((s.refs || []).includes(u) ? ' on' : '')} onClick={() => toggleRef(i, u)} title={t('이 씬에 쓸 제품 사진 선택 (없으면 메인)')} />
                        ))}
                      </div>
                    )}
                    <div className="refpick" style={{ marginTop: 4 }}>
                      <span className="muted" style={{ fontSize: 10 }}>🌆 {t('환경/무드')}:</span>
                      {s.envRef
                        ? <><a href={disp(s.envRef)} target="_blank" rel="noopener"><img src={disp(s.envRef)} alt="" className="refopt on" title={t('클릭해서 크게 보기')} /></a><button className="ghost" style={{ padding: '1px 5px', fontSize: 10 }} onClick={() => saveEnvRef(i, { remove: true })}>✕</button></>
                        : <label className="ghost" style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 10 }}>📁 {t('공간/무드 추가')}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { uploadEnvRef(i, e.target.files?.[0]); e.target.value = '' }} /></label>}
                    </div>
                    <div className="hrow" style={{ marginTop: 4, gap: 6 }}>
                      <input className="se-vo" style={{ flex: 1, fontSize: 11, minWidth: 80 }} value={imgGuide[i] || ''} onChange={(e) => setImgGuide((g) => ({ ...g, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') genScenePrompt(i, imgGuide[i]) }} placeholder={t('이미지 아이디어/지시 (선택) — 예: 접는 동작 말고 가방에 든 모습')} />
                      <button className="ghost" disabled={promptIdx === i || !!batch} onClick={() => genScenePrompt(i, imgGuide[i])} title={t('이미지 설명 생성 — 위 아이디어 반영, 비우면 자동')}>
                        {promptIdx === i ? <Dots label="✍" /> : t('✍ 프롬프트')}
                      </button>
                      <button className="primary" disabled={!hf || genIdx === i || !!batch} title={hf ? '' : t('HF_CREDENTIALS 필요')} onClick={() => genSceneImage(i)}>
                        {genIdx === i ? <Dots label={t('생성')} /> : s.image ? t('🔄 재생성') : t('🖼 생성')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 4. 씬 클립 (풀무비 모드) — 이미지→영상. 영상화 켠 씬만. */}
        {form === 'movie' && scenes.length > 0 && (
          <Section title={`4. ${t('씬 클립')}`} open={open.clips} onToggle={() => toggle('clips')}
            right={<>
              <button className="primary" disabled={!!batch} onClick={genAllVO}>{batch.startsWith('🔊') ? <Dots label={batch} /> : t('🔊 전체 VO 생성')}</button>
              <button className="primary" disabled={!!batch} onClick={genAllClips}>{batch.startsWith('🎬') ? <Dots label={batch} /> : t('🎬 전체 클립 생성')}</button>
            </>}>
            <div className="callout" style={{ marginTop: 6 }}>{t('씬마다 애니메이션/정지 선택. 애니메이션 = 그 씬 이미지로 클립 생성(이미지 먼저). 정지 = 이미지 그대로. 모션 지시는 직접 편집 → [재생성].')}</div>
            <div className="scenes" style={{ marginTop: 8 }}>
              {scenes.map((s, i) => (
                <div key={i} className="imgrow">
                  <div className="imgthumb">
                    {s.makeVideo && s.video ? <video src={bust(s.video)} controls muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : s.image ? <img src={bust(s.image)} alt="" /> : <span className="imgph">{t('이미지 없음')}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hrow" style={{ marginBottom: 4, gap: 6 }}>
                      <span className="st">{s.t || `#${i + 1}`}</span>
                      <span style={{ flex: 1 }} />
                      <button className={s.makeVideo ? 'chip on' : 'chip'} onClick={() => setSceneField(i, 'makeVideo', true)}>✨ {t('애니메이션')}</button>
                      <button className={!s.makeVideo ? 'chip on' : 'chip'} onClick={() => setSceneField(i, 'makeVideo', false)}>⏸ {t('정지')}</button>
                    </div>
                    {s.makeVideo ? (
                      <>
                        <label className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>🎥 {t('카메라 무빙')}
                          <select value={s.cameraMove || ''} onChange={(e) => setSceneField(i, 'cameraMove', e.target.value)} style={{ flex: 1 }}>
                            <option value="">{t('기본 (느린 push in)')}</option>
                            <option value="auto">{t('✨ 자동 (씬에 맞게)')}</option>
                            {moveLib.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                          </select>
                        </label>
                        <textarea rows={2} className="se-prompt" value={s.motionPrompt ?? ''} onChange={(e) => editS(i, 'motionPrompt', e.target.value)} onBlur={saveScenes} placeholder={t('추가 연기/액션 (선택) — 카메라 무빙은 위에서. 한 컷에 한 동작, 느리게')} />
                        <div className="hrow" style={{ marginTop: 4 }}>
                          <span className="badge" style={{ color: s.video ? 'var(--green)' : 'var(--mut)' }}>{s.video ? t('클립 생성됨') : s.imageSrc ? t('대기') : t('이미지 먼저')}</span>
                          <span style={{ flex: 1 }} />
                          <button className="primary" disabled={!s.imageSrc || clipIdx === i || !!batch} title={s.imageSrc ? '' : t('먼저 이미지 생성')} onClick={() => genSceneClip(i)}>
                            {clipIdx === i ? <Dots label={t('클립 생성')} /> : s.video ? t('🔄 재생성') : t('🎬 클립 생성')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="muted" style={{ fontSize: 11 }}>⏸ {t('정지 이미지로 사용 (애니메이션 없음)')}</div>
                    )}
                    {/* VO (영어) — 모든 씬 */}
                    <div className="hrow" style={{ gap: 6, marginTop: 6, borderTop: '1px solid #232730', paddingTop: 6 }}>
                      <span className="muted" style={{ fontSize: 10.5, flex: 1, minWidth: 0 }}>🔊 {s.voEn || `(${t('VO 미생성')}) ${s.vo || ''}`}</span>
                      {s.audio && <audio src={bust(s.audio)} controls style={{ height: 26, maxWidth: 140 }} />}
                      <button className="ghost" disabled={voIdx === i || !!batch} onClick={() => genSceneVO(i)} title={t('영어 VO 생성')}>
                        {voIdx === i ? <Dots label="VO" /> : s.audio ? t('🔊 재생성') : t('🔊 VO 생성')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 프리뷰 & 정식 익스포트 */}
        {scenes.length > 0 && (
          <Section title={`🎬 ${t('익스포트')}`} sub={t('프리뷰 & 정식 익스포트')} open={open.export} onToggle={() => toggle('export')}>
            <div className="hrow">
              <h3 style={{ margin: 0, color: 'var(--gold)' }}>🎞 {t('프리뷰 무비 (ffmpeg)')}</h3>
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{t('현재 클립/이미지 + VO 이어붙임 (테스트용, Higgsfield 아님)')}</span>
              <span style={{ flex: 1 }} />
              <button className="primary" onClick={genMovie} disabled={makingMovie}>{makingMovie ? <Dots label={t('합성 중')} /> : movie ? t('🔄 다시 합성') : t('▶ 프리뷰 합성')}</button>
            </div>
            {movie && <video src={bust(movie)} controls style={{ width: 220, marginTop: 10, borderRadius: 8, display: 'block' }} />}
            <p className="muted hint" style={{ margin: '6px 2px' }}>{t('씬 순서대로: 클립 있으면 클립, 없으면 정지 이미지. VO 있으면 깔림. (빠른 테스트용)')}</p>

            {/* Remotion 정식 익스포트 — 자막+전환+VO+CTA */}
            <div className="hrow" style={{ marginTop: 12, borderTop: '1px solid #232730', paddingTop: 10 }}>
              <h3 style={{ margin: 0, color: 'var(--gold)' }}>🎬 {t('정식 익스포트 (Remotion)')}</h3>
              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{t('자막·전환·VO·CTA 합성 (1080×1920)')}</span>
              <span style={{ flex: 1 }} />
              <button className="primary" onClick={genExport} disabled={exporting}>{exporting ? <Dots label={t('렌더 중')} /> : exportUrl ? t('🔄 다시 익스포트') : t('▶ 익스포트')}</button>
            </div>
            {exportUrl && <video src={bust(exportUrl)} controls style={{ width: 240, marginTop: 10, borderRadius: 8, display: 'block' }} />}
            {exportUrl && <a className="muted" style={{ fontSize: 11 }} href={exportUrl} download>⬇ {t('mp4 다운로드')}</a>}
            <p className="muted hint" style={{ margin: '6px 2px' }}>{t('첫 렌더는 Remotion이 헤드리스 크롬을 받아서 느릴 수 있습니다(~1분+).')}</p>
          </Section>
        )}
      </div>
    </div>
  )
}
