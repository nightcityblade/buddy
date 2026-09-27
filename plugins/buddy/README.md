# buddy

A tiny companion that walks on your Claude Code prompt line and talks back: the Professor by default, five more characters built in (`duck`, `cat`, `robot`, `ghost`, `dragon`), or your own.

```text
/buddy                  pet it
/buddy list             every character, the current one starred
/buddy use {id}         switch, and remember it (/buddy use default goes back)
/buddy off | on         hide or show it, remembered
/buddy reload           rescan the characters after you edit one
/buddy adopt [npm]      bring back the companion Claude Code hatched for your account
/buddy adopt from {p}   the same, from another copy of ~/.claude.json (add npm for the npm roll)
/buddy help             usage
/buddy {question}       a one-line answer, in character
```

It reacts to the work: a failed tool call, a test run passing or failing. A question forks this chat by default, so the answer sees the conversation and reads its prompt cache; the options `questionMode`, `quips`, `quipModel` and `quipCooldownSec` decide what spends tokens. Your own characters are JSON files in the folder the `characterDir` option names.

`/buddy adopt` reads `~/.claude.json` (never writes it), works out the species, rarity, eyes, hat and stats Claude Code's removed `/buddy` gave your account, and brings that companion back with its saved name and personality; with no saved one it looks in your `~/.claude.json` backups, then hatches a new soul with one `quipModel` call. `/buddy adopt npm` gives the companion the npm install rolled; `/buddy adopt from {path}` reads another copy of the file. `/buddy use default` leaves it.

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and draws in the terminal and the desktop app. The full documentation and the character guide live in the repository: https://github.com/rezzminator/buddy

Built and maintained with [Professor](https://github.com/rezzminator/professor).
