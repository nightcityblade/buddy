#!/usr/bin/env bash
# Live proof: drives a real interactive Claude Code session (Haiku) in tmux on
# a private socket, with this checkout loaded by --plugin-dir, and reads the
# band from the pane and the /buddy replies from the transcript:
#   (a) the Professor is drawn above the prompt
#   (b) he walks: the band changes between samples while nothing is said
#   (c) /buddy pets him and counts; /buddy list marks him with *
#   (d) a /buddy question before the first reply (nothing to fork, so the
#       quip model answers) fills the bubble with an answer
#   (e) a Bash run printing a test pass shows a testPass line
#   (f) a /buddy question after a reply (a fork of the chat) is answered
#   (g) /buddy use {another} draws another character; use default returns
#   (h) /buddy off hides the band; /buddy on brings it back
#   (i) /buddy-personality opens the menu pane, the Professor marked; Down
#       moves the preview to the next entry; Esc closes it and changes nothing;
#       Enter on cat draws the cat and /buddy list marks it; /buddy use
#       default returns. HOME stays real (a fake one logs the session out), so
#       no row reads or prints the "Yours" group: hook tests prove that path.
# Prints a table, one row per check, and exits 1 when any check fails,
# 2 when the session could not be driven (no transcript, a turn timed out).
# Spends real tokens: a few cents of Haiku. It resets this plugin's own
# /buddy on and /buddy use choices (the --plugin-dir copy, buddy@inline).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN=$ROOT/plugins/buddy
CHARS=$PLUGIN/characters
if [ -z "${CLAUDE_BIN:-}" ]; then
  CLAUDE_BIN=$(command -v claude)
  if file -L -b "$CLAUDE_BIN" 2>/dev/null | grep -q text; then
    CLAUDE_BIN=$(ls -d "$HOME"/.local/share/claude/versions/* 2>/dev/null | sort -V | tail -1)
  fi
fi
[ -x "$CLAUDE_BIN" ] || { echo "ERROR no claude binary found (set CLAUDE_BIN)"; exit 2; }
command -v tmux >/dev/null || { echo "ERROR tmux not found"; exit 2; }
command -v jq >/dev/null || { echo "ERROR jq not found"; exit 2; }
[ -f "$CHARS/professor.json" ] || { echo "ERROR $CHARS/professor.json not found"; exit 2; }
OTHER=$(ls "$CHARS"/*.json | xargs -n1 basename | sed 's/\.json$//' | grep -v '^professor$' | head -1)
[ -n "$OTHER" ] || { echo "ERROR no second character in $CHARS"; exit 2; }

RUN=/tmp/buddy/run-$(date +%Y%m%dT%H%M%S)
WORK=$RUN/work
mkdir -p "$WORK"
cat > "$RUN/settings.json" <<'EOF'
{ "pluginConfigs": { "buddy@inline": { "options": { "questionMode": "fork", "quips": false, "motion": true } } } }
EOF
ID=$(uuidgen | tr 'A-Z' 'a-z')
PROJECTS=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects
T="tmux -L buddy-proof"
LOG=$RUN/drive.log
log() { echo "$(date +%T) $*" >> "$LOG"; }
echo "run dir: $RUN  session: $ID"

# Distinctive sprite rows of a character (4+ visible characters), and a line pool.
rows_of() { jq -r '[.poses[][][]] | map(gsub("^ +| +$"; "")) | map(select(length >= 4)) | unique[]' "$CHARS/$1.json"; }
pool_of() { jq -r --arg e "$2" '.lines[$e][]? | gsub(" +"; " ")' "$CHARS/$1.json"; }
rows_of professor > "$RUN/professor.rows"
rows_of "$OTHER" | grep -v -x -F -f "$RUN/professor.rows" > "$RUN/other.rows"
pool_of professor thinking > "$RUN/thinking.pool"
pool_of professor testPass > "$RUN/testpass.pool"
[ -s "$RUN/testpass.pool" ] || printf '%s\n' 'Tests pass!' 'All green.' 'It passes. Nice.' > "$RUN/testpass.pool"
[ -s "$RUN/thinking.pool" ] || printf '%s\n' 'Let me think...' 'Hmm...' 'One moment...' > "$RUN/thinking.pool"

$T kill-session -t proof 2>/dev/null
$T new-session -d -s proof -x 160 -y 50 -c "$WORK" \
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 '$CLAUDE_BIN' --model haiku --setting-sources project --settings '$RUN/settings.json' \
   --allowedTools Bash --plugin-dir '$PLUGIN' --session-id $ID"
trap '$T capture-pane -p -t proof -S -300 > "$RUN/pane.txt" 2>/dev/null; $T kill-server 2>/dev/null' EXIT
# Boot: the trust dialog defaults to "No, exit", so Down then Enter.
for _ in $(seq 1 30); do
  sleep 1
  pane=$($T capture-pane -p -t proof)
  if grep -q -i 'trust' <<<"$pane"; then $T send-keys -t proof Down; sleep 1; $T send-keys -t proof Enter; log "trust accepted"; sleep 3; fi
  if grep -q -E 'Enter to confirm' <<<"$pane"; then $T send-keys -t proof Enter; log "confirm accepted"; sleep 3; fi
  grep -q -E '^ *(>|❯) ' <<<"$pane" && ! grep -q -i -E 'trust|Enter to confirm' <<<"$pane" && break
done
$T capture-pane -p -t proof > "$RUN/boot.txt"

transcript() { find "$PROJECTS" -maxdepth 2 -name "$ID.jsonl" 2>/dev/null | head -1; }
pane() { $T capture-pane -p -t proof; }
# The bubble's text: what sits between the round border's side bars, joined.
bubble() { pane | grep '│' | sed -n 's/.*│ *\(.*[^ ]\) *│.*/\1/p' | tr '\n' ' ' | tr -s ' '; }
shows_any() { local p; p=$(pane); while IFS= read -r r; do [ -n "$r" ] && grep -q -F -- "$r" <<<"$p" && return 0; done < "$1"; return 1; }
bubble_has_any() { local b; b=$(bubble); while IFS= read -r l; do [ -n "$l" ] && grep -q -F -- "$l" <<<"$b" && return 0; done < "$1"; return 1; }
send() { $T send-keys -t proof -l "$1"; sleep 1; $T send-keys -t proof Enter; log "<- $1"; }
# Each /buddy reply as one line (a multi-line reply joined by " / ").
stdout_rows() {
  local f; f=$(transcript); [ -n "$f" ] || return 0
  jq -r 'select(.type=="system" or .type=="user") | (.content // .message.content // "") | strings
    | select(contains("<local-command-stdout>")) | capture("<local-command-stdout>(?<o>[\\s\\S]*?)</local-command-stdout>").o
    | gsub("\n"; " / ")' "$f"
}
# A slash command: its output row from the transcript, or fail loudly.
command_out() {
  local before; before=$(stdout_rows | wc -l)
  send "$1"
  for _ in $(seq 1 20); do
    sleep 1
    [ "$(stdout_rows | wc -l)" -gt "$before" ] && { stdout_rows | tail -n +"$((before + 1))" | tr '\n' ' '; log "done $1"; return 0; }
  done
  echo "ERROR $1 printed no output row; pane in $RUN/pane.txt" >&2; exit 2
}
# Waits for the bubble to hold an answer: not empty, no thinking line, no lost thread.
answered() {
  for _ in $(seq 1 60); do
    sleep 1
    b=$(bubble)
    if grep -q 'lost the thread' <<<"$b"; then echo "LOST: $b"; return 1; fi
    [ -n "$b" ] && ! bubble_has_any "$RUN/thinking.pool" && { echo "$b"; return 0; }
  done
  echo "TIMEOUT: $(bubble)"; return 1
}

fail=0
row() { local name=$1 verdict=$2 got=$3; printf '| %-46s | %-4s | %s |\n' "$name" "$verdict" "${got:0:90}"; }
results=()
# Not in a subshell: a FAIL must reach the exit code.
add() { [ "$2" = PASS ] || fail=1; results+=("$(row "$@")"); }

command_out "/buddy on" >/dev/null
command_out "/buddy use default" >/dev/null
sleep 2
if shows_any "$RUN/professor.rows"; then add "(a) the Professor is drawn" PASS "sprite row in the pane"; else add "(a) the Professor is drawn" FAIL "no professor row"; fi
pane > "$RUN/a.txt"

sleep 8
s1=$(pane | grep -F -f "$RUN/professor.rows"); sleep 2; s2=$(pane | grep -F -f "$RUN/professor.rows"); sleep 2; s3=$(pane | grep -F -f "$RUN/professor.rows")
if [ -n "$s1" ] && { [ "$s1" != "$s2" ] || [ "$s2" != "$s3" ]; }; then add "(b) he walks" PASS "the band changed across samples"; else add "(b) he walks" FAIL "no change in 4 s"; fi

out=$(command_out "/buddy")
if grep -q -E ': [0-9]+ pets' <<<"$out"; then add "(c) /buddy pets" PASS "$out"; else add "(c) /buddy pets" FAIL "$out"; fi
out=$(command_out "/buddy list")
if grep -q '\* professor' <<<"$out"; then add "(c) /buddy list marks the current one" PASS "$(grep -o '\* professor[^*]*' <<<"$out" | head -c 60)"; else add "(c) /buddy list marks the current one" FAIL "$out"; fi

out=$(command_out "/buddy what is your favourite tool")
got=$(answered); v=$?
[ $v -eq 0 ] && grep -q 'Asked' <<<"$out" && add "(d) question before a reply (quip model)" PASS "$got" || add "(d) question before a reply (quip model)" FAIL "$out / $got"

send "Run this Bash command: echo 'Tests: 3 passed'. Then reply with exactly: T1"
seen=""
for _ in $(seq 1 180); do
  sleep 0.5
  [ -z "$seen" ] && bubble_has_any "$RUN/testpass.pool" && { seen=$(bubble); pane > "$RUN/e.txt"; }
  f=$(transcript)
  [ -n "$f" ] && jq -e 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | select(.text|contains("T1"))' "$f" >/dev/null 2>&1 && [ -n "$seen" ] && break
done
[ -n "$(transcript)" ] || { echo "ERROR no transcript for $ID under $PROJECTS"; exit 2; }
if [ -n "$seen" ]; then add "(e) a test pass shows a testPass line" PASS "$seen"; else add "(e) a test pass shows a testPass line" FAIL "no testPass line seen"; fi
sleep 7

out=$(command_out "/buddy what did we just run")
got=$(answered); v=$?
[ $v -eq 0 ] && add "(f) question after a reply (fork)" PASS "$got" || add "(f) question after a reply (fork)" FAIL "$out / $got"

out=$(command_out "/buddy use $OTHER")
sleep 3
if shows_any "$RUN/other.rows"; then add "(g) /buddy use $OTHER draws it" PASS "$out"; else add "(g) /buddy use $OTHER draws it" FAIL "$out"; fi
out=$(command_out "/buddy use default"); sleep 3
if shows_any "$RUN/professor.rows"; then add "(g) /buddy use default returns" PASS "$out"; else add "(g) /buddy use default returns" FAIL "$out"; fi

out=$(command_out "/buddy off"); sleep 3
if ! shows_any "$RUN/professor.rows"; then add "(h) /buddy off hides" PASS "$out"; else add "(h) /buddy off hides" FAIL "still drawn"; fi
out=$(command_out "/buddy on"); sleep 3
if shows_any "$RUN/professor.rows"; then add "(h) /buddy on shows" PASS "$out"; else add "(h) /buddy on shows" FAIL "not drawn"; fi

# The menu lists characters/ sorted by id: Up from the Professor's row reaches cat.
IDS=$(ls "$CHARS"/*.json | xargs -n1 basename | sed 's/\.json$//' | sort)
PICK=cat
grep -q -x "$PICK" <<<"$IDS" || { echo "ERROR no $PICK.json in $CHARS"; exit 2; }
ups=$(( $(grep -n -x professor <<<"$IDS" | cut -d: -f1) - $(grep -n -x "$PICK" <<<"$IDS" | cut -d: -f1) ))
NEXT=$(grep -A1 -x professor <<<"$IDS" | tail -1)
rows_of "$PICK" | grep -v -x -F -f "$RUN/professor.rows" > "$RUN/pick.rows"
# The start of a persona as the preview's one line shows it.
persona_of() { jq -r '.persona | gsub("\\s+"; " ") | .[0:40]' "$CHARS/$1.json"; }
PROF_NAME=$(jq -r '.name' "$CHARS/professor.json")
in_pane() { pane | grep -q -F -- "$1"; }
out=$(command_out "/buddy-personality"); sleep 3
pane > "$RUN/i-open.txt"
if in_pane "* $PROF_NAME (professor)" && in_pane "Shipped" && in_pane "Your folder" && in_pane "$(persona_of professor)"; then
  add "(i) /buddy-personality opens the menu" PASS "$out"
else add "(i) /buddy-personality opens the menu" FAIL "$out / pane in $RUN/i-open.txt"; fi
$T send-keys -t proof Down; sleep 2
pane > "$RUN/i-down.txt"
if in_pane "$(persona_of "$NEXT")" && ! in_pane "$(persona_of professor)"; then add "(i) Down moves the preview to $NEXT" PASS "preview shows the $NEXT persona"
else add "(i) Down moves the preview to $NEXT" FAIL "pane in $RUN/i-down.txt"; fi
$T send-keys -t proof Escape; sleep 2
pane > "$RUN/i-esc.txt"
if ! in_pane "$(persona_of "$NEXT")" && ! in_pane "Your folder" && shows_any "$RUN/professor.rows"; then add "(i) Esc closes it, nothing changed" PASS "pane gone, the Professor still drawn"
else add "(i) Esc closes it, nothing changed" FAIL "pane in $RUN/i-esc.txt"; fi
command_out "/buddy-personality" >/dev/null; sleep 3
for _ in $(seq 1 "$ups"); do $T send-keys -t proof Up; sleep 0.5; done
sleep 1
if in_pane "$(persona_of "$PICK")"; then pre=ok; else pre="no $PICK preview"; fi
$T send-keys -t proof Enter; sleep 3
pane > "$RUN/i-pick.txt"
if [ "$pre" = ok ] && shows_any "$RUN/pick.rows" && ! in_pane "Your folder"; then add "(i) Enter on $PICK draws it, pane closed" PASS "$PICK sprite row in the pane"
else add "(i) Enter on $PICK draws it, pane closed" FAIL "$pre / pane in $RUN/i-pick.txt"; fi
out=$(command_out "/buddy list")
if grep -q "\* $PICK " <<<"$out"; then add "(i) /buddy list marks $PICK" PASS "$(grep -o "\* $PICK[^*]*" <<<"$out" | head -c 60)"; else add "(i) /buddy list marks $PICK" FAIL "$out"; fi
out=$(command_out "/buddy use default"); sleep 3
if shows_any "$RUN/professor.rows"; then add "(i) /buddy use default returns" PASS "$out"; else add "(i) /buddy use default returns" FAIL "$out"; fi

cp "$(transcript)" "$RUN/main.jsonl"
echo
echo "| check | verdict | evidence |"
echo "| --- | --- | --- |"
printf '%s\n' "${results[@]}"
echo "evidence: $RUN"
exit $fail
