import { describe, expect, test } from 'vitest';
import {
  ANSWER_MS, BUBBLE_MS, ERROR_MS, SLEEP_IDLE_MS, THINKING_MS, answer, beginQuestion, createBrain, currentPose, endTurn, failAnswer, farewell,
  isSleepHour, observeBand, period, pet, react, sceneOf, setCharacter, tick, wake,
} from '../plugins/buddy/src/brain.ts';
import { validateCharacter, type Character } from '../plugins/buddy/src/character.ts';
import { raw } from './fixtures.ts';

function char(over: Record<string, unknown> = {}): Character {
  const v = validateCharacter(raw(over));
  if (!v.ok) throw new Error(v.error);
  return v.character;
}
const never = () => 0.99;
const DAY = 12;
const NIGHT = 3;

function ticks(b: ReturnType<typeof createBrain>, n: number, hour = DAY, rand = never) {
  for (let i = 0; i < n; i++) tick(b, hour, rand);
}

describe('brain', () => {
  test('greets, holds still while talking, then walks', () => {
    const b = createBrain(char(), true);
    setCharacter(b, b.character, undefined, never);
    expect(b.talk?.text).toBe('Hi from Fixy.');
    ticks(b, 5);
    expect(b.motion.x).toBe(0);
    ticks(b, BUBBLE_MS / 200);
    expect(b.talk).toBeNull();
    const x = b.motion.x;
    ticks(b, 3);
    expect(b.motion.x).toBe(x + 3);
    expect(currentPose(b)).toBe('walkRight');
  });
  test('an error bubble shows for 10 s', () => {
    const b = createBrain(char(), true);
    setCharacter(b, b.character, "Couldn't load x: no such character", never);
    expect(b.talk).toMatchObject({ text: "Couldn't load x: no such character", until: ERROR_MS });
  });
  test('the motion option or motion.walk false: stands on idle, still period', () => {
    const off = createBrain(char(), false);
    expect(period(off)).toBe(300);
    ticks(off, 10);
    expect(off.motion.x).toBe(0);
    expect(currentPose(off)).toBe('idle');
    const standing = createBrain(char({ poses: { idle: [['a']] }, motion: { walk: false } }), true);
    expect(period(standing)).toBe(300);
    expect(currentPose(standing)).toBe('idle');
  });
  test('reactions: pose, line, confetti, and the turn tally', () => {
    const b = createBrain(char({ lines: { testPass: ['Green!'] } }), true);
    expect(react(b, { tool: 'Bash', isError: false, denied: false, output: '4 passed', command: 'npm test' }, never)).toBe('testPass');
    expect(currentPose(b)).toBe('yay');
    expect(b.talk?.text).toBe('Green!');
    expect(b.confetti).not.toBeNull();
    expect(react(b, { tool: 'Edit', isError: false, denied: true, output: '', command: '' }, never)).toBe('toolFail');
    expect(currentPose(b)).toBe('oops');
    expect(react(b, { tool: 'Read', isError: false, denied: false, output: '', command: '' }, never)).toBeNull();
    expect(b.turn).toEqual({ tools: ['Bash', 'Edit', 'Read'], failures: 1, lastBash: 'npm test' });
    ticks(b, 2000 / 200);
    expect(b.confetti).toBeNull();
  });
  test('pet, question, answer, lost thread', () => {
    const b = createBrain(char(), true);
    pet(b, never);
    expect(b.pets).toBe(1);
    expect(currentPose(b)).toBe('petted');
    beginQuestion(b, never);
    expect(b.questions).toBe(1);
    expect(currentPose(b)).toBe('thinking');
    expect(b.talk?.until).toBe(b.now + THINKING_MS);
    answer(b, 'Forty-two.');
    expect(b.talk).toMatchObject({ text: 'Forty-two.', pose: null, until: b.now + ANSWER_MS });
    failAnswer(b, 'api-error');
    expect(b.talk?.text).toBe('(Fixy lost the thread: api-error)');
    expect(farewell(b, never)).toBe('Until next time.');
  });
  test('sleeps 00:00-05:59 after 60 s idle, with the sleep pose; any event wakes him with a line', () => {
    expect([0, 5, 6, 23].map(isSleepHour)).toEqual([true, true, false, false]);
    const b = createBrain(char(), true);
    ticks(b, SLEEP_IDLE_MS / 200, DAY);
    expect(b.sleeping).toBe(false);
    ticks(b, SLEEP_IDLE_MS / 200, NIGHT);
    expect(b.sleeping).toBe(true);
    expect(currentPose(b)).toBe('sleep');
    const x = b.motion.x;
    ticks(b, 5, NIGHT);
    expect(b.motion.x).toBe(x);
    expect(wake(b, never)).toBe(true);
    expect(b.sleeping).toBe(false);
    expect(b.talk?.text).toBe('Hi from Fixy.');
  });
  test('work: working pose, no walking, no sleep', () => {
    const b = createBrain(char(), true);
    observeBand(b, { cols: 90, maxRows: 8, isWorking: true }, never);
    expect(b.cols).toBe(90);
    expect(currentPose(b)).toBe('working');
    ticks(b, 2 * SLEEP_IDLE_MS / 200, NIGHT);
    expect(b.motion.x).toBe(0);
    expect(b.sleeping).toBe(false);
  });
  test('quips: only with the option, a tool used, and past the cooldown', () => {
    const b = createBrain(char(), true);
    expect(endTurn(b, true, 45)).toBeNull();
    react(b, { tool: 'Read', isError: false, denied: false, output: '', command: '' }, never);
    expect(endTurn(b, false, 45)).toBeNull();
    expect(b.turn.tools).toEqual([]);
    react(b, { tool: 'Read', isError: false, denied: false, output: '', command: '' }, never);
    expect(endTurn(b, true, 45)).toEqual({ tools: ['Read'], failures: 0, lastBash: '' });
    react(b, { tool: 'Read', isError: false, denied: false, output: '', command: '' }, never);
    expect(endTurn(b, true, 45)).toBeNull();
    ticks(b, 45000 / 200);
    react(b, { tool: 'Read', isError: false, denied: false, output: '', command: '' }, never);
    expect(endTurn(b, true, 45)).not.toBeNull();
  });
  test('a new pose starts at its first frame and steps through every frame in order', () => {
    const b = createBrain(char({ poses: { idle: [['1'], ['2'], ['3'], ['2']], walkRight: [['a'], ['b']] }, motion: { walk: false } }), true);
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      seen.push(sceneOf(b)!.rows.join('').trim());
      ticks(b, 3);
    }
    expect(seen).toEqual(['1', '2', '3', '2', '1', '2', '3', '2', '1']);
    pet(b, never);
    ticks(b, 3);
    sceneOf(b);
    b.talk = null;
    expect(sceneOf(b)!.rows.join('').trim()).toBe('1');
  });

  test('the scene keeps the column a bubble pushed him to', () => {
    const b = createBrain(char(), true);
    observeBand(b, { cols: 100, maxRows: 8, isWorking: false }, never);
    b.motion = { ...b.motion, x: 90 };
    setCharacter(b, b.character, undefined, never);
    const s = sceneOf(b)!;
    expect(s.bubble?.side).toBe('left');
    expect(b.motion.x).toBe(s.x);
  });
});
