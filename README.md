<div align="center">

# buddy

**A tiny companion that walks on your Claude Code prompt line and talks back: the Professor by default, five more characters built in, or your own.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![CI](https://github.com/rezzminator/buddy/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/rezzminator/buddy/actions/workflows/ci.yml)
[![Built with Professor](https://img.shields.io/badge/built%20with-Professor-8A2BE2)](https://github.com/rezzminator/professor)

</div>

```text
   _A_           _A_           _A_    ╭────────────────────────╮
  (o.o)         (o.o)c        (^.^)   │ Oh, this one's *nice*. │
  /|_|\c        /|_|\         \|_|/c  ╰────────────────────────╯
   / \           | |           | |
  walking       a sip         tests pass
```

---

In April 2026 Claude Code shipped `/buddy`, an April Fools companion that
sat beside the prompt and commented on your work in a speech bubble.
Version 2.1.97 removed it on April 9, and the server that wrote its
reactions went quiet the next day.

**buddy** brings a companion back as a plugin. It lives inside Claude Code's
own interface, on the line right above the prompt, sees every tool call as it
happens, and answers you through Claude Code's own model calls: there is no
buddy server to go quiet.

- 🚶 **Lives on your prompt line.** It walks back and forth above the prompt,
  stops now and then to rest (the Professor sips his tea), stands
  still while Claude works, and falls asleep after midnight.
- 🎉 **Reacts to the work.** A failed or denied tool call gets an "oops"; a
  test run passing in a Bash command gets a cheer and a burst of confetti; a
  failing one gets an "oops" of its own.
- 💬 **Talks back.** `/buddy why is this slow?` gets a one-line answer, in
  character. By default the question forks this chat: the same model, the
  whole conversation in view, served from its prompt cache.
- 🎭 **Six characters, and yours.** Pick one with `/buddy use`, or draw your
  own: a JSON file with a persona and a few poses of ASCII art.
- 🤫 **Free unless you ask.** Walking, petting, switching and reactions never
  call a model. Only a question you ask, and quips if you turn them on,
  spend tokens.
- 🛡️ **Never in the way.** A character that fails to load is replaced by the
  Professor, who says why; a hook that fails logs the error and steps aside.
  `/buddy off` hides it, and it stays hidden across restarts.

## 🚀 Quick start

```sh
# 1. Turn on function hooks
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1

# 2. Install
claude plugin marketplace add rezzminator/buddy
claude plugin install buddy@buddy
```

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` also works in the `env` block of
`settings.json`. Start a new session and the Professor walks in above your
prompt; type `/buddy` to pet him.

> **Early access.** buddy is built on Claude Code's function hooks, an
> early-access surface that may change between releases. A plugin built on
> function hooks cannot enter the official plugin directory, so buddy
> installs from this repository's own marketplace, as above. It is tested on
> Claude Code 2.1.283.

> **Where it shows.** The line above the prompt exists in Claude Code in the
> terminal and in the desktop app. The VS Code extension and mobile do not
> draw it, so there the character never appears.

## 🧭 Commands

| Command | What it does |
| --- | --- |
| `/buddy` | Pet it: a happy pose, a line, and the count so far (`Professor: 3 pets`). |
| `/buddy list` | Every character: `*` marks the current one, `(yours)` one from your `characterDir`, `INVALID: {error}` one that failed to load. |
| `/buddy use {id}` | Switch now, and remember it. An unknown id lists the valid ones. |
| `/buddy use default` | Forget the `/buddy use` choice and go back to the `character` option. |
| `/buddy off` / `/buddy on` | Hide or show it, remembered across restarts. |
| `/buddy reload` | Rescan the characters, after you edit one. |
| `/buddy help` | Usage. |
| `/buddy {anything else}` | A question: it thinks, then answers in one line, in character (see `questionMode`). |

## 🎭 Characters

| id | |
| --- | --- |
| `professor` | A warm, precise professor with a cup of tea. The default companion. |
| `duck` | A listening duck: explain your bug out loud, get a quack back. |
| `cat` | An aloof cat who supervises your terminal and pretends not to care. |
| `robot` | A literal little robot on one wheel that reports exactly what happened. |
| `ghost` | A gentle ghost that drifts along your prompt line, softly spooky. |
| `dragon` | A very small dragon with very large pride, guarding your code. |

The choice is, in order: your last `/buddy use`, then the `character`
option, then `professor`. Your own characters sit beside these, and one with
a built-in's id replaces it.

## 🧠 How it works

- **Walking.** The character steps one column every `stepMs` (200 ms unless
  the character says otherwise), turns at the edge, and rests now and then.
  It stops walking while a bubble is up. With the `motion` option off, or a
  character that does not walk, it stands still and its frames still
  animate.
- **While Claude works** it draws its `working` pose and stands still. From
  midnight to 6 am, after a minute with nothing happening, it falls asleep
  with a `z Z` drifting above it; anything that happens wakes it up.
- **Reactions.** A tool call that fails or is denied: the `oops` pose and a
  line. The output of a Bash command that reads like a test pass (`12
  passed`, `3 passing`, `PASS`, `Tests: 5 passed`, a line starting `ok`):
  the `yay` pose, a line and two seconds of confetti. One that reads like a
  failure (`2 failed`, `1 failing`, `FAILED`, a line starting `FAIL` or
  `--- FAIL`): the `oops` pose and a line. A failure pattern always wins.
- **The bubble** is one line in a rounded box beside the character, opening
  toward the free side. A line stays 6 seconds, a model answer 15. Below 40
  columns the bubble and the confetti are left out, and a terminal too
  narrow for the sprite leaves it out as well.
- **Hover card.** Hover over the character to see its name, description,
  pets, mood and the questions asked this session. It needs a terminal that
  reports the mouse; elsewhere the card never shows.
- **Questions.** In `fork` mode (the default) `/buddy {question}` replays
  this chat's own request with the question added, so it runs on the chat's
  model, sees the whole conversation, and reads the prefix from the chat's
  prompt cache instead of writing it again. Before the chat's first reply
  there is nothing to fork, and the question goes to `quipModel` alone. In
  `complete` mode every question goes to `quipModel` alone, without the
  conversation; `off` turns questions off. A question that fails shows why
  in the bubble.
- **Quips** (off by default). At the end of a turn that used at least one
  tool, and no sooner than `quipCooldownSec` after the last one,
  `quipModel` writes a one-line reaction to the turn: the tools it used,
  how many failed, and the last Bash command.
- **Errors are never silent.** A chosen character that is missing or invalid
  draws the Professor with a bubble `Couldn't load {id}: {error}` for 10
  seconds, and `/buddy list` names the error.

## ⚙️ Configuration

Set these through `/config`, or under `pluginConfigs["buddy@buddy"].options`
in `settings.json`. The key must be the full plugin id: Claude Code silently
ignores options under any other key.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `character` | string | `"professor"` | Character id (see /buddy list) |
| `characterDir` | directory | `""` | Folder of your own character JSON files |
| `motion` | boolean | `true` | Walk along the prompt line |
| `questionMode` | string | `"fork"` | /buddy questions: fork (sees the chat, uses its cache), complete, or off |
| `quips` | boolean | `false` | Model-written one-liners at the end of a turn (spends tokens) |
| `quipModel` | string | `"haiku"` | Model for quips and fresh-session answers |
| `quipCooldownSec` | number | `45` | Minimum seconds between quips |

```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" },
  "pluginConfigs": {
    "buddy@buddy": {
      "options": { "character": "robot", "characterDir": "/path/to/my-characters", "quips": true }
    }
  }
}
```

## 🎨 Your own character

A character is one JSON file, `{id}.json`, checked against
[`plugins/buddy/schema/character.schema.json`](./plugins/buddy/schema/character.schema.json).
Put yours in a folder, point `characterDir` at it, and `/buddy reload`.

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `$schema` | string | no | `"../schema/character.schema.json"` in built-ins |
| `id` | string, `^[a-z0-9][a-z0-9-]{0,31}$` | yes | unique; `/buddy use {id}` |
| `name` | string ≤ 40 | yes | display name |
| `description` | string ≤ 100 | yes | one line for `/buddy list` |
| `author` | string ≤ 60 | no | credit |
| `persona` | string ≤ 1200 | yes | the character's voice prompt, 2nd person ("You are …") |
| `color` | Ink color name or `#rrggbb` | no | sprite color, default `"yellow"` |
| `poses` | object | yes | pose name → array of frames; frame = array of rows (strings) |
| `lines` | object | no | event name → array of canned one-liners (≤ 120 chars each) |
| `motion` | object | no | `walk` (bool, default true), `stepMs` (80–1000, default 200), `restChance` (0–0.2, default 0.02), `restTicks` (1–100, default 15) |

[CONTRIBUTING.md](./CONTRIBUTING.md) has the rest of the contract (the
poses and their fallbacks, the line events, the rules for the art), a
working example, how to test it, and how to send it in to ship with buddy.

## ❓ FAQ

<details>
<summary><b>Is this the <code>/buddy</code> that Claude Code removed?</b></summary>

No. buddy is an independent plugin, not a patch to Claude Code or a revival
of the removed code. You choose the character instead of hatching one from
your account, and its reactions come from its own lines and from your own
model calls, not from a server.
</details>

<details>
<summary><b>Does it cost tokens?</b></summary>

Only when a model answers. Walking, reactions, petting and every command
except a question are local. A question in `fork` mode runs on the chat's
own model and reads the conversation from its prompt cache; `complete` mode
sends only the question to `quipModel`. Quips are off until you turn them
on.
</details>

<details>
<summary><b>I installed it and nothing shows.</b></summary>

Check that `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` was set before Claude Code
started, that you are in the terminal or the desktop app (the VS Code
extension and mobile do not draw the line above the prompt), that the
window is wide enough for the character, and that `/buddy on` is in effect.
</details>

<details>
<summary><b>Why is my buddy asleep?</b></summary>

From midnight to 6 am, local time, it falls asleep after a minute with
nothing happening. Anything that happens wakes it.
</details>

<details>
<summary><b>My character shows as INVALID.</b></summary>

`/buddy list` prints the first error in the file. Fix it, save, and run
`/buddy reload`.
</details>

## 🛠️ Development

```sh
npm install
npm test              # unit tests (vitest) and function-hook tests (claude plugin test)
npm run typecheck
npm run validate:plugin
npm run live          # live proof in tmux, spends a few cents of Haiku
```

Work lands on `develop`; `main` holds only releases, and each one is tagged
`buddy--vX.Y.Z` with its notes in [CHANGELOG.md](./CHANGELOG.md). Pull
requests go to `develop`; [CONTRIBUTING.md](./CONTRIBUTING.md) covers both
characters and code.

`plugins/buddy/hooks/buddy.tsx` is a thin adapter over `plugins/buddy/src/`,
where every decision is a pure, unit-tested module.

## 🎓 Built with Professor

buddy is built and maintained with [Professor](https://github.com/rezzminator/professor), a fleet controller and discipline layer for Claude Code, Codex and OpenCode: chats that message each other, agents held to the project's rules, and gated releases. The default character is its namesake.

## License

MIT

<sub>Keywords: Claude Code buddy · /buddy · Claude Code companion · terminal pet · ASCII pet · tamagotchi · speech bubble · Claude Code plugin · function hooks · Claude Mods · custom characters</sub>
