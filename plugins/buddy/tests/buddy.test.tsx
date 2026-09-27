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
/** Files by absolute path (with their mtimes), and whether listing the home folder is refused. */
type Disk = { files?: Record<string, string>; mtimes?: Record<string, number>; refuseHome?: boolean };

const HOME = '/test-home';

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
  return { logs, forks, completes, clock, commands, saved, writes };
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

// ---- /buddy adopt ---------------------------------------------------------

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

function title(name: string, variant: 'native' | 'npm'): string {
  const b = roll(UUID, variant).bones;
  return `${name} the ${b.rarity} ${b.species}${b.shiny ? ' (shiny!)' : ''}`;
}

describe('/buddy adopt', () => {
  test('brings back the companion in ~/.claude.json: drawn, greeted, remembered, listed; the file is never written', async ($, on) => {
    const w = world(on, {}, {}, { files: { [CONFIG]: config(MOCHI) } });
    await $.session.start(START);
    const ui = await band($);
    const text = (await $.command.run(run('adopt'))).text ?? '';
    expect(text.split('\n')).toEqual([`${title('Mochi', 'native')} is back.`, 'Account …cafe, rolled as the native install did.', 'Hatched on an npm install? /buddy adopt npm']);
    expect(await shows(ui, /Welcome back, Mochi!/)).toBe(true);
    expect(await shows(ui, eyesOf('native'))).toBe(true);
    expect(w.saved.get('character')).toBe('adopted');
    expect(w.saved.get('adopt')).toEqual({ variant: 'native' });
    expect((await $.command.run(run('list'))).text).toContain('* adopted - Mochi: ');
    expect((await $.command.run(run('use default'))).text).toBe('Back to the default: Professor Fixture');
    expect(w.saved.has('character')).toBe(false);
    expect((await $.command.run(run('list'))).text).toContain('  adopted - Mochi: ');
    expect(w.writes).toEqual([]);
    expect(w.logs.join('\n')).not.toContain(UUID);
    expect([...w.saved.keys()].join(' ')).not.toContain(UUID);
    await ui.unmount();
  });

  test('npm rolls as the npm install did; from {path} reads that file', async ($, on) => {
    const w = world(on, {}, {}, { files: { [CONFIG]: config(MOCHI), '/elsewhere/old.json': config({ ...MOCHI, name: 'Biscuit' }) } });
    await $.session.start(START);
    const ui = await band($);
    const npm = (await $.command.run(run('adopt npm'))).text ?? '';
    expect(npm).toContain(`${title('Mochi', 'npm')} is back.`);
    expect(npm).toContain('Hatched on the native install? /buddy adopt');
    expect(await shows(ui, eyesOf('npm'))).toBe(true);
    expect(w.saved.get('adopt')).toEqual({ variant: 'npm' });
    expect((await $.command.run(run('adopt from /elsewhere/old.json'))).text).toContain(`${title('Biscuit', 'native')} is back.`);
    expect(w.saved.get('adopt')).toEqual({ variant: 'native', path: '/elsewhere/old.json' });
    await ui.unmount();
  });

  test('a read or parse failure is said plainly, switches nothing, and never shows the file', async ($, on) => {
    const w = world(on, { character: 'fixy' }, {}, { files: { '/elsewhere/bad.json': '{"secretToken": oops' } });
    await $.session.start(START);
    const missing = (await $.command.run(run('adopt'))).text ?? '';
    expect(missing).toMatch(/^\/buddy adopt: couldn't read ~\/\.claude\.json: .+\. Nothing was switched\.$/);
    const bad = (await $.command.run(run('adopt from /elsewhere/bad.json'))).text ?? '';
    expect(bad).toBe("/buddy adopt: couldn't parse /elsewhere/bad.json: not valid JSON (SyntaxError). Nothing was switched.");
    expect(w.logs.join('\n')).not.toContain('secretToken');
    expect(w.saved.get('character')).toBe('fixy');
    expect(w.saved.has('adopt')).toBe(false);
  });

  test('no companion: the newest backup that holds one, named, its soul saved under a hash', async ($, on) => {
    const files = {
      [CONFIG]: config(),
      [`${HOME}/.claude.json.bak-20260401`]: config({ ...MOCHI, name: 'Oldie' }),
      [`${HOME}/.claude.json.backup`]: config({ ...MOCHI, name: 'Middle' }),
      [`${HOME}/.claude/backups/.claude.json.backup.1775`]: config({ ...MOCHI, name: 'Newest' }),
      [`${HOME}/.claude.json.lock`]: 'not json',
    };
    const mtimes = { [`${HOME}/.claude.json.bak-20260401`]: 1, [`${HOME}/.claude.json.backup`]: 3, [`${HOME}/.claude/backups/.claude.json.backup.1775`]: 4, [`${HOME}/.claude.json.lock`]: 5 };
    const w = world(on, {}, {}, { files, mtimes });
    await $.session.start(START);
    const text = (await $.command.run(run('adopt'))).text ?? '';
    expect(text).toContain(`${title('Newest', 'native')} is back.`);
    expect(text).toContain('Its soul came from the backup ~/.claude/backups/.claude.json.backup.1775.');
    expect(text).not.toContain("Couldn't");
    const key = [...w.saved.keys()].find((k) => k.startsWith('soul:'));
    expect(key).toMatch(/^soul:[0-9a-f]{16}:native$/);
    expect(w.saved.get(key!)).toMatchObject({ name: 'Newest', from: '~/.claude/backups/.claude.json.backup.1775' });
    expect(w.completes).toEqual([]);
  });

  test('no soul anywhere: the model hatches one (JSON, validated, one retry), then it arrives', async ($, on) => {
    const good = { isAnswered: true, text: '{"name": "Pip", "personality": "A tiny thing who adores tidy diffs."}' };
    const w = world(on, {}, { queue: [{ isAnswered: true, text: 'Pip!' }, good] }, { files: { [CONFIG]: config() } });
    await $.session.start(START);
    const ui = await band($);
    const b = roll(UUID, 'native').bones;
    const text = (await $.command.run(run('adopt'))).text ?? '';
    expect(text).toContain(`No companion found in ~/.claude.json, its backups or a saved soul: hatching a new soul for your ${b.rarity} ${b.species}`);
    await w.clock.settle();
    expect(w.completes).toHaveLength(2);
    expect(w.completes[0]?.system).toContain('Reply with one JSON object and nothing else');
    expect(w.completes[0]?.prompt).toContain(`Species: ${b.species}`);
    expect(w.completes[1]?.prompt).toContain('Your last reply was not usable (no JSON object in the reply)');
    expect(await shows(ui, /Hello! I'm Pip\./)).toBe(true);
    expect(w.saved.get('character')).toBe('adopted');
    const key = [...w.saved.keys()].find((k) => k.startsWith('soul:'));
    expect(w.saved.get(key!)).toMatchObject({ name: 'Pip', personality: 'A tiny thing who adores tidy diffs.' });
    await ui.unmount();
  });

  test('a home it cannot list is said, then it hatches; two bad answers switch nothing', async ($, on) => {
    const bad = { isAnswered: false, reason: 'api-error' };
    const w = world(on, { character: 'fixy' }, { queue: [bad, bad] }, { files: { [CONFIG]: config() }, refuseHome: true });
    await $.session.start(START);
    const ui = await band($);
    const text = (await $.command.run(run('adopt'))).text ?? '';
    expect(text).toMatch(/\nCouldn't list ~ to look for \.claude\.json backups: \S/);
    await w.clock.settle();
    expect(w.completes).toHaveLength(2);
    expect(await shows(ui, new RegExp(`Couldn't hatch a soul for your ${roll(UUID, 'native').bones.species}: api-error`))).toBe(true);
    expect(w.saved.get('character')).toBe('fixy');
    await ui.unmount();
  });

  test('a restart draws the adopted companion again; a lost file says so', async ($, on) => {
    world(on, { character: 'adopted', adopt: { variant: 'native' } }, {}, { files: { [CONFIG]: config(MOCHI) } });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, eyesOf('native'))).toBe(true);
    expect(await shows(ui, /Mochi says hello\./)).toBe(true);
    await ui.unmount();
  });

  test('a restart without the file draws the professor and says why', async ($, on) => {
    world(on, { character: 'adopted', adopt: { variant: 'npm' } });
    await $.session.start(START);
    const ui = await band($);
    expect(await shows(ui, /\(p_p\)/)).toBe(true);
    expect(await shows(ui, /Couldn't load adopted: couldn't read ~\/\.claude\.json/)).toBe(true);
    await ui.unmount();
  });
});
