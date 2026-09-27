# Changelog

Every release of buddy. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `buddy--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

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
