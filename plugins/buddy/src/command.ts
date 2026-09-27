// `/buddy ...` parsed: a bare word is a command only when it stands alone, so
// "list the files" is a question, not /buddy list.

import type { Variant } from './hatch.ts';

export type Action =
  | { kind: 'pet' }
  | { kind: 'list' }
  | { kind: 'use'; id: string }
  | { kind: 'useDefault' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'reload' }
  | { kind: 'help' }
  | { kind: 'adopt'; variant: Variant; path?: string }
  | { kind: 'question'; text: string }
  | { kind: 'usage'; message: string };

export const USAGE = [
  '/buddy               pet your buddy',
  '/buddy list          every character; * is the current one',
  '/buddy use {id}      switch character (remembered); /buddy use default returns to the option',
  '/buddy adopt [npm]   bring back the companion Claude Code hatched for your account (npm: as the npm install rolled it)',
  '/buddy adopt from {path} [npm]   the same, from another copy of ~/.claude.json (read only, never written)',
  '/buddy off | on      hide or show (remembered)',
  '/buddy reload        rescan the character files',
  '/buddy help          this text',
  '/buddy {question}    ask your buddy (option questionMode: fork, complete or off)',
].join('\n');

const WORDS: Record<string, Action> = {
  list: { kind: 'list' },
  off: { kind: 'off' },
  on: { kind: 'on' },
  reload: { kind: 'reload' },
  help: { kind: 'help' },
};

/** `adopt`, `adopt npm`, `adopt from {path}`, `adopt from {path} npm` (a path may hold spaces). */
const ADOPT = /^adopt(?:\s+from\s+(.+?))?(?:\s+(npm|native))?$/i;

export function parseCommand(args: string): Action {
  const text = args.trim();
  if (text === '') return { kind: 'pet' };
  const words = text.split(/\s+/);
  const first = words[0]!.toLowerCase();
  if (first === 'adopt') {
    const m = ADOPT.exec(text);
    if (m) {
      const variant: Variant = m[2]?.toLowerCase() === 'npm' ? 'npm' : 'native';
      return m[1] ? { kind: 'adopt', variant, path: m[1] } : { kind: 'adopt', variant };
    }
    if (words[1]?.toLowerCase() === 'from') return { kind: 'usage', message: 'usage: /buddy adopt from {path} [npm]' };
  }
  if (words.length === 1) {
    const action = WORDS[first];
    if (action) return action;
    if (first === 'use') return { kind: 'usage', message: 'usage: /buddy use {id}, or /buddy use default; /buddy list names the ids' };
  }
  if (first === 'use' && words.length === 2) {
    const id = words[1]!.toLowerCase();
    return id === 'default' ? { kind: 'useDefault' } : { kind: 'use', id };
  }
  return { kind: 'question', text };
}
