#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR="$ROOT_DIR/../marin-app-shell"
BROWSER_MODE=""
case "${1:-}" in
  '') ;;
  --browser) BROWSER_MODE="http" ;;
  --browser-in-memory) BROWSER_MODE="in-memory" ;;
  -h|--help)
    printf 'Usage: bash scripts/check.sh [--browser|--browser-in-memory]\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
command -v python3 >/dev/null 2>&1 || { printf 'ERROR: Python 3 is required.\n' >&2; exit 1; }

bash -n "$ROOT_DIR/scripts/check.sh"
if [[ -f "$SHELL_DIR/scripts/install.py" ]]; then
  python3 "$SHELL_DIR/scripts/install.py" --check "$ROOT_DIR"
else
  printf 'SKIP: marin-app-shell is not next to this repo; shell integrity was not checked.\n' >&2
fi
# The button audit ships with the shell release; use the installed copy so it matches the installed shell.
python3 "$ROOT_DIR/vendor/marinos/audit-buttons.py" "$ROOT_DIR" --fail
# Lists copy, download, file reading and upload code the app does itself; it must list nothing.
python3 "$ROOT_DIR/vendor/marinos/audit-shared-helpers.py" "$ROOT_DIR" --fail
if command -v node >/dev/null 2>&1; then
  node --check "$ROOT_DIR/assets/app.js"
  printf 'JavaScript syntax: PASS\n'
else
  printf 'SKIP: Node is unavailable; JavaScript syntax was not checked.\n' >&2
fi

if [[ -n "$BROWSER_MODE" ]]; then
  TEST_RUNNER="$ROOT_DIR/tests/browser_roundtrip.py"
  if [[ ! -f "$TEST_RUNNER" ]]; then
    printf 'ERROR: The browser round-trip test is missing from this checkout.\n' >&2
    exit 1
  fi
  EXTRA_ARGS=()
  if [[ "$BROWSER_MODE" == "in-memory" ]]; then EXTRA_ARGS+=(--in-memory); fi
  python3 "$TEST_RUNNER" "${EXTRA_ARGS[@]}" \
    --zipper-dir "$ROOT_DIR/../marin-zipper" \
    --unzipper-dir "$ROOT_DIR"
else
  printf 'SKIP: Browser tests not requested; run with --browser or --browser-in-memory.\n'
fi
printf 'Requested checks completed successfully.\n'
