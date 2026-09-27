import { validateCharacter, type Character } from './character.ts';

// Every character the buddy knows: the built-ins, then the user's folder, an
// id in both taken from the user's. An invalid file stays in the roster with
// its first error, so /buddy list shows it rather than hiding it.

export const DEFAULT_ID = 'professor';

export type Source = 'builtin' | 'user' | 'original';
export type Entry = { id: string; source: Source; character?: Character; error?: string };
export type Roster = { entries: Entry[]; errors: string[] };
/** A listed file: its text, or why it could not be read. */
export type LoadedFile = { name: string; text?: string; error?: string };
export type Choice = { id: string; character: Character; error?: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A directory entry that may be a character: a `.json` file (or link), not hidden. */
export function isCharacterFile(name: string, kind: string): boolean {
  return kind !== 'dir' && name.endsWith('.json') && !name.startsWith('.');
}

export function loadEntries(files: readonly LoadedFile[], source: Source): Entry[] {
  return files.map((f) => {
    const id = f.name.replace(/\.json$/, '');
    if (f.error !== undefined) return { id, source, error: f.error };
    let raw: unknown;
    try {
      raw = JSON.parse(f.text ?? '');
    } catch (error) {
      return { id, source, error: `not valid JSON: ${message(error)}` };
    }
    const v = validateCharacter(raw, id);
    return v.ok ? { id, source, character: v.character } : { id, source, error: v.error };
  });
}

export function mergeRoster(builtins: readonly Entry[], users: readonly Entry[], errors: readonly string[] = []): Roster {
  const byId = new Map<string, Entry>();
  for (const e of builtins) byId.set(e.id, e);
  for (const e of users) byId.set(e.id, e);
  return { entries: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), errors: [...errors] };
}

/** The roster with `e` in it, replacing any entry of its id. */
export function withEntry(r: Roster, e: Entry): Roster {
  return { entries: [...r.entries.filter((x) => x.id !== e.id), e].sort((a, b) => a.id.localeCompare(b.id)), errors: r.errors };
}

export function findEntry(r: Roster, id: string): Entry | undefined {
  return r.entries.find((e) => e.id === id);
}

export function validIds(r: Roster): string[] {
  return r.entries.filter((e) => e.character).map((e) => e.id);
}

/**
 * The stand-in drawn when no Professor file loads: the probe's Professor,
 * with the generic lines, so an error still shows a buddy and a bubble.
 */
const STANDIN = validateCharacter({
  id: DEFAULT_ID,
  name: 'The Professor',
  description: 'Built-in stand-in, drawn when professor.json does not load.',
  persona: "You are the tiny Professor who sits above a developer's Claude Code prompt: precise and warm, with a dry, observational humor.",
  poses: {
    idle: [['   _A_   ', '  (o.o)  ', '  /|_|\\  ', '   | |   ']],
    walkRight: [
      ['   _A_   ', '  (o.o)  ', '  /|_|\\c ', '   / \\   '],
      ['   _A_   ', '  (o.o)  ', '  /|_|\\c ', '   | |   '],
    ],
    walkLeft: [
      ['   _A_   ', '  (o.o)  ', ' c/|_|\\  ', '   / \\   '],
      ['   _A_   ', '  (o.o)  ', ' c/|_|\\  ', '   | |   '],
    ],
    rest: [['   _A_   ', '  (o.o)c ', '  /|_|\\  ', '   | |   ']],
    oops: [['   _A_   ', '  (O.o)  ', '  /|_|\\! ', '   | |   ']],
    yay: [['   _A_   ', '  (^.^)  ', '  \\|_|/c ', '   | |   ']],
    thinking: [['   _A_  ?', '  (o.o)  ', '  /|_|\\c ', '   | |   ']],
  },
});
if (!STANDIN.ok) throw new Error(`buddy: the built-in stand-in is invalid: ${STANDIN.error}`);
export const STANDIN_PROFESSOR: Character = STANDIN.character;

/**
 * The character to draw: the stored choice, else the option, else the
 * Professor. A missing or invalid choice draws the Professor (or the stand-in)
 * and says why in `error`.
 */
export function choose(r: Roster, storeChoice: string | undefined, optionChoice: string | undefined): Choice {
  const id = storeChoice || optionChoice || DEFAULT_ID;
  const entry = findEntry(r, id);
  if (entry?.character) return { id, character: entry.character };
  const why = entry?.error ?? 'no such character';
  const professor = findEntry(r, DEFAULT_ID)?.character ?? STANDIN_PROFESSOR;
  return { id, character: professor, error: `Couldn't load ${id}: ${why}` };
}

/** `/buddy list`: `* ` on the one drawn, `(yours)` on the user's, `INVALID: ` on the bad. */
export function formatList(r: Roster, current: Character, notes: readonly string[] = []): string {
  const rows = r.entries.map((e) => {
    const mark = e.character !== undefined && e.character === current ? '* ' : '  ';
    const yours = e.source === 'user' ? ' (yours)' : '';
    return e.character ? `${mark}${e.id} - ${e.character.name}: ${e.character.description}${yours}` : `${mark}${e.id} - INVALID: ${e.error}${yours}`;
  });
  if (current === STANDIN_PROFESSOR) rows.push(`* ${current.id} - ${current.name}: ${current.description}`);
  if (r.entries.length === 0) rows.unshift('  (no character files found)');
  return [...rows, ...r.errors.map((e) => `  (${e})`), ...notes.map((n) => `  (${n})`)].join('\n');
}
