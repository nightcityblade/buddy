import { describe, expect, test } from 'vitest';
import { validateCharacter, type Character } from '../plugins/buddy/src/character.ts';
import { CONFETTI_ROWS } from '../plugins/buddy/src/particles.ts';
import { MOODS, bubbleWidth, buildScene, type SceneInput } from '../plugins/buddy/src/scene.ts';
import { raw } from './fixtures.ts';

const v = validateCharacter(raw({ poses: { idle: [['(o)', '/|\\'], ['   ', '(o)']], walkRight: [['a'], ['b']] } }));
if (!v.ok) throw new Error(v.error);
const c: Character = v.character;
const base: SceneInput = { character: c, pose: 'idle', frame: 0, x: 10, cols: 100, maxRows: 10, bubble: null, confetti: null, sleeping: false, zTick: 0, stats: { pets: 2, questions: 1 } };

describe('buildScene', () => {
  test('draws the frame, padded and bottom-aligned, blank rows kept', () => {
    const s = buildScene(base)!;
    expect(s.rows).toEqual(['(o)', '/|\\']);
    expect(buildScene({ ...base, frame: 1 })!.rows).toEqual(['   ', '(o)']);
    expect(s).toMatchObject({ x: 10, rowX: 10, bubble: null, effects: [], color: 'yellow' });
  });
  test('the sprite hides below width + 2 columns', () => {
    expect(buildScene({ ...base, cols: c.width + 1 })).toBeNull();
    expect(buildScene({ ...base, cols: c.width + 2 })).not.toBeNull();
  });
  test('the bubble: min(60, cols - width - 4) wide, opening toward the free side', () => {
    expect(bubbleWidth(100, 3)).toBe(60);
    expect(bubbleWidth(50, 3)).toBe(43);
    const right = buildScene({ ...base, bubble: 'hi' })!;
    expect(right.bubble).toEqual({ text: 'hi', width: 60, side: 'right' });
    expect(right.x).toBe(10);
    const left = buildScene({ ...base, x: 80, bubble: 'hi' })!;
    expect(left.bubble?.side).toBe('left');
    expect(left).toMatchObject({ x: 80, rowX: 19 });
  });
  test('the bubble pushes the sprite so the row fits', () => {
    const s = buildScene({ ...base, x: 60, cols: 100, bubble: 'hi' })!;
    expect(s.bubble?.side).toBe('left');
    const r = buildScene({ ...base, x: 45, cols: 100, bubble: 'hi' })!;
    expect(r.bubble?.side).toBe('right');
    expect(r.x + c.width + 1 + 60).toBeLessThanOrEqual(99);
    const l = buildScene({ ...base, x: 55, cols: 80, bubble: 'hi' })!;
    expect(l.rowX).toBeGreaterThanOrEqual(0);
  });
  test('no bubble below 40 columns', () => {
    expect(buildScene({ ...base, x: 0, cols: 39, bubble: 'hi' })!.bubble).toBeNull();
  });
  test('confetti: 3 rows above him, skipped when narrow or short', () => {
    const s = buildScene({ ...base, confetti: { seed: 3, tick: 4 } })!;
    expect(s.effects).toHaveLength(CONFETTI_ROWS);
    expect(s.effects.flat().length).toBeGreaterThan(0);
    for (const g of s.effects.flat()) expect(g.pad).toBeGreaterThanOrEqual(0);
    expect(buildScene({ ...base, cols: 39, confetti: { seed: 3, tick: 4 } })!.effects).toEqual([]);
    expect(buildScene({ ...base, maxRows: c.height + 2, confetti: { seed: 3, tick: 4 } })!.effects).toEqual([]);
  });
  test('sleep: a z Z drift above him', () => {
    const a = buildScene({ ...base, sleeping: true, pose: 'sleep', zTick: 0 })!;
    const b = buildScene({ ...base, sleeping: true, pose: 'sleep', zTick: 1 })!;
    expect(a.effects).toHaveLength(1);
    expect(a.effects[0]![0]!.text).toBe('z Z');
    expect(b.effects[0]![0]!.text).toBe('Z z');
    expect(a.effects[0]![0]!.pad).not.toBe(b.effects[0]![0]!.pad);
  });
  test('the hover card: name, description, pets, questions, mood; away from the bubble', () => {
    const s = buildScene(base)!;
    expect(s.card?.lines).toEqual(['Fixy', 'A test fixture.', 'pets 2 | questions 1 | curious']);
    expect(s.card?.left).toBe(c.width + 1);
    const withBubble = buildScene({ ...base, x: 40, bubble: 'hi' })!;
    expect(withBubble.card!.left).toBeLessThan(0);
    expect(MOODS.sleep).toBe('asleep');
  });
});
