# Changelog

Every release of buddy. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `buddy--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

## [0.2.1] — 2026-09-27

### Added
- Yellow Duck (`yellow-duck`): the bright yellow duck of 0.1.0, kept as a character of its own now that Quack is the default duck.
- Community files: CODE_OF_CONDUCT, SECURITY, SUPPORT, issue and pull request templates, and a social preview.

### Changed
- The README leads with Quack the duck: a demo of its real frames and lines, why buddy, help and contributing.

## [0.2.0] — 2026-09-27

### Added
- `/buddy-personality`: a menu in a focused pane. The entries sit on the left in three titled groups, Shipped, Yours and Your folder, with `*` on the one drawn now; the right shows a live preview of the highlighted one: its sprite in its idle animation, its name, its description (for an original, its personality) and its greeting. ↑/↓ move the highlight and the preview follows; Enter switches to it and remembers it, across `/reload` and restarts; Esc closes the menu and changes nothing.
- Yours: the companion Claude Code's own `/buddy` hatched for your account before version 2.1.97 removed it. The menu reads `~/.claude.json` (never writes it), or the newest `~/.claude.json` backup that holds a companion, and lists it twice, as the native and the npm install rolled it: the same species, rarity, eyes, hat, shiny and stats, drawn with buddy's own art for all 18 species. A file that cannot be read or parsed is said in one line in the group, never shown as an empty one.
- An original companion wears its rarity's color; a shiny one cycles through the rainbow with a sparkle. Its preview and hover card show the stars, five stat bars and the day it hatched. Once picked, its name, personality and roll are saved, so a restart draws it without looking through backups; the menu marks it with `*` when it is drawn. The account id is never saved or logged.
- `schema/species.schema.json`, the contract of a species template and its hat art.
- A short memory: the last `memory` exchanges (option, default 6, 0 = off, at most 30), each a `/buddy` question with its answer or a line its bubble showed on its own (a canned line or a quip, never the thinking filler), kept per session and per character across `/reload`, go before the question in its next answer or quip, so it can refer back to them; no extra model call.

### Changed
- `/buddy list` and `/buddy use {id}` (with `/buddy use default`) are folded into `/buddy-personality`, now the one way to see the characters and switch; to go back to the `character` option's character, pick it there. A character that fails to load says `/buddy-personality picks another`.
- The default character, and the fallback when a chosen one fails to load, is now the duck, Quack; the Professor stays a shipped character, no longer the default.

## [0.1.0] — 2026-09-27

### Added
- A companion on the line above the Claude Code prompt: an ASCII character that walks, pauses to rest, stands still while Claude works, sleeps after midnight, and speaks in a one-line speech bubble. It draws in the terminal and the desktop app.
- Reactions: a failed or denied tool call, and test results in Bash output (pass or fail), change its pose and bring a line; a test pass sets off a short burst of confetti. Hovering the sprite shows a card with its name, description, pets, mood and the questions asked this session.
- `/buddy`: pet it (`/buddy`), list the characters (`/buddy list`), switch (`/buddy use {id}`, `/buddy use default`), hide and show (`/buddy off`, `/buddy on`), rescan the characters (`/buddy reload`), usage (`/buddy help`), and ask it anything else (`/buddy {question}`) for a one-line answer in character.
- Six built-in characters: `professor` (the default), `duck`, `cat`, `robot`, `ghost` and `dragon`.
- Your own characters: JSON files in the folder the `characterDir` option names, checked against `plugins/buddy/schema/character.schema.json`; an invalid one is listed with its first error, and choosing it draws the Professor with a bubble naming the error.
- Options `character`, `characterDir`, `motion`, `questionMode` (`fork`, `complete` or `off`), `quips` (off by default), `quipModel` and `quipCooldownSec`.

[Unreleased]: https://github.com/rezzminator/buddy/compare/buddy--v0.1.0...develop
[0.1.0]: https://github.com/rezzminator/buddy/releases/tag/buddy--v0.1.0
