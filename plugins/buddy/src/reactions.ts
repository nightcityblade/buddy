import type { LineEvent, Pose } from './character.ts';

// What a finished tool call means to the buddy: a table from outcome to pose,
// line pool and effect, so a new reaction is a row, not a branch.

export const TEST_PASS = /\b[1-9]\d* (passed|passing)\b|^ok\s+\S+|\bPASS\b|Tests?:\s+[1-9]\d* passed|\b[1-9]\d* examples?, 0 failures?\b/m;
export const TEST_FAIL = /\b[1-9]\d* (failed|failing)\b|^FAIL\b|^--- FAIL|\bFAILED\b|\b[1-9]\d* examples?, [1-9]\d* failures?\b/m;

export type Outcome = 'toolFail' | 'testPass' | 'testFail';
export type Reaction = { pose: Pose; line: LineEvent; confetti: boolean };

export const REACTIONS: Record<Outcome, Reaction> = {
  toolFail: { pose: 'oops', line: 'toolFail', confetti: false },
  testPass: { pose: 'yay', line: 'testPass', confetti: true },
  testFail: { pose: 'oops', line: 'testFail', confetti: false },
};

export type ToolCall = { tool: string; isError: boolean; denied: boolean; output: string };

/**
 * A denied or failed call is `toolFail`; Bash output matching the fail pattern
 * is `testFail`, the pass pattern and not the fail one `testPass`.
 */
export function classifyToolCall(c: ToolCall): Outcome | null {
  if (c.denied) return 'toolFail';
  if (c.tool === 'Bash') {
    if (TEST_FAIL.test(c.output)) return 'testFail';
    if (TEST_PASS.test(c.output)) return c.isError ? 'toolFail' : 'testPass';
  }
  return c.isError ? 'toolFail' : null;
}

const OUTPUT_CAP = 20000;

/**
 * The text a tool call produced: core's `text` when it is a string, else the
 * string fields of `result` (stdout, stderr, ...). The tail is kept, where a
 * test runner prints its summary.
 */
export function toolOutput(r: { text?: unknown; result?: unknown }): string {
  let out = '';
  if (typeof r.text === 'string') out = r.text;
  else if (typeof r.result === 'string') out = r.result;
  else if (typeof r.result === 'object' && r.result !== null) {
    out = Object.values(r.result as Record<string, unknown>).filter((v): v is string => typeof v === 'string').join('\n');
  }
  return out.length > OUTPUT_CAP ? out.slice(-OUTPUT_CAP) : out;
}

/** The shell command of a Bash call: `e.command`, or `e.input.command`. */
export function bashCommand(e: { command?: unknown; input?: unknown }): string {
  if (typeof e.command === 'string') return e.command;
  const input = e.input as { command?: unknown } | undefined;
  return typeof input?.command === 'string' ? input.command : '';
}
