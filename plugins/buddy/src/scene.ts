import { frameAt, type Character, type Pose } from './character.ts';
import { CONFETTI_ROWS, particles } from './particles.ts';

// What the AbovePrompt band shows, as plain data: the adapter maps it to
// Box/Text one to one, and its JSON is the key that decides a redraw.

export type Seg = { pad: number; text: string; color: string };
export type Scene = {
  color: string;
  /** The sprite's rows, all `character.width` wide. */
  rows: string[];
  /** The sprite's left column. */
  x: number;
  /** The left column of the sprite-and-bubble row. */
  rowX: number;
  bubble: { text: string; width: number; side: 'left' | 'right' } | null;
  /** Rows drawn above the sprite (confetti, the sleep drift). */
  effects: Seg[][];
  /** The hover card, placed against the sprite's Box. */
  card: { lines: string[]; left: number; width: number } | null;
};

export type SceneInput = {
  character: Character;
  pose: Pose;
  frame: number;
  x: number;
  cols: number;
  maxRows: number;
  bubble: string | null;
  confetti: { seed: number; tick: number } | null;
  sleeping: boolean;
  zTick: number;
  stats: { pets: number; questions: number };
  /** The brain's clock in ms: a shiny sprite's color cycles with it. */
  now?: number;
};

export const MIN_BUBBLE_COLS = 40;
export const MAX_BUBBLE_WIDTH = 60;
export const MIN_EFFECT_COLS = 40;
const CARD_MAX_WIDTH = 44;
export const RAINBOW = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const;
export const SHINY_STEP_MS = 200;

/** The sprite's color: its own, or for a shiny one the rainbow, a step per tick. */
export function spriteColor(c: Character, now: number): string {
  return c.shiny ? RAINBOW[Math.floor(now / SHINY_STEP_MS) % RAINBOW.length]! : c.color;
}

export const MOODS: Record<Pose, string> = {
  idle: 'curious',
  walkRight: 'strolling',
  walkLeft: 'strolling',
  rest: 'resting',
  oops: 'flustered',
  yay: 'delighted',
  thinking: 'pondering',
  petted: 'happy',
  working: 'reading along',
  sleep: 'asleep',
};

export function bubbleWidth(cols: number, width: number): number {
  return Math.min(MAX_BUBBLE_WIDTH, cols - width - 4);
}

/** Cells at absolute columns as one row of segments: gap, then the glyph. */
function toSegs(cells: readonly { col: number; text: string; color: string }[]): Seg[] {
  const segs: Seg[] = [];
  let end = 0;
  for (const c of [...cells].sort((a, b) => a.col - b.col)) {
    if (c.col < end) continue;
    segs.push({ pad: c.col - end, text: c.text, color: c.color });
    end = c.col + c.text.length;
  }
  return segs;
}

/** The scene, or null when the band is too narrow for the sprite (below width + 2). */
export function buildScene(i: SceneInput): Scene | null {
  const c = i.character;
  if (i.cols < c.width + 2) return null;
  const max = Math.max(0, i.cols - c.width - 1);
  let x = Math.min(Math.max(0, i.x), max);
  let rowX = x;
  let bubble: Scene['bubble'] = null;
  const bw = bubbleWidth(i.cols, c.width);
  if (i.bubble && i.cols >= MIN_BUBBLE_COLS && bw >= 10) {
    const side = x > i.cols / 2 ? 'left' : 'right';
    if (side === 'right') {
      x = Math.min(x, Math.max(0, i.cols - c.width - bw - 2));
      rowX = x;
    } else {
      x = Math.min(max, Math.max(x, bw + 1));
      rowX = x - bw - 1;
    }
    bubble = { text: i.bubble, width: bw, side };
  }

  const effects: Seg[][] = [];
  if (i.confetti && i.cols >= MIN_EFFECT_COLS && i.maxRows >= c.height + CONFETTI_ROWS) {
    const start = Math.max(0, x - 3);
    const span = Math.min(c.width + 6, i.cols - 1 - start);
    const cells = particles(i.confetti.seed, i.confetti.tick, span);
    for (let row = 0; row < CONFETTI_ROWS; row++) {
      effects.push(toSegs(cells.filter((p) => p.row === row).map((p) => ({ col: start + p.col, text: p.ch, color: p.color }))));
    }
  } else if (i.sleeping && i.maxRows >= c.height + 1) {
    const text = i.zTick % 2 === 0 ? 'z Z' : 'Z z';
    const col = Math.max(0, Math.min(i.cols - text.length - 1, x + c.width - 3 + (i.zTick % 3)));
    effects.push(toSegs([{ col, text, color: 'gray' }]));
  }

  const lines = [c.name, c.card?.subtitle ?? c.description, `pets ${i.stats.pets} | questions ${i.stats.questions} | ${MOODS[i.pose]}`, ...(c.card?.rows ?? [])];
  const cw = Math.min(CARD_MAX_WIDTH, Math.max(...lines.map((l) => l.length)) + 4);
  const fitsRight = x + c.width + 1 + cw <= i.cols;
  const fitsLeft = x - cw - 1 >= 0;
  const preferLeft = bubble?.side === 'right';
  const left = preferLeft ? (fitsLeft ? -(cw + 1) : fitsRight ? c.width + 1 : null) : fitsRight ? c.width + 1 : fitsLeft ? -(cw + 1) : null;
  const card = left === null ? null : { lines, left, width: cw };

  return { color: spriteColor(c, i.now ?? 0), rows: [...frameAt(c, i.pose, i.frame)], x, rowX, bubble, effects, card };
}
