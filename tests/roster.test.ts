import { describe, expect, test } from 'vitest';
import { STANDIN_DEFAULT, choose, isCharacterFile, loadEntries, mergeRoster } from '../plugins/buddy/src/roster.ts';
import { raw } from './fixtures.ts';

const json = (o: Record<string, unknown>) => JSON.stringify(raw(o));
const builtins = loadEntries(
  [
    { name: 'duck.json', text: json({ id: 'duck', name: 'Quacky' }) },
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
      ['duck', 'ok'],
      ['cat', 'ok'],
      ['bad', expect.stringMatching(/^not valid JSON: /)],
      ['gone', 'unreadable: EACCES'],
    ]);
  });
  test("the user's file wins an id; entries sort by id", () => {
    const user = loadEntries([{ name: 'cat.json', text: json({ id: 'cat', name: 'My Cat' }) }], 'user');
    const r = mergeRoster(builtins, user, ['couldn\'t read x']);
    expect(r.entries.map((e) => e.id)).toEqual(['bad', 'cat', 'duck', 'gone']);
    expect(r.entries.find((e) => e.id === 'cat')).toMatchObject({ source: 'user', character: { name: 'My Cat' } });
    expect(r.errors).toEqual(["couldn't read x"]);
  });
  test('choice: store, then option, then the duck', () => {
    const r = mergeRoster(builtins, []);
    expect(choose(r, 'cat', 'duck').character.name).toBe('Cat');
    expect(choose(r, undefined, 'cat').character.name).toBe('Cat');
    expect(choose(r, undefined, undefined)).toMatchObject({ id: 'duck', character: { name: 'Quacky' } });
    expect(choose(r, undefined, undefined).error).toBeUndefined();
  });
  test('a missing or invalid choice draws the duck and says why', () => {
    const r = mergeRoster(builtins, []);
    expect(choose(r, 'bad', undefined)).toMatchObject({ character: { name: 'Quacky' }, error: expect.stringMatching(/^Couldn't load bad: not valid JSON: /) });
    expect(choose(r, 'ghost', undefined).error).toBe("Couldn't load ghost: no such character; /buddy-personality picks another");
  });
  test('no duck file: the stand-in duck, and the error', () => {
    const r = mergeRoster([], []);
    const c = choose(r, undefined, undefined);
    expect(c.character).toBe(STANDIN_DEFAULT);
    expect(c.character.id).toBe('duck');
    expect(c.error).toBe("Couldn't load duck: no such character; /buddy-personality picks another");
  });
});
