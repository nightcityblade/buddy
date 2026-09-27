# Security policy

## Supported versions

Only the latest release of buddy gets security fixes. The current version is
in [CHANGELOG.md](./CHANGELOG.md).

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it
privately through GitHub's
[private vulnerability reporting](https://github.com/rezzminator/buddy/security/advisories/new)
(the repository's **Security** tab, **Report a vulnerability**).

Include what you found, the steps to reproduce it, the Claude Code version
(`claude --version`) and the buddy version.

## What buddy touches

Useful when judging impact:

- It reads `~/.claude.json` and its backups (`~/.claude.json.*`,
  `~/.claude/backups/`) to recompute your original companion, and never
  writes them. Your account id is never shown, saved or logged.
- It reads the character JSON files in the folder the `characterDir` option
  names.
- It makes model calls only through Claude Code itself: a `/buddy` question,
  and quips when you turn them on. There is no buddy server.
