#!/usr/bin/env bash
# 디버그 포트로 크롬 실행 → 백엔드가 CDP(9222)로 붙어 IG를 내 세션으로 수집.
#
# 최신 크롬(136+)은 '기본 프로필'에 디버그 포트 여는 걸 막으므로 전용 프로필을 씀.
# 첫 실행 때 열리는 크롬에서 instagram.com 로그인 1회 → 세션이 프로필에 유지됨(다음부턴 바로 됨).
#
# 사용:  ./scripts/launch-chrome.sh        (포트 9222, 전용 프로필)
#        PORT=9333 ./scripts/launch-chrome.sh
set -euo pipefail

PORT="${PORT:-9222}"
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
