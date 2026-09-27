import { describe, expect, test } from 'vitest';
import { STANDIN_PROFESSOR, choose, formatList, isCharacterFile, loadEntries, mergeRoster, validIds } from '../plugins/buddy/src/roster.ts';
import { raw } from './fixtures.ts';

const json = (o: Record<string, unknown>) => JSON.stringify(raw(o));
const builtins = loadEntries(
  [
    { name: 'professor.json', text: json({ id: 'professor', name: 'Prof' }) },
    { name: 'cat.json', text: json({ id: 'cat', name: 'Cat' }) },
    { name: 'bad.json', text: '{ nope' },
    { name: 'gone.json', error: 'unreadable: EACCES' },
  ],
  'builtin',
);

describe('roster', () => {
  test('character files are visible .json entries that are not directories', () => {
    expect(isCharacterFile('cat.json', 'file')).toBe(true);
    expect(isCharacterFile('cat.json', 'other')).toBe(true);
    expect(isCharacterFile('cat.json', 'dir')).toBe(false);
    expect(isCharacterFile('.cat.json', 'file')).toBe(false);
    expect(isCharacterFile('README.md', 'file')).toBe(false);
  });
  test('an invalid file stays in with its first error', () => {
    expect(builtins.map((e) => [e.id, e.error ?? 'ok'])).toEqual([
      ['professor', 'ok'],
      ['cat', 'ok'],
      ['bad', expect.stringMatching(/^not valid JSON: /)],
      ['gone', 'unreadable: EACCES'],
    ]);
  });
  test("the user's file wins an id; entries sort by id", () => {
    const user = loadEntries([{ name: 'cat.json', text: json({ id: 'cat', name: 'My Cat' }) }], 'user');
    const r = mergeRoster(builtins, user, ['couldn\'t read x']);
    expect(r.entries.map((e) => e.id)).toEqual(['bad', 'cat', 'gone', 'professor']);
    expect(r.entries.find((e) => e.id === 'cat')).toMatchObject({ source: 'user', character: { name: 'My Cat' } });
    expect(validIds(r)).toEqual(['cat', 'professor']);
    expect(r.errors).toEqual(["couldn't read x"]);
  });
  test('choice: store, then option, then the professor', () => {
    const r = mergeRoster(builtins, []);
    expect(choose(r, 'cat', 'professor').character.name).toBe('Cat');
    expect(choose(r, undefined, 'cat').character.name).toBe('Cat');
    expect(choose(r, undefined, undefined)).toMatchObject({ id: 'professor', character: { name: 'Prof' } });
    expect(choose(r, undefined, undefined).error).toBeUndefined();
  });
  test('a missing or invalid choice draws the professor and says why', () => {
    const r = mergeRoster(builtins, []);
    expect(choose(r, 'bad', undefined)).toMatchObject({ character: { name: 'Prof' }, error: expect.stringMatching(/^Couldn't load bad: not valid JSON: /) });
    expect(choose(r, 'ghost', undefined).error).toBe("Couldn't load ghost: no such character");
  });
  test('no professor file: the stand-in, and the error', () => {
    const r = mergeRoster([], []);
    const c = choose(r, undefined, undefined);
    expect(c.character).toBe(STANDIN_PROFESSOR);
    expect(c.error).toBe("Couldn't load professor: no such character");
  });
  test('list: * on the drawn one, (yours), INVALID, dir errors and notes', () => {
    const user = loadEntries([{ name: 'mine.json', text: json({ id: 'mine', name: 'Mine' }) }], 'user');
    const r = mergeRoster(builtins, user, ["couldn't read /x: ENOENT"]);
    const cat = r.entries.find((e) => e.id === 'cat')!.character!;
    expect(formatList(r, cat, ['option motion ignored: "x" is not true or false']).split('\n')).toEqual([
      '  bad - INVALID: ' + r.entries[0]!.error,
      '* cat - Cat: A test fixture.',
      '  gone - INVALID: unreadable: EACCES',
      '  mine - Mine: A test fixture. (yours)',
      '  professor - Prof: A test fixture.',
      "  (couldn't read /x: ENOENT)",
      '  (option motion ignored: "x" is not true or false)',
    ]);
  });
  test('list with nothing loaded shows the stand-in, marked', () => {
    const out = formatList(mergeRoster([], []), STANDIN_PROFESSOR);
    expect(out).toContain('(no character files found)');
    expect(out).toContain('* professor - The Professor: Built-in stand-in');
  });
});
