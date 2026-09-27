import type { Character, LineEvent, Pose } from './character.ts';
import { pickLine, poolFor } from './lines.ts';
import { initialMotion, maxX, periodMs, tickMotion, type MotionState } from './motion.ts';
import { CONFETTI_MS, CONFETTI_TICK_MS } from './particles.ts';
import { lostThread, type TurnSummary } from './prompts.ts';
import { REACTIONS, classifyToolCall, type Outcome, type ToolCall } from './reactions.ts';
import { buildScene, type Scene } from './scene.ts';

// The buddy's state and every transition, with no I/O: the adapter feeds it
// events and the clock, and draws what `sceneOf` returns. Time is the clock's,
// advanced by one period per tick, so a test drives it exactly.

export const BUBBLE_MS = 6000;
export const ANSWER_MS = 15000;
export const ERROR_MS = 10000;
export const THINKING_MS = 60000;
export const SLEEP_IDLE_MS = 60000;
export const REST_LINE_CHANCE = 0.25;
export const WORKING_LINE_CHANCE = 0.25;

export type Talk = { text: string; pose: Pose | null; until: number };

export type Brain = {
  character: Character;
  /** The motion option; the character's own motion.walk also has to allow it. */
  walkOption: boolean;
  now: number;
  motion: MotionState;
  talk: Talk | null;
  confetti: { seed: number; start: number } | null;
  cols: number;
  maxRows: number;
  working: boolean;
  lastActivity: number;
  sleeping: boolean;
  pets: number;
  questions: number;
  lastLines: Partial<Record<LineEvent, string>>;
  turn: TurnSummary;
  lastQuipAt: number | null;
  /** The pose last drawn: a new pose starts at its first frame. */
  lastPose: Pose | null;
};

export function createBrain(character: Character, walkOption: boolean): Brain {
  return {
    character,
    walkOption,
    now: 0,
    motion: initialMotion(0),
    talk: null,
    confetti: null,
    cols: 80,
    maxRows: 10,
    working: false,
    lastActivity: 0,
    sleeping: false,
    pets: 0,
    questions: 0,
    lastLines: {},
    turn: { tools: [], failures: 0, lastBash: '' },
    lastQuipAt: null,
    lastPose: null,
  };
}

export function walks(b: Brain): boolean {
  return b.walkOption && b.character.motion.walk;
}

/** The clock period the brain wants now. */
export function period(b: Brain): number {
  return periodMs(walks(b), b.character.motion.stepMs);
}

export function speak(b: Brain, text: string, pose: Pose | null, ms: number): void {
  b.talk = { text, pose, until: b.now + ms };
}

export function sayLine(b: Brain, event: LineEvent, pose: Pose | null, ms: number, rand: () => number): void {
  const line = pickLine(poolFor(b.character, event), b.lastLines[event], rand);
  b.lastLines[event] = line;
  speak(b, line, pose, ms);
}

/** Switches character; an error shows for ERROR_MS, else the new one greets. */
export function setCharacter(b: Brain, c: Character, error: string | undefined, rand: () => number): void {
  b.character = c;
  b.lastLines = {};
  b.motion = { ...b.motion, x: Math.min(b.motion.x, maxX(b.cols, c.width)) };
  if (error) speak(b, error, null, ERROR_MS);
  else greet(b, rand);
}

/** The greeting line: at session start, on a switch, on /buddy on. */
export function greet(b: Brain, rand: () => number): void {
  sayLine(b, 'greeting', null, BUBBLE_MS, rand);
}

export function isSleepHour(hour: number): boolean {
  return hour >= 0 && hour < 6;
}

/** Any event: resets the idle time; a sleeping buddy wakes with a line. */
export function wake(b: Brain, rand: () => number): boolean {
  b.lastActivity = b.now;
  if (!b.sleeping) return false;
  b.sleeping = false;
  sayLine(b, 'wake', null, BUBBLE_MS, rand);
  return true;
}

/** One clock tick at local `hour`. */
export function tick(b: Brain, hour: number, rand: () => number): void {
  b.now += period(b);
  if (b.talk && b.now >= b.talk.until) b.talk = null;
  if (b.confetti && b.now - b.confetti.start >= CONFETTI_MS) b.confetti = null;
  if (b.working) b.lastActivity = b.now;
  if (!b.sleeping && !b.talk && !b.working && isSleepHour(hour) && b.now - b.lastActivity >= SLEEP_IDLE_MS) b.sleeping = true;
  const m = b.character.motion;
  const r = tickMotion(
    b.motion,
    { now: b.now, cols: b.cols, width: b.character.width, walk: walks(b), still: b.talk !== null || b.working || b.sleeping, restChance: m.restChance, restTicks: m.restTicks },
    rand,
  );
  b.motion = r.state;
  if (r.restStarted && rand() < REST_LINE_CHANCE) sayLine(b, 'rest', 'rest', BUBBLE_MS, rand);
}

/** What the band reported on its last draw. Work starting wakes him, sometimes with a line. */
export function observeBand(b: Brain, band: { cols: number; maxRows: number; isWorking: boolean }, rand: () => number): void {
  b.cols = band.cols;
  b.maxRows = band.maxRows;
  if (band.isWorking === b.working) return;
  b.working = band.isWorking;
  if (!band.isWorking) return;
  wake(b, rand);
  if (b.talk === null && rand() < WORKING_LINE_CHANCE) sayLine(b, 'working', 'working', BUBBLE_MS, rand);
}

export function currentPose(b: Brain): Pose {
  if (b.talk?.pose) return b.talk.pose;
  if (b.sleeping) return 'sleep';
  if (b.working) return 'working';
  if (b.talk) return 'idle';
  if (walks(b) && b.motion.restLeft > 0) return 'rest';
  if (walks(b)) return b.motion.dir > 0 ? 'walkRight' : 'walkLeft';
  return 'idle';
}

/** A finished tool call: counted for the turn, and reacted to per REACTIONS. */
export function react(b: Brain, call: ToolCall & { command: string }, rand: () => number): Outcome | null {
  wake(b, rand);
  b.turn.tools.push(call.tool);
  if (call.isError || call.denied) b.turn.failures++;
  if (call.tool === 'Bash' && call.command) b.turn.lastBash = call.command.slice(0, 120);
  const outcome = classifyToolCall(call);
  if (!outcome) return null;
  const r = REACTIONS[outcome];
  sayLine(b, r.line, r.pose, BUBBLE_MS, rand);
  if (r.confetti) b.confetti = { seed: Math.floor(rand() * 2 ** 31), start: b.now };
  return outcome;
}

export function pet(b: Brain, rand: () => number): void {
  wake(b, rand);
  b.pets++;
  sayLine(b, 'petted', 'petted', BUBBLE_MS, rand);
}

export function beginQuestion(b: Brain, rand: () => number): void {
  wake(b, rand);
  b.questions++;
  sayLine(b, 'thinking', 'thinking', THINKING_MS, rand);
}

export function answer(b: Brain, text: string, pose: Pose | null = null): void {
  speak(b, text, pose, ANSWER_MS);
}

export function failAnswer(b: Brain, reason: string): void {
  speak(b, lostThread(b.character.name, reason), 'oops', ANSWER_MS);
}

export function farewell(b: Brain, rand: () => number): string {
  const line = pickLine(poolFor(b.character, 'farewell'), b.lastLines.farewell, rand);
  b.lastLines.farewell = line;
  return line;
}

/**
 * The turn ended: its summary when a quip is due (quips on, a tool used, the
 * cooldown passed), else null. The turn's tally starts over either way.
 */
export function endTurn(b: Brain, quips: boolean, cooldownSec: number): TurnSummary | null {
  const t = b.turn;
  b.turn = { tools: [], failures: 0, lastBash: '' };
  if (!quips || t.tools.length === 0) return null;
  if (b.lastQuipAt !== null && b.now - b.lastQuipAt < cooldownSec * 1000) return null;
  b.lastQuipAt = b.now;
  return t;
}

/** The scene to draw now; the sprite keeps the column the bubble pushed it to. */
export function sceneOf(b: Brain): Scene | null {
  const pose = currentPose(b);
  if (pose !== b.lastPose) {
    b.lastPose = pose;
    b.motion = { ...b.motion, stillFrame: 0, lastFrameAt: b.now };
  }
  const walking = pose === 'walkRight' || pose === 'walkLeft';
  const scene = buildScene({
    character: b.character,
    pose,
    frame: walking ? b.motion.walkFrame : b.motion.stillFrame,
    x: b.motion.x,
    cols: b.cols,
    maxRows: b.maxRows,
    bubble: b.talk?.text ?? null,
    confetti: b.confetti ? { seed: b.confetti.seed, tick: Math.floor((b.now - b.confetti.start) / CONFETTI_TICK_MS) } : null,
    sleeping: b.sleeping,
    zTick: b.motion.stillFrame,
    stats: { pets: b.pets, questions: b.questions },
  });
  if (scene && scene.x !== b.motion.x) b.motion = { ...b.motion, x: scene.x };
  return scene;
}
