// `/buddy ...` parsed: a bare word is a command only when it stands alone, so
// "reload the page" is a question, not /buddy reload.

export type Action =
  | { kind: 'pet' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'reload' }
  | { kind: 'help' }
  | { kind: 'question'; text: string };

export const USAGE = [
  '/buddy               pet your buddy',
  '/buddy off | on      hide or show (remembered)',
  '/buddy reload        rescan the character files',
  '/buddy help          this text',
  '/buddy-personality   see every character and switch (remembered), with a live preview',
  '/buddy {question}    ask your buddy (option questionMode: fork, complete or off)',
].join('\n');

const WORDS: Record<string, Action> = {
  off: { kind: 'off' },
  on: { kind: 'on' },
  reload: { kind: 'reload' },
  help: { kind: 'help' },
};

export function parseCommand(args: string): Action {
  const text = args.trim();
  if (text === '') return { kind: 'pet' };
  const words = text.split(/\s+/);
  if (words.length === 1) {
    const action = WORDS[words[0]!.toLowerCase()];
    if (action) return action;
  }
  return { kind: 'question', text };
}
