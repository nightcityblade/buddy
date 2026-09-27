import type { EngineInterface, ModelForkResult, On, PluginOptions, Register, Timer, ToolCallInput, ToolCallResult } from 'claude-code';
import {
  ERROR_MS, answer, beginQuestion, createBrain, endTurn, failAnswer, farewell, greet, observeBand, period, pet, react, sceneOf, setCharacter, speak,
  tick, wake,
  type Brain,
} from '../src/brain.ts';
import type { Character } from '../src/character.ts';
import { USAGE, parseCommand } from '../src/command.ts';
import {
  MENU_COMMAND, MENU_PANE, MENU_TITLE, PREVIEW_MS, allItems, buildMenu, currentKeyOf, findItem, menuRows, previewOf, rowLabel,
  type Item, type Menu, type Originals,
} from '../src/menu.ts';
import { expandHome, resolveOptions, type Options } from '../src/options.ts';
import { QUESTION_MAX_TOKENS, QUIP_MAX_TOKENS, forkPrompt, oneLine, oneLineSystem, questionPrompt, quipPrompt, type TurnSummary } from '../src/prompts.ts';
import { roll, type Roll, type Variant } from '../src/hatch.ts';
import {
  CONFIG_NAME, ORIGINAL_ID, SHOWN_CONFIG, VARIANTS, companionOf, identityOf, isBackupName, newestFirst, originalCharacter, savedOriginalOf,
  type SavedOriginal, type Soul,
} from '../src/original.ts';
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
  /** The original companion's roster entry, once picked in the menu (or restored at a start). */
  original: Entry | null;
  /** The picked original's roll and soul, as saved: a restart draws it with no backup scan. */
  saved: SavedOriginal | undefined;
  /** Why characters/ or the characterDir could not be listed: the menu says it in the group. */
  shippedError: string | undefined;
  folderError: string | undefined;
  menu: MenuState | null;
  hidden: boolean;
  pets: number;
  timer: Timer | null;
  clockPeriod: number;
  lastKey: string;
  lastTickError: string;
};

/** The open menu: its rows, the one drawn now, where the focus started and is, the preview's frame. */
type MenuState = { model: Menu; current: string; start: string; focused: string; frame: number; timer: Timer | null; soul: Soul | null };

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
  st.shippedError = builtin.error;
  st.folderError = undefined;
  let user: Entry[] = [];
  if (st.options.characterDir) {
    let dir = st.options.characterDir;
    if (dir.startsWith('~')) dir = expandHome(dir, await $.env.get('HOME'));
    const mine = await readDir($, dir.replace(/\/+$/, ''), 'user');
    if (mine.error) errors.push(mine.error);
    st.folderError = mine.error;
    user = mine.entries;
  }
  st.roster = mergeRoster(builtin.entries, user, errors);
  if (st.original) st.roster = withEntry(st.roster, st.original);
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
    st.saved = savedOriginalOf(await $.store.get('original'));
  } catch (error) {
    log($, 'reading the saved original companion', error);
  }
}

async function startSession(st: State, $: EngineInterface): Promise<void> {
  for (const e of st.options.errors) $.ui.log(`buddy: ${e}`);
  await readStore(st, $);
  await loadRoster(st, $);
  if ((st.storeChoice ?? st.options.character) === ORIGINAL_ID) await restoreOriginal(st, $);
  applyChoice(st, $);
  try {
    await $.command.register({ name: COMMAND, description: 'Pet your buddy, ask it something, or: list, use {id}, off, on, reload, help', argumentHint: '[question] | list | use {id} | off | on | reload | help', immediate: true });
  } catch (error) {
    log($, `registering /${COMMAND}`, error);
  }
  try {
    await $.command.register({ name: MENU_COMMAND, description: 'Pick your buddy from a menu with a live preview: the shipped characters, your original companion, your folder', immediate: true });
  } catch (error) {
    log($, `registering /${MENU_COMMAND}`, error);
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

// ---- the original companion ---------------------------------------------

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

/** ~/.claude.json, read and never written: the identity it rolls from, and its companion when it has one. */
async function readConfig($: EngineInterface): Promise<{ identity: string; home: string; soul?: Soul } | { error: string }> {
  const home = await homeOf($);
  if (!home) return { error: `couldn't read ${SHOWN_CONFIG}: HOME is not set` };
  const config = await readJson($, `${home}/${CONFIG_NAME}`, SHOWN_CONFIG);
  if (config.error !== undefined) return { error: config.error };
  const companion = companionOf(config.value);
  if (companion.error) return { error: `${SHOWN_CONFIG} has a companion, but ${companion.error}` };
  const identity = identityOf(config.value);
  return companion.soul ? { identity, home, soul: companion.soul } : { identity, home };
}

/** One roll of the original, drawn: the Character, or why its art will not draw. */
async function rollOriginal($: EngineInterface, identity: string, soul: Soul, variant: Variant): Promise<{ character?: Character; error?: string }> {
  const r = roll(identity, variant);
  const art = await loadArt($, r);
  if (!art.template) return { error: art.error ?? `no species art for the ${r.bones.species}` };
  const v = originalCharacter({ soul, bones: r.bones, variant, template: art.template, hats: art.hats });
  return v.ok ? { character: v.character } : { error: v.error };
}

/** The "Yours" group: the companion in ~/.claude.json, else the newest backup holding one, rolled both ways. */
async function findOriginals($: EngineInterface): Promise<Originals> {
  const config = await readConfig($);
  if ('error' in config) {
    $.ui.log(`buddy: /${MENU_COMMAND}: ${config.error}`);
    return { kind: 'error', error: config.error };
  }
  const notes: string[] = [];
  let soul = config.soul;
  let from: string | undefined;
  if (!soul) {
    const backup = await backupSoul($, config.home, notes);
    if (backup) ({ soul, label: from } = backup);
  }
  if (!soul) return { kind: 'none', notes };
  const rolls: { variant: Variant; character?: Character; error?: string }[] = [];
  for (const variant of VARIANTS) {
    const r = await rollOriginal($, config.identity, soul, variant);
    if (r.error) $.ui.log(`buddy: the ${variant} roll of your original companion will not draw: ${r.error}`);
    rolls.push({ variant, ...r });
  }
  return from === undefined ? { kind: 'found', soul, notes, rolls } : { kind: 'found', soul, from, notes, rolls };
}

/** At start, with the original chosen: its saved soul and roll, the identity read again, no backup scan. */
async function restoreOriginal(st: State, $: EngineInterface): Promise<void> {
  let error = '';
  try {
    const saved = st.saved;
    if (!saved) error = `no original companion saved; /${MENU_COMMAND} picks one`;
    else {
      const config = await readConfig($);
      if ('error' in config) error = config.error;
      else {
        const r = await rollOriginal($, config.identity, saved.soul, saved.variant);
        if (r.character) st.original = { id: ORIGINAL_ID, source: 'original', character: r.character };
        else error = r.error ?? 'its art will not draw';
      }
    }
  } catch (err) {
    log($, 'restoring the original companion', err);
    error = message(err);
  }
  if (error) st.original = { id: ORIGINAL_ID, source: 'original', error };
  if (st.original) st.roster = withEntry(st.roster, st.original);
}

// ---- /buddy-personality: the menu pane ------------------------------------

function stopMenu(st: State): void {
  st.menu?.timer?.cancel();
  st.menu = null;
}

async function openMenu(st: State, $: EngineInterface): Promise<{ text: string }> {
  const b = st.b;
  if (!b) return { text: 'buddy is still starting; try again in a moment' };
  const originals = await findOriginals($);
  const model = buildMenu({ roster: st.roster, shippedError: st.shippedError, folder: { isSet: Boolean(st.options.characterDir), error: st.folderError }, originals });
  const current = currentKeyOf(b.character.id, st.saved?.variant);
  const start = findItem(model, current) ? current : (allItems(model)[0]?.key ?? '');
  stopMenu(st);
  const menu: MenuState = { model, current, start, focused: start, frame: 0, timer: null, soul: originals.kind === 'found' ? originals.soul : null };
  st.menu = menu;
  menu.timer = $.clock.every(PREVIEW_MS, () => {
    menu.frame++;
    $.ui.invalidate('ui.render');
  });
  let opened;
  try {
    opened = await $.ui.open({ id: MENU_PANE, title: MENU_TITLE, focus: true, closeOnEscape: true, rows: menuRows(model) });
  } catch (error) {
    stopMenu(st);
    log($, `opening /${MENU_COMMAND}`, error);
    return { text: `/${MENU_COMMAND} couldn't open its pane: ${message(error)}` };
  }
  if (!opened.isPlaced) return { text: `The menu is open but not drawn yet: ${opened.reason}` };
  return { text: `${MENU_TITLE}: ↑/↓ move, Enter picks, Esc closes.` };
}

/** Enter on a row: the same switch and memory as /buddy use, then the pane closes and the new one greets. */
async function pickItem(st: State, $: EngineInterface, item: Item): Promise<void> {
  const b = st.b;
  const menu = st.menu;
  if (!b || !menu) return;
  const c = item.character;
  if (!c) {
    $.ui.log(`buddy: /${MENU_COMMAND}: can't pick ${item.label}: ${item.error}`);
    return;
  }
  let note = '';
  if (item.pick.kind === 'original') {
    if (!menu.soul) {
      $.ui.log(`buddy: /${MENU_COMMAND}: can't pick ${item.label}: its soul was not found`);
      return;
    }
    st.original = { id: ORIGINAL_ID, source: 'original', character: c };
    st.roster = withEntry(st.roster, st.original);
    st.saved = { variant: item.pick.variant, soul: menu.soul };
    st.storeChoice = ORIGINAL_ID;
    note += await save($, 'character', ORIGINAL_ID);
    note += await save($, 'original', st.saved);
  } else {
    st.storeChoice = item.pick.id;
    note += await save($, 'character', item.pick.id);
  }
  setCharacter(b, c, undefined, Math.random);
  if (note) speak(b, `${c.name} is here${note}`, 'oops', ERROR_MS);
  startClock(st, $);
  st.lastKey = '';
  $.ui.invalidate('ui.render');
  stopMenu(st);
  try {
    await $.ui.close({ id: MENU_PANE });
  } catch (error) {
    log($, `closing /${MENU_COMMAND}`, error);
  }
}

function drawMenu(Box: Component, Text: Component, Button: Component, m: MenuState, onPick: (item: Item) => void) {
  const p = previewOf(findItem(m.model, m.focused), m.frame, Date.now());
  const groups = m.model.sections.map((s, n) => (
    <Box key={`group:${n}`} flexDirection="column" marginTop={n === 0 ? 0 : 1}>
      <Text bold>{s.title}</Text>
      {s.lines.map((line) => <Text wrap="wrap">{line}</Text>)}
      {s.items.map((item) => <Button key={item.key} label={rowLabel(item, m.current)} plain autoFocus={item.key === m.start ? true : undefined} onPress={() => onPick(item)} />)}
    </Box>
  ));
  const preview =
    p.kind === 'error' ? (
      <Box key="preview" flexDirection="column">
        <Text bold>{p.label}</Text>
        <Text wrap="wrap">{`Can't draw it: ${p.error}`}</Text>
      </Box>
    ) : (
      <Box key="preview" flexDirection="column">
        {p.rows.map((row) => <Text color={p.color}>{row}</Text>)}
        <Text bold>{p.name}</Text>
        <Text dimColor wrap="truncate-end">{p.persona}</Text>
        <Text italic wrap="truncate-end">{`“${p.sample}”`}</Text>
        {p.card.map((row) => <Text wrap="truncate-end">{row}</Text>)}
      </Box>
    );
  return (
    <Box flexDirection="row" gap={3}>
      <Box flexDirection="column" flexShrink={0}>{groups}</Box>
      <Box flexDirection="column" flexGrow={1}>{preview}</Box>
    </Box>
  );
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
    original: null,
    saved: undefined,
    shippedError: undefined,
    folderError: undefined,
    menu: null,
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

  on('command.run', { command: MENU_COMMAND }, async ($) => {
    try {
      return await openMenu(st, $);
    } catch (error) {
      stopMenu(st);
      log($, `/${MENU_COMMAND}`, error);
      return { text: `/${MENU_COMMAND} failed: ${message(error)}` };
    }
  });

  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    try {
      const { Box, Text, Button } = $.ui.resolve(e);
      // A pane kept open across a reload has no menu behind it: said, never blank.
      if (!st.menu) return <Text>{`The menu closed with a reload; /${MENU_COMMAND} opens it again.`}</Text>;
      return drawMenu(Box, Text, Button, st.menu, (item) => {
        pickItem(st, $, item).catch((error) => log($, `picking ${item.label}`, error));
      });
    } catch (error) {
      log($, 'drawing the menu', error);
      return next(e);
    }
  });

  // The preview follows the focus: arrows, Tab or a click move the ring onto a row.
  on('ui.focus', { requestId: MENU_PANE }, async ($, e, next) => {
    try {
      if (st.menu && e.element !== undefined && findItem(st.menu.model, e.element)) {
        st.menu.focused = e.element;
        st.menu.frame = 0;
        $.ui.invalidate('ui.render');
      }
    } catch (error) {
      log($, 'following the menu focus', error);
    }
    return next(e);
  });

  // Esc (or the close mark) closes the menu and changes nothing.
  on('ui.close', async ($, e, next) => {
    if (e.id === MENU_PANE) stopMenu(st);
    return next(e);
  });
};
