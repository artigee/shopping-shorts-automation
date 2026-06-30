export const FUNNEL = /(comment|comenta|kommentier|tap ❤|tap heart|i'?ll dm|dm you|send you the link|te env[ií]o|link in bio)/i
// 모음(Top N·하울) vs 단일 판별
export const COMBO = /(\b\d{2,3}\b.*(products|items|finds|deals)|best ?sellers|top \d|round ?up|\bhaul\b|essentials|favorites)/i
// 노이즈(쇼핑과 무관·저의도): 밈·정치·팬덤·드롭십 등
export const NOISE = /(\bmeme\b|funny ?shirt|liberal|trump|democrat|republican|civil war|\bmovie\b|\bfilm\b|dropshipping|stranger things|one ?piece fan|den den mushi)/i
export const isCombo = (cap = '') => COMBO.test(cap)
export const isNoise = (cap = '') => NOISE.test(cap)

export const fmt = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : '' + (n || 0)

export async function api(path, opts) {
  const r = await fetch(path, opts)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `${r.status} 오류`)
  return data
}

export async function postJSON(path, body, method = 'POST') {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
