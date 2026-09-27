import type { EngineInterface, ModelForkResult, On, PluginOptions, Register, Timer, ToolCallInput, ToolCallResult } from 'claude-code';
import {
  BUBBLE_MS, ERROR_MS, answer, beginQuestion, createBrain, endTurn, failAnswer, farewell, greet, observeBand, period, pet, react, sceneOf, setCharacter, speak,
  tick, wake,
  type Brain,
} from '../src/brain.ts';
import {
  ADOPTED_ID, SHOWN_CONFIG, SOUL_MAX_TOKENS, SOUL_SYSTEM, adoptCharacter, adoptChoiceOf, adoptReply, companionOf, identityOf, isBackupName,
  newestFirst, parseSoul, savedSoulOf, soulKey, soulPrompt, welcomeLine,
  type AdoptChoice, type Soul, type SoulOrigin,
} from '../src/adopt.ts';
import { USAGE, parseCommand } from '../src/command.ts';
import { expandHome, resolveOptions, type Options } from '../src/options.ts';
import { QUESTION_MAX_TOKENS, QUIP_MAX_TOKENS, forkPrompt, oneLine, oneLineSystem, questionPrompt, quipPrompt, type TurnSummary } from '../src/prompts.ts';
import { identityKey, maskIdentity, roll, type Roll } from '../src/hatch.ts';
import { bashCommand, toolOutput } from '../src/reactions.ts';
import {
  choose, findEntry, formatList, isCharacterFile, loadEntries, mergeRoster, validIds, withEntry,
  type Entry, type LoadedFile, type Roster, type Source,
} from '../src/roster.ts';
import type { Scene } from '../src/scene.ts';
import { validateHats, validateSpecies, type HatArt, type SpeciesTemplate } from '../src/species.ts';

// The adapter: the only file touching `$`. Every decision lives in ../src/;
// this wires Claude Code's events to it, grouped by event, and draws the scene.

const COMMAND = 'buddy';

type State = {
  options: Options;
  roster: Roster;
  b: Brain | null;
  storeChoice: string | undefined;
  /** The adopted companion's roster entry, once /buddy adopt (or a restart) loaded it. */
  adopted: Entry | null;
  adoptChoice: AdoptChoice | undefined;
  hidden: boolean;
  pets: number;
  timer: Timer | null;
  clockPeriod: number;
  lastKey: string;
  lastTickError: string;
};

type BandProps = { hasSurvey: boolean; isWorking: boolean; maxRows: number; bodyColumns: number };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log($: EngineInterface, what: string, error: unknown): void {
  $.ui.log(`buddy: ${what} failed: ${message(error)}`);
}

// ---- roster -------------------------------------------------------------

async function readDir($: EngineInterface, dir: string, source: Source): Promise<{ entries: Entry[]; error?: string }> {
  let listing;
  try {
    listing = await $.fs.list(dir);
  } catch (error) {
    return { entries: [], error: `couldn't read ${dir}: ${message(error)}` };
  }
  const files: LoadedFile[] = [];
  const names = listing.filter((f) => isCharacterFile(f.name, f.kind)).map((f) => f.name).sort();
  for (const name of names) {
    try {
      const text = await $.fs.read(`${dir}/${name}`);
      files.push(typeof text === 'string' ? { name, text } : { name, error: 'unreadable: not text' });
    } catch (error) {
      files.push({ name, error: `unreadable: ${message(error)}` });
    }
  }
  return { entries: loadEntries(files, source) };
}

async function loadRoster(st: State, $: EngineInterface): Promise<void> {
  const errors: string[] = [];
  const builtin = await readDir($, `${$.plugin.root}/characters`, 'builtin');
  if (builtin.error) errors.push(builtin.error);
  let user: Entry[] = [];
  if (st.options.characterDir) {
    let dir = st.options.characterDir;
    if (dir.startsWith('~')) dir = expandHome(dir, await $.env.get('HOME'));
    const mine = await readDir($, dir.replace(/\/+$/, ''), 'user');
    if (mine.error) errors.push(mine.error);
    user = mine.entries;
  }
  st.roster = mergeRoster(builtin.entries, user, errors);
  if (st.adopted) st.roster = withEntry(st.roster, st.adopted);
  for (const e of errors) $.ui.log(`buddy: ${e}`);
  for (const e of st.roster.entries) if (e.error) $.ui.log(`buddy: character ${e.id} (${e.source}) is invalid: ${e.error}`);
}

/** Draws the stored/option/default choice; a bad one draws the Professor and says why. */
function applyChoice(st: State, $: EngineInterface): void {
  const choice = choose(st.roster, st.storeChoice, st.options.character);
  if (choice.error) $.ui.log(`buddy: ${choice.error}`);
  if (!st.b) st.b = createBrain(choice.character, st.options.motion);
  st.b.pets = st.pets;
  setCharacter(st.b, choice.character, choice.error, Math.random);
}

// ---- clock and redraw ---------------------------------------------------

function refresh(st: State, $: EngineInterface): void {
  if (!st.b || st.hidden) return;
  const key = JSON.stringify(sceneOf(st.b));
  if (key === st.lastKey) return;
  st.lastKey = key;
  $.ui.invalidate('ui.render');
}

function stopClock(st: State): void {
  st.timer?.cancel();
  st.timer = null;
}

function startClock(st: State, $: EngineInterface): void {
  stopClock(st);
  if (!st.b || st.hidden) return;
  st.clockPeriod = period(st.b);
  st.timer = $.clock.every(st.clockPeriod, () => onTick(st, $));
}

function onTick(st: State, $: EngineInterface): void {
  try {
    if (!st.b) return;
    tick(st.b, new Date().getHours(), Math.random);
    refresh(st, $);
    if (period(st.b) !== st.clockPeriod) startClock(st, $);
  } catch (error) {
    if (message(error) === st.lastTickError) return;
    st.lastTickError = message(error);
    log($, 'a clock tick', error);
  }
}

// ---- session.start ------------------------------------------------------

async function readStore(st: State, $: EngineInterface): Promise<void> {
  try {
    const pets = await $.store.get('pets');
    st.pets = typeof pets === 'number' && Number.isFinite(pets) ? pets : 0;
  } catch (error) {
    log($, 'reading the pet count', error);
  }
  try {
    st.hidden = (await $.store.get('hidden')) === true;
  } catch (error) {
    log($, 'reading /buddy off', error);
  }
  try {
    const choice = await $.store.get('character');
    st.storeChoice = typeof choice === 'string' && choice !== '' ? choice : undefined;
  } catch (error) {
    log($, 'reading the /buddy use choice', error);
  }
  try {
    st.adoptChoice = adoptChoiceOf(await $.store.get('adopt'));
  } catch (error) {
    log($, 'reading the /buddy adopt choice', error);
  }
}

async function startSession(st: State, $: EngineInterface): Promise<void> {
  for (const e of st.options.errors) $.ui.log(`buddy: ${e}`);
  await readStore(st, $);
  await loadRoster(st, $);
  if ((st.storeChoice ?? st.options.character) === ADOPTED_ID) await restoreAdopted(st, $);
  applyChoice(st, $);
  try {
    await $.command.register({ name: COMMAND, description: 'Pet your buddy, ask it something, or: list, use {id}, adopt [npm], off, on, reload, help', argumentHint: '[question] | list | use {id} | adopt [from {path}] [npm] | off | on | reload | help', immediate: true });
  } catch (error) {
    log($, `registering /${COMMAND}`, error);
  }
  startClock(st, $);
  st.lastKey = '';
  $.ui.invalidate('ui.render');
}

// ---- ui.render: AbovePrompt ---------------------------------------------

function bandScene(st: State, p: BandProps): Scene | null {
  if (p.hasSurvey || !st.b || st.hidden) return null;
  observeBand(st.b, { cols: p.bodyColumns, maxRows: p.maxRows, isWorking: p.isWorking }, Math.random);
  const scene = sceneOf(st.b);
  st.lastKey = JSON.stringify(scene);
  return scene;
}

type Component = any;

function drawBand(Box: Component, Text: Component, s: Scene) {
  const bubble = s.bubble ? (
    <Box borderStyle="round" paddingX={1} width={s.bubble.width} alignSelf="flex-start">
      <Text italic wrap="wrap">{s.bubble.text}</Text>
    </Box>
  ) : null;
  const card = s.card ? (
    <Box position="absolute" top={0} left={s.card.left} width={s.card.width} display="none" hover={{ display: 'flex' }} borderStyle="round" flexDirection="column" paddingX={1}>
      {s.card.lines.map((line, i) => <Text bold={i === 0} dimColor={i === 2} wrap="truncate-end">{line}</Text>)}
    </Box>
  ) : null;
  const sprite = (
    <Box key="buddy" flexDirection="column">
      {s.rows.map((row) => <Text color={s.color}>{row}</Text>)}
      {card}
    </Box>
  );
  const left = s.bubble?.side === 'left';
  return (
    <Box flexDirection="column">
      {s.effects.map((segs) => (
        <Box flexDirection="row">
          {segs.length === 0 ? <Text> </Text> : segs.map((g) => <Box marginLeft={g.pad}><Text color={g.color}>{g.text}</Text></Box>)}
        </Box>
      ))}
      <Box flexDirection="row" marginLeft={s.rowX} gap={1}>
        {left ? bubble : sprite}
        {left ? sprite : bubble}
      </Box>
    </Box>
  );
}

// ---- tool.call and turn.complete ----------------------------------------

function onToolCall(st: State, $: EngineInterface, e: ToolCallInput, r: ToolCallResult): void {
  try {
    if (!st.b) return;
    const call = e as unknown as { tool: string; command?: unknown; input?: unknown };
    const res = r as unknown as { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown };
    react(st.b, { tool: call.tool, isError: res.isError === true, denied: typeof res.deny === 'string', output: toolOutput(res), command: call.tool === 'Bash' ? bashCommand(call) : '' }, Math.random);
    refresh(st, $);
  } catch (error) {
    log($, 'reacting to a tool call', error);
  }
}

async function quip(st: State, $: EngineInterface, t: TurnSummary): Promise<void> {
  const b = st.b;
  if (!b) return;
  try {
    const r = await $.model.complete({ model: st.options.quipModel, system: oneLineSystem(b.character.persona), prompt: quipPrompt(t), maxTokens: QUIP_MAX_TOKENS });
    const text = r.isAnswered ? oneLine(r.text) : '';
    if (text) answer(b, text, t.failures > 0 ? 'oops' : 'yay');
    else {
      const reason = r.isAnswered ? 'empty reply' : r.reason;
      $.ui.log(`buddy: a quip got no answer: ${reason}`);
      failAnswer(b, reason);
    }
  } catch (error) {
    log($, 'a quip', error);
    failAnswer(b, message(error));
  }
  refresh(st, $);
}

function onTurnComplete(st: State, $: EngineInterface): void {
  try {
    if (!st.b) return;
    wake(st.b, Math.random);
    const due = endTurn(st.b, st.options.quips && !st.hidden, st.options.quipCooldownSec);
    if (due) quip(st, $, due).catch((error) => log($, 'a quip', error));
    refresh(st, $);
  } catch (error) {
    log($, 'the end of a turn', error);
  }
}

// ---- /buddy adopt -------------------------------------------------------

/** What an adoption found: the bones, the art, and the soul unless it must be hatched. */
type Found = {
  /** The identity as it may be shown (its last 4 characters) and as a store key (its hash). */
  account: string;
  idHash: string;
  choice: AdoptChoice;
  roll: Roll;
  template: SpeciesTemplate;
  hats: HatArt;
  soul?: Soul;
  origin?: SoulOrigin;
  notes: string[];
};

/** A JSON file, parsed: an error names the file and why, never its contents. */
async function readJson($: EngineInterface, path: string, shown: string): Promise<{ value?: unknown; error?: string }> {
  let text: unknown;
  try {
    text = await $.fs.read(path);
  } catch (error) {
    return { error: `couldn't read ${shown}: ${message(error)}` };
  }
  if (typeof text !== 'string') return { error: `couldn't read ${shown}: not text` };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    // The parser's message may quote the file: only its kind is said.
    return { error: `couldn't parse ${shown}: not valid JSON (${error instanceof Error ? error.name : typeof error})` };
  }
}

async function homeOf($: EngineInterface): Promise<string | undefined> {
  try {
    const home = await $.env.get('HOME');
    return home ? home.replace(/\/+$/, '') : undefined;
  } catch (error) {
    log($, 'reading HOME', error);
    return undefined;
  }
}

/** The species template, and the hat art when the companion wears a hat. */
async function loadArt($: EngineInterface, r: Roll): Promise<{ template?: SpeciesTemplate; hats: HatArt; error?: string }> {
  const dir = `${$.plugin.root}/species`;
  const species = r.bones.species;
  const file = await readJson($, `${dir}/${species}.json`, `species/${species}.json`);
  if (file.error) return { hats: {}, error: file.error };
  const v = validateSpecies(file.value, species);
  if (!v.ok) return { hats: {}, error: `species/${species}.json is invalid: ${v.error}` };
  if (r.bones.hat === 'none') return { template: v.template, hats: {} };
  const hats = await readJson($, `${dir}/hats.json`, 'species/hats.json');
  if (hats.error) return { hats: {}, error: hats.error };
  const h = validateHats(hats.value);
  if (!h.ok) return { hats: {}, error: `species/hats.json is invalid: ${h.error}` };
  return { template: v.template, hats: h.hats };
}

/** The newest backup of ~/.claude.json that parses and holds a companion; `notes` says what could not be looked at. */
async function backupSoul($: EngineInterface, home: string, notes: string[]): Promise<{ soul: Soul; label: string } | null> {
  const found: { path: string; label: string; name: string }[] = [];
  try {
    for (const f of await $.fs.list(home)) if (f.kind !== 'dir' && isBackupName(f.name)) found.push({ path: `${home}/${f.name}`, label: `~/${f.name}`, name: f.name });
  } catch (error) {
    log($, 'listing ~ for .claude.json backups', error);
    notes.push(`Couldn't list ~ to look for .claude.json backups: ${message(error)}`);
  }
  const dir = `${home}/.claude/backups`;
  try {
    // No backups folder is no backups; a folder that cannot be listed is said.
    if (await $.fs.exists(dir)) for (const f of await $.fs.list(dir)) if (f.kind !== 'dir') found.push({ path: `${dir}/${f.name}`, label: `~/.claude/backups/${f.name}`, name: f.name });
  } catch (error) {
    log($, 'listing ~/.claude/backups', error);
    notes.push(`Couldn't list ~/.claude/backups: ${message(error)}`);
  }
  const dated = await Promise.all(
    found.map(async (c) => {
      try {
        return { ...c, mtimeMs: (await $.fs.stat(c.path)).mtimeMs };
      } catch (error) {
        log($, `reading the date of ${c.label}`, error);
        return { ...c, mtimeMs: 0 };
      }
    }),
  );
  let skipped = 0;
  for (const c of dated.sort(newestFirst)) {
    const j = await readJson($, c.path, c.label);
    if (j.error) {
      skipped++;
      $.ui.log(`buddy: skipping a backup: ${j.error}`);
      continue;
    }
    const s = companionOf(j.value);
    if (s.soul) return { soul: s.soul, label: c.label };
  }
  if (skipped > 0) notes.push(`Skipped ${skipped} backup${skipped === 1 ? '' : 's'} that did not read or parse.`);
  return null;
}

/**
 * Everything /buddy adopt needs: the config read (never written), the bones
 * rolled, the art loaded, and the soul from the file, our store or (with
 * `scanBackups`) the newest backup. No soul: the caller hatches one.
 */
async function findAdoption($: EngineInterface, choice: AdoptChoice, scanBackups: boolean): Promise<Found | { error: string }> {
  const home = await homeOf($);
  let path: string;
  const shown = choice.path ?? SHOWN_CONFIG;
  if (choice.path) path = expandHome(choice.path, home);
  else if (home) path = `${home}/.claude.json`;
  else return { error: `couldn't read ${SHOWN_CONFIG}: HOME is not set` };
  const config = await readJson($, path, shown);
  if (config.error !== undefined) return { error: config.error };
  const identity = identityOf(config.value);
  const companion = companionOf(config.value);
  if (companion.error) return { error: `${shown} has a companion, but ${companion.error}` };
  const r = roll(identity, choice.variant);
  const art = await loadArt($, r);
  if (!art.template) return { error: art.error ?? `no species art for the ${r.bones.species}` };
  const found: Found = { account: maskIdentity(identity), idHash: identityKey(identity), choice, roll: r, template: art.template, hats: art.hats, notes: [] };
  if (companion.soul) return { ...found, soul: companion.soul, origin: { kind: 'file' } };
  try {
    const saved = savedSoulOf(await $.store.get(soulKey(found.idHash, choice.variant)));
    if (saved.soul) return { ...found, soul: saved.soul, origin: saved.label ? { kind: 'backup', label: saved.label } : { kind: 'saved' } };
  } catch (error) {
    log($, 'reading the saved soul', error);
    found.notes.push(`Couldn't read the saved soul: ${message(error)}`);
  }
  if (!scanBackups) return found;
  if (choice.path) {
    found.notes.push(`Backups are looked for only beside ${SHOWN_CONFIG}, not beside ${choice.path}.`);
    return found;
  }
  const backup = await backupSoul($, home!, found.notes);
  return backup ? { ...found, soul: backup.soul, origin: { kind: 'backup', label: backup.label } } : found;
}

/** Draws the adopted companion and remembers it: an error switches nothing. */
async function switchToAdopted(st: State, $: EngineInterface, f: Found, soul: Soul, origin: SoulOrigin): Promise<{ error?: string; note: string }> {
  const b = st.b;
  if (!b) return { error: 'buddy is still starting; try again in a moment', note: '' };
  const v = adoptCharacter({ soul, bones: f.roll.bones, variant: f.choice.variant, template: f.template, hats: f.hats });
  if (!v.ok) return { error: v.error, note: '' };
  st.adopted = { id: ADOPTED_ID, source: 'adopted', character: v.character };
  st.roster = withEntry(st.roster, st.adopted);
  st.storeChoice = ADOPTED_ID;
  st.adoptChoice = f.choice;
  let note = await save($, 'character', ADOPTED_ID);
  note += await save($, 'adopt', f.choice.path ? { variant: f.choice.variant, path: f.choice.path } : { variant: f.choice.variant });
  if (origin.kind === 'hatched' || origin.kind === 'backup') {
    note += await save($, soulKey(f.idHash, f.choice.variant), origin.kind === 'backup' ? { ...soul, from: origin.label } : soul);
  }
  setCharacter(b, v.character, undefined, Math.random);
  speak(b, welcomeLine(origin, soul.name), 'yay', BUBBLE_MS);
  startClock(st, $);
  st.lastKey = '';
  $.ui.invalidate('ui.render');
  return { note };
}

/** No soul anywhere: the model names one (JSON, validated, one retry), then the switch. */
async function hatch(st: State, $: EngineInterface, f: Found): Promise<void> {
  const b = st.b;
  if (!b) return;
  const bones = f.roll.bones;
  let error = '';
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await $.model.complete({ model: st.options.quipModel, system: SOUL_SYSTEM, prompt: soulPrompt(bones, f.roll.inspirationSeed, error), maxTokens: SOUL_MAX_TOKENS });
      const p = r.isAnswered ? parseSoul(r.text) : { error: r.reason };
      if (p.soul) {
        const done = await switchToAdopted(st, $, f, { ...p.soul, hatchedAt: Date.now() }, { kind: 'hatched' });
        if (done.error === undefined) {
          if (done.note) $.ui.log(`buddy: /buddy adopt${done.note}`);
          return;
        }
        error = done.error;
        break;
      }
      error = p.error ?? 'no soul in the reply';
      $.ui.log(`buddy: hatching a soul, attempt ${attempt}: ${error}`);
    }
  } catch (err) {
    log($, 'hatching a soul', err);
    error = message(err);
  }
  $.ui.log(`buddy: /buddy adopt failed: couldn't hatch a soul: ${error}`);
  speak(b, `Couldn't hatch a soul for your ${bones.species}: ${error}`, 'oops', ERROR_MS);
  refresh(st, $);
}

async function adopt(st: State, $: EngineInterface, choice: AdoptChoice): Promise<string> {
  const f = await findAdoption($, choice, true);
  if ('error' in f) {
    $.ui.log(`buddy: /buddy adopt failed: ${f.error}`);
    return `/buddy adopt: ${f.error}. Nothing was switched.`;
  }
  if (f.soul && f.origin) {
    const done = await switchToAdopted(st, $, f, f.soul, f.origin);
    if (done.error !== undefined) {
      $.ui.log(`buddy: /buddy adopt failed: ${done.error}`);
      return `/buddy adopt: ${done.error}. Nothing was switched.`;
    }
    return adoptReply({ name: f.soul.name, bones: f.roll.bones, variant: choice.variant, origin: f.origin, account: f.account, notes: f.notes }) + done.note;
  }
  hatch(st, $, f).catch((error) => log($, 'hatching a soul', error));
  const where = choice.path ?? `${SHOWN_CONFIG}, its backups or a saved soul`;
  const b = f.roll.bones;
  return [`No companion found in ${where}: hatching a new soul for your ${b.rarity} ${b.species}${b.shiny ? ' (shiny!)' : ''} (account ${f.account}, rolled as the ${choice.variant} install did).`, ...f.notes].join('\n');
}

/** At start, with "adopted" chosen: the companion again, never a new hatch. */
async function restoreAdopted(st: State, $: EngineInterface): Promise<void> {
  const choice: AdoptChoice = st.adoptChoice ?? { variant: 'native' };
  let error: string;
  try {
    const f = await findAdoption($, choice, false);
    if ('error' in f) error = f.error;
    else if (!f.soul) error = `no companion in ${choice.path ?? SHOWN_CONFIG} and no saved soul; /buddy adopt looks again`;
    else {
      const v = adoptCharacter({ soul: f.soul, bones: f.roll.bones, variant: choice.variant, template: f.template, hats: f.hats });
      error = v.ok ? '' : v.error;
      if (v.ok) st.adopted = { id: ADOPTED_ID, source: 'adopted', character: v.character };
    }
  } catch (err) {
    log($, 'restoring the adopted buddy', err);
    error = message(err);
  }
  if (error) st.adopted = { id: ADOPTED_ID, source: 'adopted', error };
  if (st.adopted) st.roster = withEntry(st.roster, st.adopted);
}

// ---- command.run: /buddy ------------------------------------------------

async function save($: EngineInterface, key: string, value: unknown): Promise<string> {
  try {
    if (value === undefined) await $.store.delete(key);
    else await $.store.set(key, value);
    return '';
  } catch (error) {
    log($, `saving ${key}`, error);
    return ` (not saved: ${message(error)})`;
  }
}

async function ask(st: State, $: EngineInterface, question: string): Promise<void> {
  const b = st.b;
  if (!b) return;
  const c = b.character;
  try {
    const complete = () => $.model.complete({ model: st.options.quipModel, system: oneLineSystem(c.persona), prompt: questionPrompt(question), maxTokens: QUESTION_MAX_TOKENS });
    let r: ModelForkResult;
    if (st.options.questionMode === 'fork') {
      r = await $.model.fork({ prompt: forkPrompt(c.persona, question) });
      // A new session has no reply to fork from yet: ask the quip model alone.
      if (!r.isAnswered && r.reason === 'nothing-to-fork') r = await complete();
    } else r = await complete();
    const text = r.isAnswered ? oneLine(r.text) : '';
    if (text) answer(b, text);
    else {
      const reason = r.isAnswered ? 'empty reply' : r.reason;
      $.ui.log(`buddy: a /buddy question got no answer: ${reason}`);
      failAnswer(b, reason);
    }
  } catch (error) {
    log($, 'a /buddy question', error);
    failAnswer(b, message(error));
  }
  refresh(st, $);
}

async function runCommand(st: State, $: EngineInterface, args: string): Promise<{ text: string }> {
  const b = st.b;
  if (!b) return { text: 'buddy is still starting; try again in a moment' };
  const action = parseCommand(args);
  try {
    switch (action.kind) {
      case 'pet': {
        pet(b, Math.random);
        st.pets = b.pets;
        const note = await save($, 'pets', b.pets);
        refresh(st, $);
        return { text: `${b.character.name}: ${b.pets} pets${note}` };
      }
      case 'list':
        return { text: formatList(st.roster, b.character, st.options.errors) };
      case 'use': {
        const entry = findEntry(st.roster, action.id);
        const valid = validIds(st.roster).join(', ') || 'none';
        if (!entry) return { text: `No character "${action.id}". Valid: ${valid}` };
        if (!entry.character) return { text: `Can't use ${action.id}: ${entry.error}. Valid: ${valid}` };
        st.storeChoice = action.id;
        const note = await save($, 'character', action.id);
        setCharacter(b, entry.character, undefined, Math.random);
        startClock(st, $);
        refresh(st, $);
        return { text: `Now: ${entry.character.name}${note}` };
      }
      case 'useDefault': {
        st.storeChoice = undefined;
        const note = await save($, 'character', undefined);
        applyChoice(st, $);
        startClock(st, $);
        refresh(st, $);
        return { text: `Back to the default: ${b.character.name}${note}` };
      }
      case 'off': {
        const line = farewell(b, Math.random);
        st.hidden = true;
        const note = await save($, 'hidden', true);
        stopClock(st);
        $.ui.invalidate('ui.render');
        return { text: `${b.character.name}: "${line}" (hidden; /buddy on brings ${b.character.name} back)${note}` };
      }
      case 'on': {
        st.hidden = false;
        const note = await save($, 'hidden', false);
        wake(b, Math.random);
        greet(b, Math.random);
        startClock(st, $);
        st.lastKey = '';
        $.ui.invalidate('ui.render');
        return { text: `${b.character.name} is back${note}` };
      }
      case 'reload': {
        await loadRoster(st, $);
        applyChoice(st, $);
        startClock(st, $);
        refresh(st, $);
        const bad = st.roster.entries.filter((e) => !e.character).length;
        return { text: `Reloaded ${st.roster.entries.length} characters (${bad} invalid); drawing ${b.character.name}` };
      }
      case 'adopt':
        return { text: await adopt(st, $, action.path ? { variant: action.variant, path: action.path } : { variant: action.variant }) };
      case 'help':
        return { text: [USAGE, ...st.options.errors].join('\n') };
      case 'usage':
        return { text: action.message };
      case 'question': {
        if (st.options.questionMode === 'off') return { text: 'questions are off (questionMode)' };
        if (st.hidden) return { text: `${b.character.name} is hidden; /buddy on first` };
        beginQuestion(b, Math.random);
        refresh(st, $);
        ask(st, $, action.text).catch((error) => log($, 'a /buddy question', error));
        return { text: `Asked ${b.character.name}.` };
      }
    }
  } catch (error) {
    log($, `/buddy ${args.trim()}`, error);
    return { text: `/buddy ${args.trim()} failed: ${message(error)}` };
  }
}

// ---- wiring, grouped by event -------------------------------------------

export const register: Register = (on: On, options: PluginOptions) => {
  const st: State = {
    options: resolveOptions(options as Record<string, unknown>),
    roster: mergeRoster([], []),
    b: null,
    storeChoice: undefined,
    adopted: null,
    adoptChoice: undefined,
    hidden: false,
    pets: 0,
    timer: null,
    clockPeriod: 0,
    lastKey: '',
    lastTickError: '',
  };

  on('session.start', async ($, e, next) => {
    const result = await next(e);
    try {
      await startSession(st, $);
    } catch (error) {
      log($, 'starting', error);
    }
    return result;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const scene = bandScene(st, e.props);
      if (!scene) return next(e);
      const { Box, Text } = $.ui.resolve(e);
      return drawBand(Box, Text, scene);
    } catch (error) {
      log($, 'drawing the band', error);
      return next(e);
    }
  });

  on('tool.call', async ($, e, next) => {
    const r = await next(e);
    onToolCall(st, $, e, r);
    return r;
  });

  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    onTurnComplete(st, $);
    return r;
  });

  on('command.run', { command: COMMAND }, async ($, e) => runCommand(st, $, e.args));
};
