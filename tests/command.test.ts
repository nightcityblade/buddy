import { describe, expect, test } from 'vitest';
import { USAGE, parseCommand } from '../plugins/buddy/src/command.ts';

describe('parseCommand', () => {
  test.each([
    ['', { kind: 'pet' }],
    ['   ', { kind: 'pet' }],
    ['list', { kind: 'list' }],
    ['LIST', { kind: 'list' }],
    ['off', { kind: 'off' }],
    ['on', { kind: 'on' }],
    ['reload', { kind: 'reload' }],
    ['help', { kind: 'help' }],
    ['use cat', { kind: 'use', id: 'cat' }],
    ['use  Cat ', { kind: 'use', id: 'cat' }],
    ['use default', { kind: 'useDefault' }],
    ['list the files', { kind: 'question', text: 'list the files' }],
    ['use the force', { kind: 'question', text: 'use the force' }],
    ['what is a monad?', { kind: 'question', text: 'what is a monad?' }],
  ])('%j', (args, action) => {
    expect(parseCommand(args)).toEqual(action);
  });
  test('use alone asks for an id', () => {
    expect(parseCommand('use')).toEqual({ kind: 'usage', message: expect.stringMatching(/^usage: \/buddy use \{id\}/) });
  });
  test('the usage names every command', () => {
    for (const word of ['list', 'use {id}', 'off', 'on', 'reload', 'help', '{question}']) expect(USAGE).toContain(word);
  });
});

describe('parseCommand: adopt', () => {
  test('adopt, adopt npm, adopt from {path} [npm]', () => {
    expect(parseCommand('adopt')).toEqual({ kind: 'adopt', variant: 'native' });
    expect(parseCommand(' ADOPT npm ')).toEqual({ kind: 'adopt', variant: 'npm' });
    expect(parseCommand('adopt native')).toEqual({ kind: 'adopt', variant: 'native' });
    expect(parseCommand('adopt from ~/old/.claude.json')).toEqual({ kind: 'adopt', variant: 'native', path: '~/old/.claude.json' });
    expect(parseCommand('adopt from ~/My Backups/claude.json npm')).toEqual({ kind: 'adopt', variant: 'npm', path: '~/My Backups/claude.json' });
  });

  test('adopt from with no path is usage; other words make a question', () => {
    expect(parseCommand('adopt from')).toMatchObject({ kind: 'usage' });
    expect(parseCommand('adopt a cat please')).toEqual({ kind: 'question', text: 'adopt a cat please' });
  });
});
