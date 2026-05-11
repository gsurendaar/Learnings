#!/usr/bin/env bash
#
# run-ft.sh — Run Cypress FTs in an isolated git worktree
#
# Usage:
#   ./scripts/run-ft.sh <suite>     Run a test suite
#   ./scripts/run-ft.sh status      Check worktree/server status
#   ./scripts/run-ft.sh cleanup     Stop server and remove worktree
#   ./scripts/run-ft.sh --help      Show this help
#
# Suites: lla, lla-regular, lla-pda, payment-decline, intent-selection,
#         disputes, manage-address, all
#

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Globals ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_DIR")"
CONFIG_FILE="$REPO_DIR/.claude/ft-runner.json"

# Defaults (overridden by ft-runner.json if present)
PORT=3001
SERVER_CMD="npm run dev"
SERVER_TIMEOUT=90
BROWSER="electron"
RETRIES=1
CYPRESS_TIMEOUT=300000
WORKTREE_DIR="$(dirname "$REPO_DIR")/${REPO_NAME}-ft-runner"
CLEANUP_ON="success"

# ── Spec Patterns (defaults, loaded into SUITE_NAMES/SUITE_SPECS arrays) ──
SUITE_NAMES=()
SUITE_SPECS=()

add_suite() { SUITE_NAMES+=("$1"); SUITE_SPECS+=("$2"); }

add_suite "all"              "cypress/e2e/workflows/**/*.cy.ts"
add_suite "disputes"         "cypress/e2e/workflows/disputes/**/*.cy.ts"
add_suite "intent-selection"  "cypress/e2e/workflows/intent-selection/**/*.cy.ts"
add_suite "lla"              "cypress/e2e/workflows/low-level-authentication/**/*.cy.ts"
add_suite "lla-pda"          "cypress/e2e/workflows/low-level-authentication/pda-case-creation/*.cy.ts"
add_suite "lla-regular"      "cypress/e2e/workflows/low-level-authentication/regular-lla-verification/*.cy.ts"
add_suite "manage-address"   "cypress/e2e/workflows/manage-address/**/*.cy.ts"
add_suite "payment-decline"  "cypress/e2e/workflows/payment-decline/**/*.cy.ts"

get_spec() {
  local suite="$1"
  local i
  for i in "${!SUITE_NAMES[@]}"; do
    if [[ "${SUITE_NAMES[$i]}" == "$suite" ]]; then
      echo "${SUITE_SPECS[$i]}"
      return 0
    fi
  done
  return 1
}

list_suites() {
  local i
  for i in "${!SUITE_NAMES[@]}"; do
    printf "  ${CYAN}%-20s${NC} %s\n" "${SUITE_NAMES[$i]}" "${SUITE_SPECS[$i]}"
  done
}

# ── Helper Functions ───────────────────────────────────────────────

log()   { echo -e "${CYAN}[FT]${NC} $*"; }
ok()    { echo -e "${GREEN}[FT] ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[FT] ⚠${NC} $*"; }
err()   { echo -e "${RED}[FT] ✗${NC} $*" >&2; }
header() { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

read_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    warn "No config file found at $CONFIG_FILE — using defaults"
    return
  fi

  if ! command -v jq &>/dev/null; then
    warn "jq not installed — using defaults (install jq for config support)"
    return
  fi

  log "Reading config from $CONFIG_FILE"
  PORT=$(jq -r '.port // 3001' "$CONFIG_FILE")
  SERVER_CMD=$(jq -r '.serverCommand // "npm run dev"' "$CONFIG_FILE")
  SERVER_TIMEOUT=$(jq -r '(.serverReadyTimeout // 90000) / 1000 | floor' "$CONFIG_FILE")
  BROWSER=$(jq -r '.cypress.browser // "electron"' "$CONFIG_FILE")
  RETRIES=$(jq -r '.cypress.retries // 1' "$CONFIG_FILE")
  CYPRESS_TIMEOUT=$(jq -r '.cypress.timeout // 300000' "$CONFIG_FILE")
  CLEANUP_ON=$(jq -r '.worktree.cleanupOn // "success"' "$CONFIG_FILE")

  # Read worktree directory pattern
  local wt_dir
  wt_dir=$(jq -r '.worktree.directory // "../{repo}-ft-runner"' "$CONFIG_FILE")
  wt_dir="${wt_dir//\{repo\}/$REPO_NAME}"
  # Resolve relative to repo dir
  if [[ "$wt_dir" == ../* ]]; then
    WORKTREE_DIR="$(dirname "$REPO_DIR")/${wt_dir#../}"
  else
    WORKTREE_DIR="$wt_dir"
  fi

  # Read spec patterns (overwrite defaults)
  local keys
  keys=$(jq -r '.specPatterns | keys[]' "$CONFIG_FILE" 2>/dev/null) || return
  SUITE_NAMES=()
  SUITE_SPECS=()
  for key in $keys; do
    local val
    val=$(jq -r ".specPatterns[\"$key\"]" "$CONFIG_FILE")
    add_suite "$key" "$val"
  done
}

worktree_exists() {
  [[ -d "$WORKTREE_DIR" ]]
}

server_running() {
  lsof -i :"$PORT" -sTCP:LISTEN &>/dev/null
}

get_server_pid() {
  lsof -t -i :"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

wait_for_server() {
  local elapsed=0
  log "Waiting for server on port $PORT (timeout: ${SERVER_TIMEOUT}s)..."
  while ! curl -s "http://localhost:$PORT" >/dev/null 2>&1; do
    if (( elapsed >= SERVER_TIMEOUT )); then
      err "Server failed to start within ${SERVER_TIMEOUT}s"
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf "."
  done
  echo ""
  ok "Server ready on port $PORT (${elapsed}s)"
}

cleanup_trap() {
  echo ""
  warn "Interrupted — cleaning up..."
  stop_server
  exit 130
}

stop_server() {
  local pid
  pid=$(get_server_pid)
  if [[ -n "$pid" ]]; then
    log "Stopping server (PID $pid) on port $PORT..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    # Force kill if still running
    kill -9 "$pid" 2>/dev/null || true
    ok "Server stopped"
  fi
}

show_help() {
  echo ""
  echo -e "${BOLD}FT Runner — Run Cypress tests in an isolated worktree${NC}"
  echo ""
  echo -e "${BOLD}Usage:${NC}"
  echo "  ./scripts/run-ft.sh <suite>     Run a test suite"
  echo "  ./scripts/run-ft.sh status      Check worktree/server status"
  echo "  ./scripts/run-ft.sh cleanup     Stop server and remove worktree"
  echo "  ./scripts/run-ft.sh --help      Show this help"
  echo ""
  echo -e "${BOLD}Available suites:${NC}"
  list_suites
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  ./scripts/run-ft.sh lla              # Run all LLA tests"
  echo "  ./scripts/run-ft.sh payment-decline  # Run payment decline tests"
  echo "  ./scripts/run-ft.sh all              # Run everything"
  echo ""
  echo -e "${BOLD}Config:${NC} .claude/ft-runner.json (port, browser, retries, spec patterns)"
}

# ── Commands ───────────────────────────────────────────────────────

cmd_status() {
  header "FT Runner Status"

  # Worktree
  if worktree_exists; then
    ok "Worktree exists at $WORKTREE_DIR"
    local branch commit
    branch=$(cd "$REPO_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    commit=$(cd "$WORKTREE_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    log "  Main branch: $branch"
    log "  Worktree commit: $commit"
  else
    warn "No worktree found at $WORKTREE_DIR"
  fi

  # Server
  if server_running; then
    local pid
    pid=$(get_server_pid)
    ok "Server running on port $PORT (PID $pid)"
  else
    warn "No server running on port $PORT"
  fi
}

cmd_cleanup() {
  header "FT Runner Cleanup"

  # Stop server
  if server_running; then
    stop_server
  else
    log "No server running on port $PORT"
  fi

  # Remove worktree
  if worktree_exists; then
    log "Removing worktree at $WORKTREE_DIR..."
    cd "$REPO_DIR"
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
    # Prune stale worktree refs
    git worktree prune 2>/dev/null || true
    ok "Worktree removed"
  else
    log "No worktree found at $WORKTREE_DIR"
  fi

  ok "Cleanup complete"
}

cmd_run() {
  local suite="$1"
  local spec
  spec=$(get_spec "$suite") || true

  if [[ -z "$spec" ]]; then
    err "Unknown suite: $suite"
    echo ""
    echo "Available suites:"
    local i
    for i in "${!SUITE_NAMES[@]}"; do
      echo "  ${SUITE_NAMES[$i]}"
    done
    exit 2
  fi

  trap cleanup_trap SIGINT SIGTERM

  local branch commit
  branch=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  commit=$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

  header "FT Runner — $suite"
  log "Branch: $branch ($commit)"
  log "Spec:   $spec"
  log "Port:   $PORT | Browser: $BROWSER | Retries: $RETRIES"

  # ── Step 1: Worktree ──
  if worktree_exists; then
    ok "Reusing existing worktree at $WORKTREE_DIR"
  else
    log "Creating worktree at $WORKTREE_DIR..."
    git -C "$REPO_DIR" worktree add --detach "$WORKTREE_DIR" HEAD
    ok "Worktree created"

    # ── Step 2: Dependencies ──
    log "Installing dependencies (this may take a minute)..."
    (cd "$WORKTREE_DIR" && npm install --loglevel=warn)
    ok "Dependencies installed"
  fi

  # ── Step 3: Server ──
  if server_running; then
    ok "Server already running on port $PORT"
  else
    log "Starting dev server on port $PORT..."
    (cd "$WORKTREE_DIR" && PORT=$PORT $SERVER_CMD &>/dev/null &)
    wait_for_server || exit 2
  fi

  # ── Step 4: Run tests ──
  header "Running Cypress Tests"
  local cypress_exit=0
  local results_file
  results_file=$(mktemp)

  (
    cd "$WORKTREE_DIR" && \
    CYPRESS_BASE_URL="http://localhost:$PORT" npx cypress run \
      --spec "$spec" \
      --browser "$BROWSER" \
      --config "retries=$RETRIES,defaultCommandTimeout=10000" \
      2>&1
  ) | tee "$results_file" || cypress_exit=${PIPESTATUS[0]}

  # Re-capture exit code from tee pipeline
  if grep -q "failed" "$results_file" 2>/dev/null; then
    cypress_exit=1
  fi
  if grep -q "All specs passed" "$results_file" 2>/dev/null; then
    cypress_exit=0
  fi

  # ── Step 5: Report ──
  echo ""
  header "FT RUNNER — FINAL REPORT"

  echo -e "Branch:      ${BOLD}$branch${NC} ($commit)"
  echo -e "Suite:       ${BOLD}$suite${NC}"
  echo -e "Spec:        $spec"
  echo ""

  # Parse results from Cypress output
  local passing failing
  passing=$(grep -oE '[0-9]+ passing' "$results_file" | tail -1 | grep -oE '[0-9]+' || echo "0")
  failing=$(grep -oE '[0-9]+ failing' "$results_file" | tail -1 | grep -oE '[0-9]+' || echo "0")

  if [[ "$cypress_exit" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: ALL PASSED${NC}"
    echo -e "  Passed: $passing"
  else
    echo -e "${RED}${BOLD}RESULT: $failing FAILED${NC}"
    echo -e "  Passed: ${GREEN}$passing${NC}"
    echo -e "  Failed: ${RED}$failing${NC}"

    # Show failed test names
    echo ""
    echo -e "${BOLD}Failed tests:${NC}"
    grep -E "^\s+\d+\)" "$results_file" | head -20 || true

    # Show screenshot paths
    local screenshots
    screenshots=$(grep -oE 'cypress/screenshots/[^ ]+' "$results_file" || true)
    if [[ -n "$screenshots" ]]; then
      echo ""
      echo -e "${BOLD}Screenshots:${NC}"
      echo "$screenshots" | while read -r ss; do
        echo "  - $WORKTREE_DIR/$ss"
      done
    fi
  fi

  rm -f "$results_file"

  # ── Step 6: Cleanup ──
  echo ""
  if [[ "$cypress_exit" -eq 0 && "$CLEANUP_ON" == "success" ]]; then
    log "All tests passed — auto-cleaning up..."
    stop_server
    cd "$REPO_DIR"
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
    git worktree prune 2>/dev/null || true
    ok "Worktree cleaned up"
  elif [[ "$CLEANUP_ON" == "always" ]]; then
    log "Auto-cleaning up (cleanupOn=always)..."
    stop_server
    cd "$REPO_DIR"
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
    git worktree prune 2>/dev/null || true
    ok "Worktree cleaned up"
  else
    log "Worktree kept at: $WORKTREE_DIR"
    log "Server still running on port $PORT"
    log "Run './scripts/run-ft.sh cleanup' when done"
  fi

  exit "$cypress_exit"
}

# ── Main ───────────────────────────────────────────────────────────

# Verify git repo
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  err "Not a git repository: $REPO_DIR"
  exit 2
fi

# Load config
read_config

# Parse command
case "${1:-}" in
  --help|-h|"")
    show_help
    exit 0
    ;;
  status)
    cmd_status
    ;;
  cleanup)
    cmd_cleanup
    ;;
  *)
    cmd_run "$1"
    ;;
esac
