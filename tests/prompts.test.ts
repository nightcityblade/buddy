import { describe, expect, test } from 'vitest';
import { ONE_LINE_RULE, forkPrompt, lostThread, oneLine, oneLineSystem, questionPrompt, quipPrompt } from '../plugins/buddy/src/prompts.ts';

describe('prompts', () => {
  test('the fork prompt: persona, the question, the one-line rule', () => {
    expect(forkPrompt('You are X.', 'why')).toBe(
      'You are X.\n\nThe user asks you directly: why. Answer in ONE line, at most 25 words, in character. Do not use tools. Do not think out loud.',
    );
  });
  test('the completion system and prompt', () => {
    expect(oneLineSystem('You are X.')).toBe(`You are X.\n\n${ONE_LINE_RULE}`);
    expect(questionPrompt('hi')).toBe('The user asks you directly: hi');
  });
  test('the quip prompt counts tools and caps the command', () => {
    const p = quipPrompt({ tools: ['Bash', 'Read', 'Bash'], failures: 1, lastBash: 'x'.repeat(200) });
    expect(p).toBe(`The turn just ended. Tools used: Bash x2, Read. Failures: 1. Last shell command: ${'x'.repeat(120)}. React to it.`);
    expect(quipPrompt({ tools: ['Read'], failures: 0, lastBash: '' })).toContain('Last shell command: none.');
  });
  test('oneLine takes the first non-empty line, unquoted, capped', () => {
    expect(oneLine('\n  "Hello there."  \nmore')).toBe('Hello there.');
    expect(oneLine('')).toBe('');
    expect(oneLine('y'.repeat(300))).toHaveLength(240);
  });
  test('lostThread', () => {
    expect(lostThread('Fixy', 'api-error')).toBe('(Fixy lost the thread: api-error)');
  });
});
