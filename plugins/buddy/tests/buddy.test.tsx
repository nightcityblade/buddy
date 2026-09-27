import type { On } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

// Run with `claude plugin test plugins/buddy` (CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1).
// The plugin loads from this folder; `on` here sits beneath it and answers
// `$.fs`, `$.store`, `$.clock`, `$.model` and the rest from memory, so these
// tests draw inline fixture characters, never the shipped characters/*.json.

const START = { cwd: '.', surface: null, isInteractive: true } as const;
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 };

function fixture(id: string, name: string, face: string, lines: Record<string, string[]> = {}) {
  return JSON.stringify({
    id,
    name,
    description: `${name}, a test fixture.`,
    persona: `You are ${name}, a test fixture.`,
    poses: {
      idle: [[` (${face}) `, ' /| |\\ ']],
      walkRight: [[` (${face})>`, ' /| |\\ '], [` (${face})>`, ' /|_|\\ ']],
      oops: [[` (${face.toUpperCase()})!`, ' /| |\\ ']],
      yay: [[` \\${face}/ `, '  | |  ']],
      thinking: [[` (${face})?`, ' /| |\\ ']],
    },
    lines,
    // No random rests: a test that waits for a step must see one.
    motion: { restChance: 0 },
  });
}

const FILES: Record<string, string> = {
  'professor.json': fixture('professor', 'Professor Fixture', 'p_p', { greeting: ['Professor fixture here.'] }),
  'fixy.json': fixture('fixy', 'Fixy', 'f_f', {
    greeting: ['Fixy says hi.'],
    petted: ['Fixy purrs.'],
    toolFail: ['Fixy: oh no.'],
    testPass: ['Fixy: green!'],
    testFail: ['Fixy: red!'],
    thinking: ['Fixy ponders.'],
    farewell: ['Fixy waves.'],
  }),
  'broken.json': JSON.stringify({ id: 'broken', name: 'Broken', description: 'no persona', poses: { idle: [['x']] }, motion: { walk: false } }),
  'notes.txt': 'not a character',
};

type Answer = { isAnswered: boolean; text?: string; reason?: string; usage?: object };

function world(on: On, store: Record<string, unknown> = {}, answers: { fork?: Answer; complete?: Answer } = {}) {
  const logs: string[] = [];
  const forks: string[] = [];
  const completes: { model: string; system?: string; prompt: string }[] = [];
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const commands: string[] = [];
  const saved = new Map(Object.entries(store));
  on('store.get', async (_$, e) => ({ value: saved.get(e.key) }));
  on('store.set', async (_$, e) => {
    saved.set(e.key, e.value);
    return { value: undefined };
  });
  on('store.delete', async (_$, e) => {
    saved.delete(e.key);
    return { value: undefined };
  });
  const clock = mock.clock(on);
  on('ui.log', async (_$, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on('command.register', async (_$, e) => {
    commands.push(e.name);
    return { value: { command: e.name } };
  });
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('fs.list', async (_$, e) => {
    if (!e.path.endsWith('/characters')) throw new Error(`ENOENT: ${e.path}`);
    return { value: Object.entries(FILES).map(([name, text]) => ({ name, kind: 'file' as const, size: text.length, isLink: false })) };
  });
  on('fs.read', async (_$, e) => {
    const text = FILES[e.path.split('/').pop() ?? ''];
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: text };
  });
  on('model.fork', async (_$, e) => {
    forks.push(e.prompt);
    return { value: { usage, ...(answers.fork ?? { isAnswered: true, text: 'A forked answer.' }) } } as never;
  });
  on('model.complete', async (_$, e) => {
    completes.push({ model: e.model, system: e.system, prompt: e.prompt });
    return { value: { usage, ...(answers.complete ?? { isAnswered: true, text: 'A completed answer.' }) } } as never;
  });
  return { logs, forks, completes, clock, commands, saved };
}

function run(args: string) {
  return { command: 'buddy', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function band($: any, props: Partial<typeof BAND> = {}) {
  return $.ui.mount({ plugin: 'buddy', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, ...props } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shows(ui: any, text: RegExp): Promise<boolean> {
  return (await ui.find({ type: 'Text', text })) !== undefined;
}

describe('the band', () => {
  test('draws the stored character and its greeting', async ($, on) => {
    world(on, { character: 'fixy' });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /\(f_f\)/)).toBe(true);
    expect(await shows(ui, /Fixy says hi\./)).toBe(true);
    await ui.unmount();
  });

  test('defaults to the professor', async ($, on) => {
    world(on);
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /\(p_p\)/)).toBe(true);
    expect(await shows(ui, /Professor fixture here\./)).toBe(true);
    await ui.unmount();
  });

  test('an invalid choice draws the professor and says why, in the bubble and the log', async ($, on) => {
    const w = world(on, { character: 'broken' });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /\(p_p\)/)).toBe(true);
    expect(await shows(ui, /Couldn't load broken: persona: required/)).toBe(true);
    expect(w.logs).toContain('buddy: character broken (builtin) is invalid: persona: required');
    await ui.unmount();
  });

  test('an unknown choice says so', async ($, on) => {
    world(on, { character: 'ghost' });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /Couldn't load ghost: no such character/)).toBe(true);
    await ui.unmount();
  });

  test('yields to a survey and hides below its width', async ($, on) => {
    world(on, { character: 'fixy' });
    on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
      const { Text } = $$.ui.resolve(e);
      return <Text>the engine's band</Text>;
    });
    await $.session.start(START);
    const survey = await band($, { hasSurvey: true });
    expect(await shows(survey, /\(f_f\)/)).toBe(false);
    expect(await shows(survey, /the engine's band/)).toBe(true);
    await survey.unmount();
    const narrow = await band($, { bodyColumns: 8 });
    expect(await shows(narrow, /\(f_f\)/)).toBe(false);
    await narrow.unmount();
  });

  test('walks once the greeting ends', async ($, on) => {
    const w = world(on, { character: 'fixy' });
    await $.session.start(START);
    const ui = await band($);
    await w.clock.advance(7000);
    expect(await shows(ui, /Fixy says hi\./)).toBe(false);
    const before = JSON.stringify(await ui.drawn());
    await w.clock.advance(1000);
    expect(JSON.stringify(await ui.drawn())).not.toBe(before);
    await ui.unmount();
  });
});

describe('/buddy', () => {
  test('is registered at session start', async ($, on) => {
    const w = world(on);
    await $.session.start(START);
    expect(w.commands).toEqual(['buddy']);
  });

  test('pets, counts and remembers', async ($, on) => {
    const w = world(on, { character: 'fixy', pets: 4 });
    await $.session.start(START);
    const ui = await band($);
    expect((await $.command.run(run(''))).text).toBe('Fixy: 5 pets');
    expect(w.saved.get('pets')).toBe(5);
    expect(await shows(ui, /Fixy purrs\./)).toBe(true);
    await ui.unmount();
  });

  test('list marks the current one and the invalid one', async ($, on) => {
    world(on, { character: 'fixy' });
    await $.session.start(START);
    const out = (await $.command.run(run('list'))).text;
    expect(out).toContain('* fixy - Fixy: Fixy, a test fixture.');
    expect(out).toContain('  broken - INVALID: persona: required');
    expect(out).toContain('  professor - Professor Fixture');
    expect(out).not.toContain('notes');
  });

  test('use switches and persists; use default clears; an unknown id lists the valid ones', async ($, on) => {
    const w = world(on);
    await $.session.start(START);
    const ui = await band($);
    expect((await $.command.run(run('use fixy'))).text).toBe('Now: Fixy');
    expect(w.saved.get('character')).toBe('fixy');
    expect(await shows(ui, /\(f_f\)/)).toBe(true);
    expect((await $.command.run(run('use ghost'))).text).toBe('No character "ghost". Valid: fixy, professor');
    expect((await $.command.run(run('use broken'))).text).toBe("Can't use broken: persona: required. Valid: fixy, professor");
    expect((await $.command.run(run('use default'))).text).toBe('Back to the default: Professor Fixture');
    expect(w.saved.has('character')).toBe(false);
    await ui.unmount();
  });

  test('off hides and persists; on shows again', async ($, on) => {
    const w = world(on, { character: 'fixy' });
    on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
      const { Text } = $$.ui.resolve(e);
      return <Text>the engine's band</Text>;
    });
    await $.session.start(START);
    const ui = await band($);
    expect((await $.command.run(run('off'))).text).toBe('Fixy: "Fixy waves." (hidden; /buddy on brings Fixy back)');
    expect(w.saved.get('hidden')).toBe(true);
    expect(await shows(ui, /\(f_f\)/)).toBe(false);
    expect(await shows(ui, /the engine's band/)).toBe(true);
    expect((await $.command.run(run('on'))).text).toBe('Fixy is back');
    expect(await shows(ui, /\(f_f\)/)).toBe(true);
    await ui.unmount();
  });

  test('a question forks the chat with the persona and the one-line rule', async ($, on) => {
    const w = world(on, { character: 'fixy' }, { fork: { isAnswered: true, text: '"Forty-two, friend."\nand more' } });
    await $.session.start(START);
    const ui = await band($);
    expect((await $.command.run(run('what is up'))).text).toBe('Asked Fixy.');
    await w.clock.settle();
    expect(w.forks[0]).toContain('You are Fixy, a test fixture.');
    expect(w.forks[0]).toContain('The user asks you directly: what is up. Answer in ONE line, at most 25 words, in character. Do not use tools. Do not think out loud.');
    expect(await shows(ui, /^Forty-two, friend\.$/)).toBe(true);
    await ui.unmount();
  });

  test('nothing to fork falls back to the quip model', async ($, on) => {
    const w = world(on, { character: 'fixy' }, { fork: { isAnswered: false, reason: 'nothing-to-fork' }, complete: { isAnswered: true, text: 'Fresh answer.' } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(run('hello?'));
    await w.clock.settle();
    expect(w.completes[0]?.model).toBe('haiku');
    expect(w.completes[0]?.system).toContain('You are Fixy, a test fixture.');
    expect(w.completes[0]?.prompt).toBe('The user asks you directly: hello?');
    expect(await shows(ui, /Fresh answer\./)).toBe(true);
    await ui.unmount();
  });

  test('a failed answer says the thread was lost', async ($, on) => {
    const w = world(on, { character: 'fixy' }, { fork: { isAnswered: false, reason: 'api-error' } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(run('why?'));
    await w.clock.settle();
    expect(await shows(ui, /\(Fixy lost the thread: api-error\)/)).toBe(true);
    expect(w.logs).toContain('buddy: a /buddy question got no answer: api-error');
    await ui.unmount();
  });
});

describe('reactions', () => {
  test('a failed tool call: oops and the toolFail line', async ($, on) => {
    world(on, { character: 'fixy' });
    on('tool.call', async () => ({ result: { stdout: '', stderr: 'boom' }, text: 'boom', isError: true }) as never);
    await $.session.start(START);
    const ui = await band($);
    await $.tool.call({ tool: 'Bash', command: 'false' } as never);
    expect(await shows(ui, /\(F_F\)!/)).toBe(true);
    expect(await shows(ui, /Fixy: oh no\./)).toBe(true);
    await ui.unmount();
  });

  test('a passing test run: yay and the testPass line', async ($, on) => {
    world(on, { character: 'fixy' });
    on('tool.call', async () => ({ result: { stdout: 'Tests  12 passed (12)' }, text: 'Tests  12 passed (12)' }) as never);
    await $.session.start(START);
    const ui = await band($);
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never);
    expect(await shows(ui, /\\f_f\//)).toBe(true);
    expect(await shows(ui, /Fixy: green!/)).toBe(true);
    await ui.unmount();
  });

  test('a failing test run: oops and the testFail line', async ($, on) => {
    world(on, { character: 'fixy' });
    on('tool.call', async () => ({ result: { stdout: '3 failed, 9 passed' }, text: '3 failed, 9 passed', isError: true }) as never);
    await $.session.start(START);
    const ui = await band($);
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never);
    expect(await shows(ui, /Fixy: red!/)).toBe(true);
    await ui.unmount();
  });
});
