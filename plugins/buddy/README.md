# buddy

A tiny companion that walks on your Claude Code prompt line and talks back: Quack the duck by default, six more characters built in (`professor`, `cat`, `robot`, `ghost`, `dragon`, `yellow-duck`), or your own.

```text
/buddy                  pet it
/buddy off | on         hide or show it, remembered
/buddy reload           rescan the characters after you edit one
/buddy help             usage
/buddy {question}       a one-line answer, in character
/buddy-personality      see every character and switch, remembered, with a live preview
```

It reacts to the work: a failed tool call, a test run passing or failing. A question forks this chat by default, so the answer sees the conversation and reads its prompt cache; the options `questionMode`, `quips`, `quipModel` and `quipCooldownSec` decide what spends tokens, and `memory` (default 6, 0 = off, at most 30) how many recent exchanges it remembers, a question with its answer or a line it said on its own, per session and per character. Your own characters are JSON files in the folder the `characterDir` option names.

## Pick a personality

`/buddy-personality` opens a menu with a live preview of the highlighted entry, in three groups: the shipped characters; yours, the companion Claude Code's removed `/buddy` hatched for your account (read from `~/.claude.json` or a backup of it, never written), listed as the native and the npm install rolled it; and your `characterDir` folder. ↑/↓ move, Enter switches and remembers it across `/reload` and restarts, Esc closes and changes nothing.

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and draws in the terminal and the desktop app. The full documentation and the character guide live in the repository: https://github.com/rezzminator/buddy

Built and maintained with [Professor](https://github.com/rezzminator/professor).
