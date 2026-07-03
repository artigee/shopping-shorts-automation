// Lightweight agent/job layer — runs a long LLM task (analyze, generate, …) decoupled
// from the HTTP request, persisting status/progress so the UI survives navigation and
// can reconnect. In-process (single Node + SQLite); no external queue.
import { db } from './db.js'

// The agent registry — one entry per named long-running LLM operation. This is the
// single place that answers "what do we use an agent for". Endpoints create a job with
// one of these `agent` names; the UI shows progress per job.
export const AGENTS = {
  analyze: { label: 'Reel Analysis', of: 'analyses', desc: 'keyframes+caption → structured creative-function analysis (+ product match)' },
  recommend: { label: 'Persona/Hook Recommender', of: 'analyses', desc: 'pick best persona + hook for this product/reel' },
  overall: { label: 'Overall Script', of: 'contents', desc: 'reel structure + product → full VO story (claim-safe)' },
  scenes: { label: 'Scene Script', of: 'contents', desc: 'overall story → per-scene title + VO' },
  // image/clip/vo generation agents can be registered here as they move onto the job layer.
}

const j = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)

export function getJob(id) { return j(id) }

export function activeJob(refType, refId) {
  return db.prepare(`SELECT * FROM jobs WHERE ref_type=? AND ref_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`).get(refType, String(refId))
}

export function listJobs({ status, refType, refId, limit = 50 } = {}) {
  const where = [], args = []
  if (status) { where.push('status=?'); args.push(status) }
  if (refType) { where.push('ref_type=?'); args.push(refType) }
  if (refId != null) { where.push('ref_id=?'); args.push(String(refId)) }
  const sql = `SELECT * FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  return db.prepare(sql).all(...args, limit)
}

function set(id, patch) {
  const cols = Object.keys(patch)
  if (!cols.length) return
  db.prepare(`UPDATE jobs SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`)
    .run(...cols.map((c) => patch[c]), id)
}

// Create a job (queued) and start it in the background. Returns the job row immediately.
// fn receives a progress(message, pct) callback and returns an optional JSON-able result.
export function startJob({ agent, refType, refId, message = 'queued…' }, fn) {
  const info = db.prepare(`INSERT INTO jobs (agent, ref_type, ref_id, status, progress, message) VALUES (?,?,?,'queued',0,?)`)
    .run(agent, refType || null, refId != null ? String(refId) : null, message)
  const id = info.lastInsertRowid
  const progress = (msg, pct) => set(id, pct != null ? { message: String(msg), progress: Math.max(0, Math.min(100, Math.round(pct))) } : { message: String(msg) })
  // run detached — do NOT await; the endpoint already returned.
  ;(async () => {
    set(id, { status: 'running', progress: 5, message: 'started…' })
    try {
      const result = await fn(progress)
      set(id, { status: 'done', progress: 100, message: 'done', result: result != null ? JSON.stringify(result) : null })
    } catch (e) {
      set(id, { status: 'failed', error: (e && (e.message || String(e)) || 'failed').slice(0, 600), message: 'failed' })
    }
  })()
  return j(id)
}
