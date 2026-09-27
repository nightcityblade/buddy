import { describe, expect, test } from 'vitest';
import { CONFETTI_CHARS, CONFETTI_COLORS, CONFETTI_ROWS, particles } from '../plugins/buddy/src/particles.ts';

describe('particles', () => {
  test('is a pure function of seed and tick', () => {
    expect(particles(7, 3, 20)).toEqual(particles(7, 3, 20));
    expect(particles(7, 3, 20)).not.toEqual(particles(8, 3, 20));
  });
  test('stays inside its rows and columns, one per cell, sorted', () => {
    for (let tick = 0; tick < 10; tick++) {
      const cells = particles(42, tick, 15);
      const keys = new Set(cells.map((c) => `${c.row}:${c.col}`));
      expect(keys.size).toBe(cells.length);
      for (const c of cells) {
        expect(c.row).toBeGreaterThanOrEqual(0);
        expect(c.row).toBeLessThan(CONFETTI_ROWS);
        expect(c.col).toBeGreaterThanOrEqual(0);
        expect(c.col).toBeLessThan(15);
        expect(CONFETTI_CHARS).toContain(c.ch);
        expect(CONFETTI_COLORS).toContain(c.color);
      }
      expect(cells).toEqual([...cells].sort((a, b) => a.row - b.row || a.col - b.col));
    }
  });
  test('rises: the first tick is on the bottom row, later ticks reach the top', () => {
    expect(particles(1, 0, 20).every((c) => c.row === CONFETTI_ROWS - 1)).toBe(true);
    const rows = new Set([4, 5, 6].flatMap((t) => particles(1, t, 20).map((c) => c.row)));
    expect(rows.has(0)).toBe(true);
  });
  test('burns out, and a zero width draws nothing', () => {
    expect(particles(1, 20, 20)).toEqual([]);
    expect(particles(1, 0, 0)).toEqual([]);
  });
});
