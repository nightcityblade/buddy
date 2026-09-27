import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  adoptCharacter, adoptChoiceOf, adoptReply, companionOf, hatRow, hatchedDate, identityOf, isBackupName, newestFirst, parseSoul, personaOf,
  savedSoulOf, soulKey, soulPrompt, statBar, stars, welcomeLine, type Soul,
} from '../plugins/buddy/src/adopt.ts';
import { frameAt } from '../plugins/buddy/src/character.ts';
import type { Bones } from '../plugins/buddy/src/hatch.ts';
import { RAINBOW, SHINY_STEP_MS, buildScene, spriteColor } from '../plugins/buddy/src/scene.ts';
import { validateSpecies, type SpeciesTemplate } from '../plugins/buddy/src/species.ts';

const v = validateSpecies(JSON.parse(readFileSync(new URL('./fixtures/species-blob.json', import.meta.url), 'utf8')), 'blob');
if (!v.ok) throw new Error(`fixture species: ${v.error}`);
const template: SpeciesTemplate = v.template;
const HATS = { crown: 'www', tophat: '_|_', propeller: '-+-', halo: '(_)', wizard: '/^\\', beanie: '(__)', tinyduck: '<o)' };
const bones = (over: Partial<Bones> = {}): Bones => ({
  rarity: 'rare', species: 'blob', eye: '◉', hat: 'crown', shiny: false,
  stats: { DEBUGGING: 30, PATIENCE: 9, CHAOS: 40, WISDOM: 50, SNARK: 81 },
  ...over,
});
const soul: Soul = { name: 'Mochi', personality: 'A round, patient blob who hums at green tests.', hatchedAt: Date.UTC(2026, 3, 1) };

function adopt(b: Bones = bones()) {
  const r = adoptCharacter({ soul, bones: b, variant: 'native', template, hats: HATS });
  if (!r.ok) throw new Error(r.error);
  return r.character;
}

describe('the config', () => {
  test('identity: accountUuid, then userID, then anon', () => {
    expect(identityOf({ oauthAccount: { accountUuid: 'u-1' }, userID: 'x' })).toBe('u-1');
    expect(identityOf({ oauthAccount: null, userID: 'x' })).toBe('x');
    expect(identityOf({ oauthAccount: {}, userID: 'x' })).toBe('x');
    expect(identityOf({})).toBe('anon');
    expect(identityOf('not an object')).toBe('anon');
  });

  test('the companion: none, malformed, or a soul', () => {
    expect(companionOf({})).toEqual({});
    expect(companionOf({ companion: 'Rex' })).toEqual({ error: 'the companion is not an object' });
    expect(companionOf({ companion: { personality: 'x' } })).toEqual({ error: 'the companion has no name' });
    expect(companionOf({ companion: { name: ' Rex ', personality: 'Gruff.', hatchedAt: 5 } })).toEqual({ soul: { name: 'Rex', personality: 'Gruff.', hatchedAt: 5 } });
  });

  test('backup names, newest first', () => {
    expect(['.claude.json.backup', '.claude.json.bak-20260409-101500'].every(isBackupName)).toBe(true);
    expect(['.claude.json', '.claude.json.', 'claude.json.bak', '.claude'].some(isBackupName)).toBe(false);
    const sorted = [
      { name: '.claude.json.bak-20260401', mtimeMs: 5 },
      { name: '.claude.json.bak-20260409', mtimeMs: 5 },
      { name: '.claude.json.backup', mtimeMs: 9 },
    ].sort(newestFirst);
    expect(sorted.map((s) => s.name)).toEqual(['.claude.json.backup', '.claude.json.bak-20260409', '.claude.json.bak-20260401']);
  });
});

describe('adoptCharacter', () => {
  test('the eye in, the hat centered on hatCol, the rarity color, the name in the lines', () => {
    const c = adopt();
    expect(c.id).toBe('adopted');
    expect(c.width).toBe(6);
    expect(frameAt(c, 'idle', 0)).toEqual([' www  ', ' (◉◉) ', ' (__) ']);
    expect(frameAt(c, 'sleep', 0)).toEqual([' www  ', ' (--) ', ' (__) ']);
    expect(c.color).toBe('blue');
    expect(c.lines.greeting).toEqual(['Mochi blobs in.']);
    expect(c.lines.petted).toEqual(['Mochi wobbles.', 'Again, says Mochi.']);
    expect(c.description).toBe('★★★ rare blob (native)');
    expect(c.shiny).toBeUndefined();
  });

  test('no hat: the hat row is dropped', () => {
    const c = adopt(bones({ rarity: 'common', hat: 'none' }));
    expect(c.height).toBe(2);
    expect(frameAt(c, 'idle', 0)).toEqual([' (◉◉) ', ' (__) ']);
    expect(c.color).toBe('white');
  });

  test('shiny: a sparkle column that alternates rows, and a rainbow per tick', () => {
    const c = adopt(bones({ shiny: true }));
    expect(c.width).toBe(7);
    expect(frameAt(c, 'walkRight', 0)).toEqual([' www  *', ' (◉◉)> ', ' /  \\  ']);
    expect(frameAt(c, 'walkRight', 1)).toEqual([' www   ', ' (◉◉)>*', ' |  |  ']);
    const colors = RAINBOW.map((_, i) => spriteColor(c, i * SHINY_STEP_MS));
    expect(colors).toEqual([...RAINBOW]);
    expect(spriteColor(adopt(), 12345)).toBe('blue');
  });

  test('a hat the art lacks, or the wrong species, is an error', () => {
    expect(adoptCharacter({ soul, bones: bones(), variant: 'npm', template, hats: {} })).toEqual({ ok: false, error: 'species/hats.json has no crown' });
    expect(adoptCharacter({ soul, bones: bones({ species: 'duck' }), variant: 'npm', template, hats: HATS })).toMatchObject({ ok: false });
  });

  test('the hover card: name, species and stars, the stats line, five bars, the hatch date', () => {
    const s = buildScene({ character: adopt(bones({ shiny: true })), pose: 'idle', frame: 0, x: 0, cols: 100, maxRows: 10, bubble: null, confetti: null, sleeping: false, zTick: 0, stats: { pets: 2, questions: 1 }, now: 0 })!;
    expect(s.card?.lines).toEqual([
      'Mochi',
      'blob · ★★★ rare · shiny ✨',
      'pets 2 | questions 1 | curious',
      'DEBUGGING ███░░░░░░░ 30',
      'PATIENCE  █░░░░░░░░░ 9',
      'CHAOS     ████░░░░░░ 40',
      'WISDOM    █████░░░░░ 50',
      'SNARK     ████████░░ 81',
      'hatched 2026-04-01',
    ]);
  });
});

describe('the words', () => {
  test('stars, bars, dates, the hat row', () => {
    expect(stars('common')).toBe('★');
    expect(stars('legendary')).toBe('★★★★★');
    expect(statBar('SNARK', 81)).toBe('SNARK     ████████░░ 81');
    expect(statBar('CHAOS', 100)).toBe('CHAOS     ██████████ 100');
    expect(statBar('WISDOM', 1)).toBe('WISDOM    ░░░░░░░░░░ 1');
    expect(hatchedDate('2026-04-02T10:00:00Z')).toBe('2026-04-02');
    expect(hatchedDate(undefined)).toBe('unknown');
    expect(hatchedDate('soon')).toBe('unknown');
    expect(hatRow(6, 0, 'www')).toBe('www   ');
    expect(hatRow(6, 5, 'www')).toBe('   www');
  });

  test('the persona: the soul, the species and a stats hint', () => {
    const p = personaOf(soul, bones());
    expect(p).toContain('You are Mochi, a rare blob');
    expect(p).toContain('A round, patient blob who hums at green tests.');
    expect(p).toContain('SNARK 81');
    expect(p).toContain('You are sassy and a little snarky.');
    expect(p).toContain('You are a little impatient.');
  });

  test('the reply: who is back, from where, the account by its last 4, the npm tip', () => {
    const r = adoptReply({ name: 'Mochi', bones: bones({ shiny: true }), variant: 'native', origin: { kind: 'backup', label: '~/.claude.json.backup' }, account: '…cafe' });
    expect(r.split('\n')).toEqual([
      'Mochi the rare blob (shiny!) is back.',
      'Its soul came from the backup ~/.claude.json.backup.',
      'Account …cafe, rolled as the native install did.',
      'Hatched on an npm install? /buddy adopt npm',
    ]);
    expect(adoptReply({ name: 'Mochi', bones: bones(), variant: 'npm', origin: { kind: 'hatched' }, account: '…' })).toContain('Mochi the rare blob hatched.');
    expect(welcomeLine({ kind: 'file' }, 'Mochi')).toBe('Welcome back, Mochi!');
    expect(welcomeLine({ kind: 'hatched' }, 'Mochi')).toBe("Hello! I'm Mochi.");
  });
});

describe('a new soul', () => {
  test('the prompt carries the bones and, on a retry, what was wrong', () => {
    const p = soulPrompt(bones(), 123, 'no JSON object in the reply');
    expect(p).toContain('Species: blob');
    expect(p).toContain('Rarity: rare');
    expect(p).toContain('SNARK 81');
    expect(p).toContain('Inspiration seed: 123');
    expect(p).toContain('Your last reply was not usable (no JSON object in the reply)');
  });

  test('parseSoul: JSON in the reply, validated', () => {
    expect(parseSoul('Sure! {"name": "Pip", "personality": "A tiny blob who adores\\n tidy diffs."}')).toEqual({ soul: { name: 'Pip', personality: 'A tiny blob who adores tidy diffs.' } });
    expect(parseSoul('no json')).toEqual({ error: 'no JSON object in the reply' });
    expect(parseSoul('{"name": "Sir Pip The Third", "personality": "A tiny blob who adores tidy diffs."}').error).toContain('name must be');
    expect(parseSoul('{"name": "Pip", "personality": "Short"}').error).toContain('personality must be');
    expect(parseSoul('{"name": "Pip",}').error).toContain('not valid JSON');
  });

  test('the store: a key without the identity, a saved soul back, the choice back', () => {
    expect(soulKey('00ff', 'npm')).toBe('soul:00ff:npm');
    expect(savedSoulOf({ name: 'Pip', personality: 'x', from: '~/.claude.json.backup' })).toEqual({ soul: { name: 'Pip', personality: 'x' }, label: '~/.claude.json.backup' });
    expect(savedSoulOf('junk')).toEqual({});
    expect(adoptChoiceOf({ variant: 'npm', path: '~/x.json' })).toEqual({ variant: 'npm', path: '~/x.json' });
    expect(adoptChoiceOf({ variant: 'bun' })).toBeUndefined();
  });
});
