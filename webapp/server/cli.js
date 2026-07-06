// claude CLI 공용 래퍼 — 프로젝트의 모든 LLM 호출이 이 한 곳을 지난다.
// (기존에 produce/higgsfield/extract/match가 각자 spawn 래퍼를 복제하던 것을 통합)
//  runClaude     : prompt → stdout 텍스트 (spawn + timeout + kill)
//  stripFence    : ```json ...``` 펜스 제거
//  extractJson   : 출력에서 JSON을 "균형 스캔"으로 견고하게 추출 (탐욕 정규식의 오캡처 방지)
//  runClaudeJson : JSON 응답 표준형 — 재시도 + 추출 + (선택) 검증까지 한 번에
import { spawn } from 'node:child_process'

export function runClaude(prompt, { model = 'sonnet', tools = [], timeout = 240000, timeoutMsg = 'claude CLI timeout' } = {}) {
  const args = ['-p', prompt]
  if (tools && tools.length) args.push('--allowedTools', ...tools)
  args.push('--model', model)
  return new Promise((res, rej) => {
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error(timeoutMsg)) }, timeout)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(t); rej(e) })   // ENOENT = CLI 미설치
    child.on('close', (code) => { clearTimeout(t); code === 0 ? res(out) : rej(new Error(`claude exit ${code}: ${err.slice(-200)}`)) })
  })
}

export function stripFence(t = '') {
  const m = String(t).match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : String(t)).trim()
}

// 출력에서 첫 번째 완결된 JSON 값(객체/배열)을 균형 스캔으로 추출.
// 문자열/이스케이프를 인지하므로 VO 안의 따옴표·중괄호에 속지 않는다.
export function extractJson(text, { array = false } = {}) {
  const src = stripFence(text)
  const open = array ? '[' : '{', close = array ? ']' : '}'
  let start = src.indexOf(open)
  while (start !== -1) {
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < src.length; i++) {
      const ch = src[i]
      if (inStr) { esc = esc ? false : ch === '\\'; if (!esc && ch === '"') inStr = false; continue }
      if (ch === '"') { inStr = true; continue }
      if (ch === open || (ch === '{' || ch === '[')) depth++
      else if (ch === close || ch === '}' || ch === ']') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(src.slice(start, i + 1)) } catch { break }   // 이 후보 실패 → 다음 시작점
        }
      }
    }
    start = src.indexOf(open, start + 1)
  }
  throw new Error('출력에서 JSON을 찾지 못했습니다: ' + src.slice(0, 160))
}

// JSON 응답 표준형: 재시도(retries+1회) + 균형 추출 + 검증(validate → 오류문자열 또는 null).
// 검증 실패 사유는 다음 시도의 프롬프트에 붙여 스스로 고치게 한다 (repair pass).
export async function runClaudeJson(prompt, { model, tools, timeout, retries = 2, array = false, validate, timeoutMsg } = {}) {
  let lastErr = null, extra = ''
  for (let k = 0; k <= retries; k++) {
    try {
      const out = await runClaude(prompt + extra, { model, tools, timeout, timeoutMsg })
      const obj = extractJson(out, { array })
      if (validate) {
        const problem = validate(obj)
        if (problem) { extra = `\n\nYour previous output failed validation: ${problem}\nRegenerate the FULL corrected JSON (same schema), fixing only what failed.`; throw new Error('검증 실패: ' + problem) }
      }
      return obj
    } catch (e) { lastErr = e }
  }
  throw lastErr
}
