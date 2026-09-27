import { describe, expect, test } from 'vitest';
import { DEFAULTS, expandHome, resolveOptions } from '../plugins/buddy/src/options.ts';

describe('resolveOptions', () => {
  test('the manifest defaults', () => {
    expect(resolveOptions({})).toEqual({ ...DEFAULTS, errors: [] });
    expect(DEFAULTS).toEqual({ character: 'professor', characterDir: '', motion: true, questionMode: 'fork', quips: false, quipModel: 'haiku', quipCooldownSec: 45 });
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

describe('expandHome', () => {
  test('~ and ~/ only', () => {
    expect(expandHome('~/chars', '/opt/me')).toBe('/opt/me/chars');
    expect(expandHome('~', '/opt/me/')).toBe('/opt/me');
    expect(expandHome('/abs/chars', '/opt/me')).toBe('/abs/chars');
    expect(expandHome('~other', '/opt/me')).toBe('~other');
    expect(expandHome('~/chars', undefined)).toBe('~/chars');
  });
});
