// `/buddy ...` parsed: a bare word is a command only when it stands alone, so
// "list the files" is a question, not /buddy list.

export type Action =
  | { kind: 'pet' }
  | { kind: 'list' }
  | { kind: 'use'; id: string }
  | { kind: 'useDefault' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'reload' }
  | { kind: 'help' }
  | { kind: 'question'; text: string }
  | { kind: 'usage'; message: string };

export const USAGE = [
  '/buddy               pet your buddy',
  '/buddy list          every character; * is the current one',
  '/buddy use {id}      switch character (remembered); /buddy use default returns to the option',
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

export function parseCommand(args: string): Action {
  const text = args.trim();
  if (text === '') return { kind: 'pet' };
  const words = text.split(/\s+/);
  const first = words[0]!.toLowerCase();
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
