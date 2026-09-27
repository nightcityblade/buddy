# Verification

buddy runs inside the prompt line of everyone who installs it, so a change lands only after it is proven at three depths: pure unit tests, hook tests of the real adapter, and a live session.
Each gate below says what it proves and what it prints when it fails; a gate that cannot run says so and never passes.

## The gates

| Gate | Command | Proves | Broken, it reports |
| --- | --- | --- | --- |
| Unit tests | `npm run test:unit` (vitest over `tests/`) | every decision in `plugins/buddy/src/` | the failing test by name; a hatch mismatch lists each vector as `#i (id length n): got …, want …` |
| Hook tests | `npm run test:hooks` (`claude plugin test plugins/buddy`) | the adapter wired to Claude Code's own testing kit, over an in-memory world | the failing test by name |
| Typecheck | `npm run typecheck` (`tsc`, then `tsc -p tsconfig.hooks.json`) | the engine, the tests and the adapter against `types/claude-code.d.ts` | each type error by file and line |
| Validate | `npm run validate:plugin` (`claude plugin validate --strict`, the repo and the plugin) | both manifests, and the rule on `$` | the violation; a broken `$` rule would otherwise load the module with zero hooks |
| Release check | `scripts/release-check.sh [main's version]` | the version agrees in `plugin.json`, `marketplace.json`, `package.json` and the README badge; `CHANGELOG.md` has a dated section; the version moved past `main`'s | one `FAIL` line per disagreement and exit 1; `ERROR` and exit 2 when a file cannot be read |
| Live proof | `npm run live` (`scripts/live-proof.sh`) | a real session draws, walks, answers, switches, hides, runs the menu and remembers | a table with a `FAIL` row per failed check and its evidence, exit 1; `ERROR` and exit 2 when the session cannot be driven |
| CI | `.github/workflows/ci.yml` | `npm test`, the typecheck and the validation on every push to `develop` or `main` and every pull request; the release check on a pull request into `main` | the failed step |
| No leaks | a rule in `CLAUDE.md`, checked with a grep before a commit | no machine-absolute path and no personal data in a tracked file | the matching line |

The hook tests and the validation need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, as a real session does.
`npm test` runs the unit tests, then the hook tests.

## The live proof

The script drives a real, interactive Claude Code session and reads the screen.

- **The session.** tmux on a private socket (`-L buddy-proof`), a 160 × 50 window, never your own tmux server. The real Claude binary (`CLAUDE_BIN`, else `claude` resolved past a text wrapper), with `--model haiku --setting-sources project --allowedTools Bash --plugin-dir plugins/buddy`, a fresh `--session-id`, and function hooks on.
- **The options.** A settings file pins them under `buddy@inline`, the id a `--plugin-dir` copy reads: `questionMode: fork`, `quips: false`, `motion: true`.
- **The boot.** The trust dialog defaults to "No, exit", so the script presses Down, then Enter.
- **What it reads.** What is drawn, from the pane (`tmux capture-pane`). The art to look for, from the characters' own JSON: rows of four or more visible characters, and for a second character only rows the Professor lacks. The bubble, as the text between the round border's bars. Each command's reply, from the session transcript's `<local-command-stdout>`, so a reply is read as data, not scraped.
- **The evidence.** A timestamped run directory keeps every pane capture, the drive log and a copy of the transcript; each row of the table prints the evidence it saw.

It spends a few cents of Haiku, and resets this plugin copy's `/buddy on` and `/buddy use` choices.

| Row | Drives | Passes when |
| --- | --- | --- |
| (a) the Professor is drawn | `/buddy on`, `/buddy use default` | a row of `professor.json`'s art is in the pane |
| (b) he walks | nothing; three samples 2 s apart, after the greeting | the Professor's rows change between samples |
| (c) `/buddy` pets | `/buddy` | the reply reads `{name}: N pets` |
| (c) `/buddy list` marks the current one | `/buddy list` | `* professor` in the reply |
| (d) question before a reply | `/buddy what is your favourite tool`, before the chat's first reply, so the quip model answers | the reply says `Asked`, and the bubble holds an answer: not empty, not a `thinking` line, not "lost the thread" |
| (e) a test pass shows a `testPass` line | a prompt asking Claude to run `echo 'Tests: 3 passed'` | a line of the Professor's `testPass` pool shows in the bubble |
| (f) question after a reply | `/buddy what did we just run`, a real fork of the chat | the bubble holds an answer |
| (g) `/buddy use {other}` draws it | the first other character by id | a row unique to its art is in the pane |
| (g) `/buddy use default` returns | `/buddy use default` | the Professor's rows are back |
| (h) `/buddy off` hides | `/buddy off` | no Professor row in the pane |
| (h) `/buddy on` shows | `/buddy on` | the Professor's rows are back |
| (i) the menu opens | `/buddy-personality` | `* {name} (professor)`, `Shipped`, `Your folder` and the Professor's description in the pane, never its persona prompt |
| (i) Down moves the preview | Down | the preview shows the next entry, no longer the Professor |
| (i) Esc closes it, nothing changed | Esc | the preview and the groups are gone; the Professor is still drawn |
| (i) Enter on `cat` draws it | the menu again, Up to `cat`, Enter | `cat`'s preview showed first; its art is in the band; the pane is gone |
| (i) `/buddy list` marks `cat` | `/buddy list` | `* cat` in the reply |
| (i) `/buddy use default` returns | `/buddy use default` | the Professor's rows are back |
| (j) `/buddy remember the word pineapple` | that question | the reply says `Asked`, and the bubble holds an answer |
| (j) the next answer remembers `pineapple` | `/buddy what word did I ask you to remember?` | the answer holds `pineapple` |
| (j) the store holds this session's memory | nothing; the plugin's store file is read | its `memory:{session}` record holds the exchanges, no `thinking` filler |

### Why there is no fake HOME

A fake HOME would let the proof plant an invented `~/.claude.json` and check the "Yours" group live.
But a session started with a fake HOME is logged out, and a logged-out session answers no question.
So the proof keeps the real HOME and never reads or prints the "Yours" group, which would show a real account's companion.
The hook tests prove that path instead, with an invented `~/.claude.json` and backups served from memory.

## Bugs the gates caught

- **A flaky random rest.** The hook test "walks once the greeting ends" waits out the greeting, then expects the band to change within one second. Its fixture character had the default `restChance` of 0.02, so some runs rolled a rest that covered that second and saw no step. The adapter passes `Math.random`, which a hook test cannot seed, so the fixture now sets `restChance: 0` ("a test that waits for a step must see one"), and the test passes every run.
- **"3 passed; 0 failed" read as a failure.** The fail pattern matched any count, so a clean `cargo test` summary set off `oops` and a `testFail` line. Both patterns now need a non-zero count (`[1-9]\d*`). The regression tests (a zero count is not a fail, a zero count is not a pass, a cargo run with 0 failed is a pass) were watched failing against the old patterns before the fix.

## Known gaps

Named here, so none reads as a pass:

- Quips run only in unit tests; the live proof runs with `quips: false`.
- Sleep is proven in unit tests only; the live proof would have to run after midnight.
- The hover card needs a terminal that reports the mouse; it is unit-tested, not tried live.
- "Yours" is proven by hook tests only (no fake HOME, above).

## Decisions

- **A real session, on Haiku.** Rejected: mocks alone. The testing kit cannot press a person's Esc or show that Claude Code really draws the band, and a fork needs a real chat. Haiku keeps a run to cents.
- **Exit 2 apart from exit 1.** Rejected: one failure code. "Could not drive the session" and "a check failed" are different news.
- **Replies from the transcript, drawing from the pane.** Rejected: scraping replies off the screen, where they wrap and scroll.
- **The real HOME.** Rejected: a fake one, which logs the session out.
- **A private tmux socket and `--plugin-dir`.** Rejected: your own tmux and the installed copy. The proof tests this checkout and touches nothing else.
- **Inline fixture characters in unit and hook tests.** Rejected: the shipped files. A change to the art never breaks an engine test.
- **Randomness removed from the fixture.** Rejected: retrying a flaky test. A test that passes on a second try proves nothing.

## Where it lives

| File | What |
| --- | --- |
| [`package.json`](../../package.json) | the `test`, `test:unit`, `test:hooks`, `typecheck`, `validate:plugin`, `release:check` and `live` scripts |
| [`tests/`](../../tests/) | one vitest file per engine concern, [`fixtures.ts`](../../tests/fixtures.ts), the hatch fixtures |
| [`plugins/buddy/tests/buddy.test.tsx`](../../plugins/buddy/tests/buddy.test.tsx) | the hook tests; `world` answers `$.fs`, `$.store`, `$.clock`, `$.model` and the rest from memory |
| [`scripts/live-proof.sh`](../../scripts/live-proof.sh) | the live proof |
| [`scripts/release-check.sh`](../../scripts/release-check.sh) | the release check |
| [`scripts/gen-wyhash-fixture.mjs`](../../scripts/gen-wyhash-fixture.mjs) | regenerates the Bun cross-check fixture |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`release.yml`](../../.github/workflows/release.yml) | CI, and the GitHub release on a `buddy--v*` tag |

## How it's tested

The gates are held to their own standard: a regression test counts only once it was watched failing against the unfixed code, and whoever lands a change re-reads a live verdict from the saved evidence, not from the table alone.
