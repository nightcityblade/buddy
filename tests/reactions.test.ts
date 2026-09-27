import { describe, expect, test } from 'vitest';
import { REACTIONS, TEST_FAIL, TEST_PASS, bashCommand, classifyToolCall, toolOutput } from '../plugins/buddy/src/reactions.ts';

const bash = (output: string, isError = false) => ({ tool: 'Bash', isError, denied: false, output });

describe('the test patterns', () => {
  test.each(['12 passed', '3 passing', 'ok  \tgithub.com/x/y\t0.2s', 'PASS src/a.test.ts', 'Tests: 5 passed, 5 total', 'Test: 1 passed', 'Ran 5 tests in 0.01s\n\nOK'])('pass: %s', (s) => {
    expect(TEST_PASS.test(s)).toBe(true);
  });
  test.each(['2 failed', '1 failing', 'FAIL src/a.test.ts', '--- FAIL: TestX', 'FAILED tests/test_a.py::t'])('fail: %s', (s) => {
    expect(TEST_FAIL.test(s)).toBe(true);
  });
  test.each(['3 passed; 0 failed', 'test result: ok. 3 passed; 0 failed; 0 ignored', '10 passed, 0 failing'])('a zero count is not a fail: %s', (s) => {
    expect(TEST_FAIL.test(s)).toBe(false);
  });
  test.each(['0 passing', 'Tests: 0 passed, 0 total'])('a zero count is not a pass: %s', (s) => {
    expect(TEST_PASS.test(s)).toBe(false);
  });
  test.each(['passed the salt', 'PASSWORD', 'notok x', 'failed to connect', 'a FAILURE', 'OK', 'Ran 5 tests in 0.01s'])('neither: %s', (s) => {
    expect(TEST_PASS.test(s)).toBe(false);
    expect(TEST_FAIL.test(s)).toBe(false);
  });
});

describe('classifyToolCall', () => {
  test('a cargo run with 0 failed is a pass', () => {
    expect(classifyToolCall(bash('test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured'))).toBe('testPass');
  });
  test('a denial or an error is toolFail', () => {
    expect(classifyToolCall({ tool: 'Edit', isError: false, denied: true, output: '' })).toBe('toolFail');
    expect(classifyToolCall({ tool: 'Read', isError: true, denied: false, output: '' })).toBe('toolFail');
  });
  test('Bash test output: pass, fail, fail over pass', () => {
    expect(classifyToolCall(bash('Tests  12 passed (12)'))).toBe('testPass');
    expect(classifyToolCall(bash('3 failed, 9 passed', true))).toBe('testFail');
    expect(classifyToolCall(bash('ok\nFAIL x'))).toBe('testFail');
  });
  test('a pass pattern in a failed call is a tool failure', () => {
    expect(classifyToolCall(bash('5 passed\nsegfault', true))).toBe('toolFail');
  });
  test('only Bash is read for tests; plain success is nothing', () => {
    expect(classifyToolCall({ tool: 'Read', isError: false, denied: false, output: '12 passed' })).toBeNull();
    expect(classifyToolCall(bash('hello'))).toBeNull();
  });
  test('the table: testPass is yay with confetti, the failures oops', () => {
    expect(REACTIONS.testPass).toEqual({ pose: 'yay', line: 'testPass', confetti: true });
    expect(REACTIONS.testFail.pose).toBe('oops');
    expect(REACTIONS.toolFail.pose).toBe('oops');
  });
});

describe('toolOutput and bashCommand', () => {
  test("core's text, else the result's strings, the tail kept", () => {
    expect(toolOutput({ text: 'T', result: { stdout: 'S' } })).toBe('T');
    expect(toolOutput({ result: { stdout: 'out', stderr: 'err', code: 1 } })).toBe('out\nerr');
    expect(toolOutput({ result: 'plain' })).toBe('plain');
    expect(toolOutput({})).toBe('');
    expect(toolOutput({ text: 'x'.repeat(25000) + 'END' }).endsWith('END')).toBe(true);
    expect(toolOutput({ text: 'x'.repeat(25000) }).length).toBe(20000);
  });
  test('e.command, or e.input.command', () => {
    expect(bashCommand({ command: 'ls' })).toBe('ls');
    expect(bashCommand({ input: { command: 'pwd' } })).toBe('pwd');
    expect(bashCommand({})).toBe('');
  });
});
