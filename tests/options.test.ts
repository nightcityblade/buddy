import { describe, expect, test } from 'vitest';
import { DEFAULTS, expandHome, resolveOptions } from '../plugins/buddy/src/options.ts';

describe('resolveOptions', () => {
  test('the manifest defaults', () => {
    expect(resolveOptions({})).toEqual({ ...DEFAULTS, errors: [] });
    expect(DEFAULTS).toEqual({ character: 'professor', characterDir: '', motion: true, questionMode: 'fork', quips: false, quipModel: 'haiku', quipCooldownSec: 45, memory: 6 });
  });
  test('good values', () => {
    const o = resolveOptions({ character: ' Cat ', characterDir: '~/chars', motion: false, questionMode: 'COMPLETE', quips: 'true', quipModel: 'sonnet', quipCooldownSec: '10' });
    expect(o).toMatchObject({ character: 'cat', characterDir: '~/chars', motion: false, questionMode: 'complete', quips: true, quipModel: 'sonnet', quipCooldownSec: 10, errors: [] });
  });
  test('a bad value is ignored by name', () => {
    const o = resolveOptions({ questionMode: 'loud', motion: 'maybe', quipCooldownSec: -1 });
    expect(o.questionMode).toBe('fork');
    expect(o.motion).toBe(true);
    expect(o.quipCooldownSec).toBe(45);
    expect(o.errors).toEqual([
      'option motion ignored: "maybe" is not true or false',
      'option questionMode ignored: "loud" is not fork, complete or off',
      'option quipCooldownSec ignored: -1 is not a number of seconds',
    ]);
  });
});

describe('the memory option', () => {
  test('default 6; 0 is off; a whole number as given', () => {
    expect(resolveOptions({}).memory).toBe(6);
    expect(resolveOptions({ memory: 0 })).toMatchObject({ memory: 0, errors: [] });
    expect(resolveOptions({ memory: '12' })).toMatchObject({ memory: 12, errors: [] });
    expect(resolveOptions({ memory: 30 })).toMatchObject({ memory: 30, errors: [] });
  });
  test('above 30 caps at 30 and says so', () => {
    expect(resolveOptions({ memory: 31 })).toMatchObject({ memory: 30, errors: ['option memory capped: 31 is above 30; remembering 30'] });
  });
  test('negative, fractional or not a number: 6, and the note says why', () => {
    expect(resolveOptions({ memory: -1 })).toMatchObject({ memory: 6, errors: ['option memory ignored: -1 is not a whole number of exchanges; remembering 6'] });
    expect(resolveOptions({ memory: 2.5 })).toMatchObject({ memory: 6, errors: ['option memory ignored: 2.5 is not a whole number of exchanges; remembering 6'] });
    expect(resolveOptions({ memory: 'x' })).toMatchObject({ memory: 6, errors: ['option memory ignored: "x" is not a whole number of exchanges; remembering 6'] });
    expect(resolveOptions({ memory: true })).toMatchObject({ memory: 6, errors: ['option memory ignored: true is not a whole number of exchanges; remembering 6'] });
  });
});

describe('expandHome', () => {
  test('~ and ~/ only', () => {
    expect(expandHome('~/chars', '/opt/me')).toBe('/opt/me/chars');
    expect(expandHome('~', '/opt/me/')).toBe('/opt/me');
    expect(expandHome('/abs/chars', '/opt/me')).toBe('/abs/chars');
    expect(expandHome('~other', '/opt/me')).toBe('~other');
    expect(expandHome('~/chars', undefined)).toBe('~/chars');
  });
});
