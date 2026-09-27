// Confetti: a pure function of a seed and a tick, so a burst replays the same
// and a test can pin it. Particles rise from the bottom row to the top one,
// drifting sideways, in rotating colors.

export const CONFETTI_CHARS = ['*', '.', '+', 'o', "'", ','] as const;
export const CONFETTI_COLORS = ['red', 'yellow', 'green', 'cyan', 'magenta', 'blue'] as const;
export const CONFETTI_ROWS = 3;
export const CONFETTI_MS = 2000;
export const CONFETTI_TICK_MS = 250;
const LIFE = 6;

export type Cell = { row: number; col: number; ch: string; color: string };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The cells lit at `tick` of the burst `seed` over `width` columns: rows 0
 * (top) to CONFETTI_ROWS - 1, columns 0 to width - 1, one particle per cell,
 * sorted by row then column.
 */
export function particles(seed: number, tick: number, width: number): Cell[] {
  if (width < 1) return [];
  const rand = mulberry32(seed);
  const count = Math.min(14, Math.max(4, Math.floor(width / 2)));
  const cells = new Map<string, Cell>();
  for (let i = 0; i < count; i++) {
    const col0 = Math.floor(rand() * width);
    const delay = Math.floor(rand() * 3);
    const drift = Math.floor(rand() * 3) - 1;
    const ch = CONFETTI_CHARS[Math.floor(rand() * CONFETTI_CHARS.length)]!;
    const hue = Math.floor(rand() * CONFETTI_COLORS.length);
    const age = tick - delay;
    if (age < 0 || age >= LIFE) continue;
    const rise = Math.floor(age / 2);
    const row = CONFETTI_ROWS - 1 - rise;
    const col = Math.min(width - 1, Math.max(0, col0 + drift * rise));
    const key = `${row}:${col}`;
    if (!cells.has(key)) cells.set(key, { row, col, ch, color: CONFETTI_COLORS[(hue + tick) % CONFETTI_COLORS.length]! });
  }
  return [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col);
}
