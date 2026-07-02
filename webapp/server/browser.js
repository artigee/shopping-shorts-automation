// Shared browser access for collect / amazon / analyze.
//
// APPROACH: attach to the user's OWN debug Chrome via connectOverCDP (the user logs into
// instagram.com there in a NORMAL window — no automation during login, so IG does not bounce
// the login). Playwright only ATTACHES afterward to make API/page calls.
//
// Chrome 149 made a bare connectOverCDP flaky ("Browser context management is not supported"),
// so we (1) connect ONCE and CACHE the connection (reuse for every call — no connect/close
// churn, which was what corrupted the CDP session), and (2) RETRY the connect a few times.
// Launch the debug Chrome with scripts/launch-chrome.sh (Chrome for Testing on :9222).
import { chromium } from 'playwright-core'

const CDP_URL = process.env.CDP_URL || 'http://localhost:9222'

async function connectWithRetry(tries = 6) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await chromium.connectOverCDP(CDP_URL, { timeout: 5000 })
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  const err = new Error(
    `Can't attach to debug Chrome (${CDP_URL}) — run scripts/launch-chrome.sh, log into instagram.com in that window, then retry. (cause: ${lastErr?.message?.split('\n')[0] || 'unknown'})`
  )
  err.code = 'CHROME_NOT_FOUND'
  throw err
}

let browserPromise = null

// Returns a live BrowserContext from the user's debug Chrome. Cached: one CDP connection,
// reused across calls (callers open/close their OWN pages, never close this browser).
export async function getContext() {
  if (browserPromise) {
    try {
      const b = await browserPromise
      if (b && b.isConnected()) return b.contexts()[0] || (await b.newContext())
    } catch { /* fall through, reconnect */ }
    browserPromise = null
  }
  browserPromise = connectWithRetry()
  const b = await browserPromise
  b.on('disconnected', () => { browserPromise = null })
  return b.contexts()[0] || (await b.newContext())
}
