#!/usr/bin/env bash
# 디버그 포트로 크롬 실행 → 백엔드가 CDP(9222)로 붙어 IG를 내 세션으로 수집.
#
# ⚠️ 시스템 Google Chrome(149+)은 connectOverCDP handshake에서
#    "Browser context management is not supported" 로 Playwright 연결이 깨진다.
#    → 그래서 Playwright 번들 "Chrome for Testing"을 기본으로 쓴다 (버전 매칭 = 안정).
# 첫 실행 때 열리는 창에서 instagram.com 로그인 1회 → 세션이 전용 프로필에 유지됨.
#
# 사용:  ./scripts/launch-chrome.sh        (포트 9222, 전용 프로필)
#        PORT=9333 ./scripts/launch-chrome.sh
#        CHROME=/경로/크롬 ./scripts/launch-chrome.sh   (강제 지정)
set -euo pipefail

PORT="${PORT:-9222}"
# Use your REAL system Chrome + a dedicated profile: Instagram login works normally here
# (Playwright only ATTACHES via CDP afterward — it does NOT drive the browser at login,
# so IG never sees automation and never bounces the login).
PROFILE="${PROFILE:-$HOME/.shopping-shorts-chrome}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [[ ! -x "$CHROME" ]]; then
  echo "✘ 크롬을 못 찾음: $CHROME" >&2
  echo "  CHROME=/경로/크롬 ./scripts/launch-chrome.sh 로 경로 지정" >&2
  exit 1
fi

mkdir -p "$PROFILE"
echo "[chrome] 디버그 포트 $PORT · 전용 프로필 $PROFILE"
echo "        → 처음이면 열리는 창에서 instagram.com 로그인 한 번 해주세요."
exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  "https://www.instagram.com/"
