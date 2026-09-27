import type { On } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';
import { roll } from '../src/hatch.ts';

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
/** Files by absolute path (with their mtimes), whether listing the home folder is refused, a store key prefix whose writes are refused. */
type Disk = { files?: Record<string, string>; mtimes?: Record<string, number>; refuseHome?: boolean; refuseStore?: string };

const HOME = '/test-home';
const SESSION = 'test-session';

function world(on: On, store: Record<string, unknown> = {}, answers: { fork?: Answer; complete?: Answer; queue?: Answer[] } = {}, disk: Disk = {}) {
  const logs: string[] = [];
  const forks: string[] = [];
  const completes: { model: string; system?: string; prompt: string }[] = [];
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const commands: string[] = [];
  const writes: string[] = [];
  const queue = [...(answers.queue ?? [])];
  const saved = new Map(Object.entries(store));
  const files = disk.files ?? {};
  const opens: object[] = [];
  const closes: string[] = [];
  on('ui.open', async (_$, e) => {
    opens.push(e);
    return { value: { isPlaced: true as const } };
  });
  on('ui.close', async (_$, e) => {
    closes.push(e.id);
    return { value: undefined };
  });
  // Beneath the plugins, the ring lands where it was asked to.
  on('ui.focus', async () => ({}));
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }));
  on('fs.write', async (_$, e) => {
    writes.push(e.path);
    return { value: undefined };
  });
  on('fs.stat', async (_$, e) => {
    if (files[e.path] === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: { kind: 'file' as const, size: files[e.path]!.length, mtimeMs: disk.mtimes?.[e.path] ?? 0, isLink: false } };
  });
  on('store.get', async (_$, e) => ({ value: saved.get(e.key) }));
  on('store.set', async (_$, e) => {
    if (disk.refuseStore && e.key.startsWith(disk.refuseStore)) throw new Error(`EACCES: not allowed to write ${e.key}`);
    saved.set(e.key, e.value);
    return { value: undefined };
  });
  on('store.keys', async () => ({ value: [...saved.keys()] }));
  on('session.id', async () => ({ value: SESSION }));
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
  on('fs.exists', async (_$, e) => ({ value: Object.keys(files).some((f) => f === e.path || f.startsWith(`${e.path}/`)) }));
  on('fs.list', async (_$, e) => {
    if (e.path === HOME || e.path.startsWith(`${HOME}/`)) {
      // A thrown answer reaches the plugin as the kit's own rejection, not this message.
      if (disk.refuseHome && e.path === HOME) throw new Error(`EPERM: not allowed to list ${e.path}`);
      const names = Object.keys(files).filter((f) => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/'));
      return { value: names.map((f) => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: files[f]!.length, isLink: false })) };
    }
    if (!e.path.endsWith('/characters')) throw new Error(`ENOENT: ${e.path}`);
    return { value: Object.entries(FILES).map(([name, text]) => ({ name, kind: 'file' as const, size: text.length, isLink: false })) };
  });
  on('fs.read', async (_$, e) => {
    if (files[e.path] !== undefined) return { value: files[e.path]! };
    const art = /\/species\/([a-z]+)\.json$/.exec(e.path);
    if (art) return { value: art[1] === 'hats' ? HAT_ART : speciesArt(art[1]!) };
    if (e.path.startsWith(`${HOME}/`)) throw new Error(`ENOENT: ${e.path}`);
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
    return { value: { usage, ...(queue.shift() ?? answers.complete ?? { isAnswered: true, text: 'A completed answer.' }) } } as never;
  });
  return { logs, forks, completes, clock, commands, saved, writes, opens, closes };
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
    expect(w.commands).toEqual(['buddy', 'buddy-personality']);
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
    // The greeting the bubble showed is remembered, before the question.
    expect(w.completes[0]?.prompt).toMatch(/^Recently \(oldest first\):\nFixy: Fixy says hi\.\n[\s\S]*The user asks you directly: hello\?$/);
    expect(await shows(ui, /Fresh answer\./)).toBe(true);
    await ui.unmount();
  });

  test('the second question remembers the first answer, before the question; kept per session in the store', async ($, on) => {
    const w = world(on, { character: 'fixy' }, { fork: { isAnswered: true, text: 'Forty-two, friend.' } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(run('remember the word pineapple'));
    await w.clock.settle();
    expect(w.forks[0]).not.toContain('Forty-two');
    await $.command.run(run('what word?'));
    await w.clock.settle();
    const p = w.forks[1]!;
    // One exchange for the question with its answer; the thinking filler (Fixy ponders.) is never remembered.
    expect(p).toContain('Recently (oldest first):\nFixy: Fixy says hi.\nYou: remember the word pineapple\nFixy: Forty-two, friend.\n');
    expect(p).not.toContain('Fixy ponders.');
    expect(p).toContain('you may refer back to it');
    expect(p.indexOf('Fixy: Forty-two, friend.')).toBeLessThan(p.indexOf('The user asks you directly: what word?'));
    expect(p).not.toContain('You: what word?');
    expect(w.saved.get(`memory:${SESSION}`)).toMatchObject({
      characters: {
        fixy: [
          { kind: 'line', text: 'Fixy says hi.' },
          { kind: 'question', question: 'remember the word pineapple', answer: 'Forty-two, friend.' },
          { kind: 'question', question: 'what word?', answer: 'Forty-two, friend.' },
        ],
      },
    });
    await ui.unmount();
  });

  test('the fresh-session completion carries the memory too', async ($, on) => {
    const w = world(on, { character: 'fixy', [`memory:${SESSION}`]: { at: 1, characters: { fixy: [{ kind: 'question', question: 'remember pineapple', answer: 'Pineapple, noted.' }] } } }, { fork: { isAnswered: false, reason: 'nothing-to-fork' } });
    await $.session.start(START);
    await $.command.run(run('which word?'));
    await w.clock.settle();
    expect(w.completes[0]?.prompt).toMatch(/^Recently \(oldest first\):\nYou: remember pineapple\nFixy: Pineapple, noted\.\n[\s\S]*The user asks you directly: which word\?$/);
  });

  test('a switched character never claims another one\'s words', async ($, on) => {
    const w = world(on, { character: 'fixy' }, { fork: { isAnswered: true, text: 'Forty-two, friend.' } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(run('remember the word pineapple'));
    await w.clock.settle();
    await $.command.run(run('use professor'));
    await ui.unmount();
    const again = await band($);
    await $.command.run(run('what word?'));
    await w.clock.settle();
    expect(w.forks[1]).toContain('Professor Fixture: Professor fixture here.');
    expect(w.forks[1]).not.toMatch(/pineapple|Forty-two|Fixy/);
    await again.unmount();
  });

  test('a memory that cannot be saved is said in the next reply, never left out in silence', async ($, on) => {
    const w = world(on, { character: 'fixy' }, {}, { refuseStore: 'memory:' });
    await $.session.start(START);
    await $.command.run(run('first?'));
    await w.clock.settle();
    const out = (await $.command.run(run('second?'))).text;
    // The kit turns the refusal into its own rejection: the reply names what failed and the kit's reason.
    expect(out).toMatch(/^Asked Fixy\. \(Its memory: remembering the (question|answer|line) failed: .+\)$/);
    expect(w.logs.some((l) => /^buddy: remembering the (question|answer|line) failed: .+/.test(l))).toBe(true);
    expect(w.saved.has(`memory:${SESSION}`)).toBe(false);
  });

  test('a malformed stored memory is said in the reply, and what is sound is still remembered', async ($, on) => {
    const w = world(on, { character: 'fixy', [`memory:${SESSION}`]: { at: 1, characters: { fixy: [{ who: 'you', kind: 'question', text: 'old shape' }, { kind: 'line', text: 'Still here.' }] } } });
    await $.session.start(START);
    const out = (await $.command.run(run('anyone?'))).text;
    await w.clock.settle();
    expect(out).toBe('Asked Fixy. (Its memory: reading the memory failed: the stored memory had 1 malformed exchange, dropped)');
    expect(w.logs).toContain('buddy: reading the memory failed: the stored memory had 1 malformed exchange, dropped');
    expect(w.forks[0]).toContain('Fixy: Still here.');
    expect(w.forks[0]).not.toContain('old shape');
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

// ---- /buddy-personality ---------------------------------------------------

// An invented account and companion: never a real ~/.claude.json.
const UUID = '7e57ab1e-0000-4c0d-9e11-5eedf00dcafe';
const MOCHI = { name: 'Mochi', personality: 'A round little creature who hums at green tests.', hatchedAt: 1775001600000 };
const CONFIG = `${HOME}/.claude.json`;
const HAT_ART = JSON.stringify({ crown: 'www', tophat: '_|_', propeller: '-+-', halo: '(_)', wizard: '/^\\', beanie: '(__)', tinyduck: '<o)' });
const B = '        ';

function speciesArt(species: string): string {
  const eyes = '  <{E}{E}>  ';
  const body = '  /__\\  ';
  return JSON.stringify({
    species,
    width: 8,
    hatCol: 3,
    poses: {
      idle: [[B, eyes, body], [B, eyes, body], [B, '  <-->  ', body]],
      walkRight: [[B, eyes, body], [B, eyes, '  /  \\  ']],
      oops: [[B, eyes, '  /!!\\  ']],
      yay: [[B, eyes, '  \\__/  ']],
      sleep: [[B, '  <-->  ', body]],
    },
    lines: { greeting: ['{name} says hello.'] },
  });
}

function config(companion?: object): string {
  return JSON.stringify({ userID: 'an-invented-user-id', oauthAccount: { accountUuid: UUID }, ...(companion ? { companion } : {}) });
}

function eyesOf(variant: 'native' | 'npm'): RegExp {
  const e = roll(UUID, variant).bones.eye.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<${e}${e}>`);
}

const PANE = 'buddy-personality';

function menu() {
  return { command: PANE, args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paneOf($: any) {
  return $.ui.mount({ plugin: 'buddy', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Pick a personality', isFocused: true, bodyColumns: 100, placement: 'inline' } });
}

/** The person's arrow (or Tab) moving the pane's focus ring onto `key`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function focus($: any, key: string): Promise<void> {
  await $.ui.focus({ component: 'Pane', requestId: PANE, element: key, origin: { kind: 'person' } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function label(ui: any, key: string): Promise<unknown> {
  return (await ui.find({ key }))?.props.label;
}

describe('/buddy-personality', () => {
  test('opens a focused pane: the groups titled, the current one marked and previewed', async ($, on) => {
    const w = world(on, { character: 'fixy' }, {}, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    expect(w.commands).toEqual(['buddy', PANE]);
    expect((await $.command.run(menu())).text).toBe('Pick a personality: ↑/↓ move, Enter picks, Esc closes.');
    expect(w.opens).toEqual([{ id: PANE, title: 'Pick a personality', focus: true, closeOnEscape: true, rows: expect.any(Number) }]);
    const pane = await paneOf($);
    for (const title of [/^Shipped$/, /^Yours$/, /^Your folder$/]) expect(await shows(pane, title)).toBe(true);
    expect(await label(pane, 'use:fixy')).toBe('* Fixy (fixy)');
    expect(await label(pane, 'use:professor')).toBe('  Professor Fixture (professor)');
    expect(await label(pane, 'use:broken')).toBe('  broken (invalid)');
    expect(await shows(pane, /^Fixy$/)).toBe(true);
    expect(await shows(pane, /^Fixy, a test fixture\.$/)).toBe(true);
    expect(await shows(pane, /You are Fixy/)).toBe(false);
    expect(await shows(pane, /^“Fixy says hi\.”$/)).toBe(true);
    expect(await shows(pane, /^No folder set: the characterDir option names one\.$/)).toBe(true);
    await pane.unmount();
  });

  test('down moves the highlight and the preview follows; Enter picks, remembers, closes and greets', async ($, on) => {
    const w = world(on, { character: 'fixy' }, {}, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(menu());
    const pane = await paneOf($);
    await focus($, 'use:professor');
    expect(await shows(pane, /^Professor Fixture$/)).toBe(true);
    expect(await shows(pane, /^Fixy$/)).toBe(false);
    await focus($, 'use:broken');
    expect(await shows(pane, /^Can't draw it: persona: required$/)).toBe(true);
    await pane.press({ key: 'use:professor' });
    await w.clock.settle();
    expect(w.saved.get('character')).toBe('professor');
    expect(await shows(ui, /\(p_p\)/)).toBe(true);
    expect(await shows(ui, /Professor fixture here\./)).toBe(true);
    expect((await $.command.run(run('list'))).text).toContain('* professor - Professor Fixture');
    expect(w.closes).toEqual([PANE]);
    await ui.unmount();
  });

  // The kit cannot raise the person's Esc (ui.close, origin person): the open
  // asks closeOnEscape, and live-proof (i) watches Esc close it for real.
  test('Esc: asked for at the open; a highlight alone changes nothing', async ($, on) => {
    const w = world(on, { character: 'fixy' }, {}, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(menu());
    const pane = await paneOf($);
    await focus($, 'use:professor');
    expect(await shows(pane, /^Professor Fixture$/)).toBe(true);
    expect(w.opens).toMatchObject([{ closeOnEscape: true }]);
    expect(w.closes).toEqual([]);
    expect(w.saved.get('character')).toBe('fixy');
    expect(await shows(ui, /\(f_f\)/)).toBe(true);
    expect((await $.command.run(run('list'))).text).toContain('* fixy - Fixy');
    await pane.unmount();
    await ui.unmount();
  });

  test('a companion in ~/.claude.json: two Yours entries; the preview animates and shows its card; Enter draws it and saves soul and roll', async ($, on) => {
    const w = world(on, {}, {}, { files: { [CONFIG]: config(MOCHI) } });
    await $.session.start(START);
    const ui = await band($);
    await $.command.run(menu());
    const pane = await paneOf($);
    expect(await label(pane, 'original:native')).toBe('  Mochi — native install');
    expect(await label(pane, 'original:npm')).toBe('  Mochi — npm install');
    await focus($, 'original:npm');
    expect(await shows(pane, /^Mochi$/)).toBe(true);
    expect(await shows(pane, eyesOf('npm'))).toBe(true);
    expect(await shows(pane, /^hatched 2026-04-01$/)).toBe(true);
    expect(await shows(pane, /^A round little creature who hums at green tests\.$/)).toBe(true);
    expect(await shows(pane, /You are Mochi/)).toBe(false);
    expect(await shows(pane, /^SNARK +[█░]{10} \d+$/)).toBe(true);
    expect(await shows(pane, /<-->/)).toBe(false);
    await w.clock.advance(1000);
    expect(await shows(pane, /<-->/)).toBe(true);
    await pane.press({ key: 'original:npm' });
    await w.clock.settle();
    expect(w.saved.get('character')).toBe('original');
    expect(w.saved.get('original')).toEqual({ variant: 'npm', soul: MOCHI });
    expect(await shows(ui, eyesOf('npm'))).toBe(true);
    expect(await shows(ui, /Mochi says hello\./)).toBe(true);
    expect((await $.command.run(run('list'))).text).toContain('* original - Mochi: ');
    expect(w.writes).toEqual([]);
    expect(w.logs.join('\n')).not.toContain(UUID);
    expect(JSON.stringify([...w.saved.entries()])).not.toContain(UUID);
    await ui.unmount();
  });

  test('a restart draws the saved original with no backup scan; without the file it says why', async ($, on) => {
    world(on, { character: 'original', original: { variant: 'npm', soul: MOCHI } }, {}, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, eyesOf('npm'))).toBe(true);
    expect(await shows(ui, /Mochi says hello\./)).toBe(true);
    await ui.unmount();
  });

  test('a restart without ~/.claude.json draws the professor and says why', async ($, on) => {
    world(on, { character: 'original', original: { variant: 'native', soul: MOCHI } });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /\(p_p\)/)).toBe(true);
    expect(await shows(ui, /Couldn't load original: couldn't read ~\/\.claude\.json/)).toBe(true);
    await ui.unmount();
  });

  test('no companion in the file: the newest backup holding one, named', async ($, on) => {
    const files = {
      [CONFIG]: config(),
      [`${HOME}/.claude.json.bak-20260401`]: config({ ...MOCHI, name: 'Oldie' }),
      [`${HOME}/.claude/backups/.claude.json.backup.1775`]: config({ ...MOCHI, name: 'Newest' }),
      [`${HOME}/.claude.json.lock`]: 'not json',
    };
    const mtimes = { [`${HOME}/.claude.json.bak-20260401`]: 1, [`${HOME}/.claude/backups/.claude.json.backup.1775`]: 4, [`${HOME}/.claude.json.lock`]: 5 };
    world(on, {}, {}, { files, mtimes });
    await $.session.start(START);
    await $.command.run(menu());
    const pane = await paneOf($);
    expect(await label(pane, 'original:native')).toBe('  Newest — native install');
    expect(await shows(pane, /^From the backup ~\/\.claude\/backups\/\.claude\.json\.backup\.1775\.$/)).toBe(true);
  });

  test('an unreadable ~/.claude.json is a plain line in Yours', async ($, on) => {
    world(on);
    await $.session.start(START);
    await $.command.run(menu());
    const pane = await paneOf($);
    expect(await shows(pane, /^couldn't read ~\/\.claude\.json: \S/)).toBe(true);
    expect(await pane.find({ key: 'original:native' })).toBeUndefined();
  });

  test('an invalid ~/.claude.json is a plain line in Yours, never its contents', async ($, on) => {
    const w = world(on, {}, {}, { files: { [CONFIG]: '{"secretToken": oops' } });
    await $.session.start(START);
    await $.command.run(menu());
    const pane = await paneOf($);
    expect(await shows(pane, /^couldn't parse ~\/\.claude\.json: not valid JSON \(SyntaxError\)$/)).toBe(true);
    expect(w.logs.join('\n')).not.toContain('secretToken');
  });

  test('no companion anywhere says so in one line', async ($, on) => {
    world(on, {}, {}, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    await $.command.run(menu());
    const pane = await paneOf($);
    expect(await shows(pane, /^No companion in ~\/\.claude\.json or its backups\.$/)).toBe(true);
  });
});
