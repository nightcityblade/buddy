import { DEFAULT_MOTION, isObject, normalizeFrames, type Character, type Frame, type LineEvent, type Pose, type Validation } from './character.ts';
import { RARITIES, STATS, type Bones, type Rarity, type Stat, type Variant } from './hatch.ts';
import { EYE_TOKEN, type HatArt, type SpeciesTemplate } from './species.ts';

// `/buddy adopt`: the companion Claude Code hatched for this account, back on
// the prompt line. Its bones come from hatch.ts, its soul (name, personality,
// hatchedAt) from ~/.claude.json or a backup of it, or is hatched anew; this
// turns the two, and a species template, into an ordinary Character. Pure.

export const ADOPTED_ID = 'adopted';
export const CONFIG_NAME = '.claude.json';
export const SHOWN_CONFIG = '~/.claude.json';

export type Soul = { name: string; personality: string; hatchedAt?: number | string };
/** Where the soul came from: the file, a backup of it, our store, or a new hatch. */
export type SoulOrigin = { kind: 'file' } | { kind: 'backup'; label: string } | { kind: 'saved' } | { kind: 'hatched' };
/** What `/buddy adopt` remembers so a restart draws the same companion: never the identity. */
export type AdoptChoice = { variant: Variant; path?: string };

export const RARITY_COLOR: Record<Rarity, string> = { common: 'white', uncommon: 'green', rare: 'blue', epic: 'magenta', legendary: 'yellow' };
export const SOUL_NAME_MAX = 24;
export const SOUL_PERSONALITY_MAX = 300;
export const SOUL_MAX_TOKENS = 200;
const BAR = 10;

export function stars(r: Rarity): string {
  return '★'.repeat(RARITIES.indexOf(r) + 1);
}

/** The identity Claude Code rolled from: `oauthAccount?.accountUuid ?? userID ?? "anon"`. */
export function identityOf(config: unknown): string {
  const c = isObject(config) ? config : {};
  const oauth = c.oauthAccount as { accountUuid?: unknown } | null | undefined;
  return String(oauth?.accountUuid ?? c.userID ?? 'anon');
}

/** A soul as stored: none when absent, an error when it is there but malformed. */
export function soulOf(value: unknown): { soul?: Soul; error?: string } {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) return { error: 'the companion is not an object' };
  const { name, personality, hatchedAt } = value;
  if (typeof name !== 'string' || name.trim() === '') return { error: 'the companion has no name' };
  if (typeof personality !== 'string') return { error: 'the companion has no personality' };
  const soul: Soul = { name: name.trim().slice(0, 40), personality: personality.trim() };
  if (typeof hatchedAt === 'number' || typeof hatchedAt === 'string') soul.hatchedAt = hatchedAt;
  return { soul };
}

/** The `companion` of a parsed ~/.claude.json (or backup), validated. */
export function companionOf(config: unknown): { soul?: Soul; error?: string } {
  return soulOf(isObject(config) ? config.companion : undefined);
}

/** A file that may be a backup of ~/.claude.json, in the home folder: `.claude.json.{anything}`. */
export function isBackupName(name: string): boolean {
  return name.startsWith(`${CONFIG_NAME}.`) && name.length > CONFIG_NAME.length + 1;
}

/** Newest first: by modification time, then by name (timestamped names sort by date). */
export function newestFirst(a: { name: string; mtimeMs: number }, b: { name: string; mtimeMs: number }): number {
  return b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);
}

export function hatchedDate(at: number | string | undefined): string {
  const ms = typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime()) ? new Date(ms).toISOString().slice(0, 10) : 'unknown';
}

/** `SNARK     ████████░░ 81`: ten cells, one per ten points. */
export function statBar(stat: Stat, value: number): string {
  const n = Math.max(0, Math.min(BAR, Math.round(value / 10)));
  return `${stat.padEnd(9)} ${'█'.repeat(n)}${'░'.repeat(BAR - n)} ${value}`;
}

const TRAIT: Record<Stat, { high: string; low: string }> = {
  DEBUGGING: { high: 'You spot bugs fast and love a good stack trace.', low: 'Bugs baffle you a little.' },
  PATIENCE: { high: 'You are calm and unhurried.', low: 'You are a little impatient.' },
  CHAOS: { high: 'You are playful and a bit chaotic.', low: 'You like things tidy and predictable.' },
  WISDOM: { high: 'You speak with quiet wisdom.', low: 'You are cheerfully naive.' },
  SNARK: { high: 'You are sassy and a little snarky.', low: 'You are earnest and never sarcastic.' },
};

/** The strongest and weakest stat, turned into a line of character. */
export function statsHint(stats: Record<Stat, number>): string {
  const peak = STATS.reduce((a, s) => (stats[s] > stats[a] ? s : a));
  const low = STATS.reduce((a, s) => (stats[s] < stats[a] ? s : a));
  const list = STATS.map((s) => `${s} ${stats[s]}`).join(', ');
  return `Your stats (out of 100): ${list}. ${TRAIT[peak].high} ${TRAIT[low].low}`;
}

export function personaOf(soul: Soul, bones: Bones): string {
  const shiny = bones.shiny ? ' (a rare shiny one)' : '';
  const personality = soul.personality ? ` Your personality: ${soul.personality.slice(0, 600)}` : '';
  return `You are ${soul.name}, a ${bones.rarity} ${bones.species}${shiny} who lives above a developer's Claude Code prompt.${personality} ${statsHint(bones.stats)}`.slice(0, 1200);
}

/** The hat row: the hat's art centered on `hatCol`, kept inside `width`. */
export function hatRow(width: number, hatCol: number, art: string): string {
  const a = art.slice(0, width);
  const start = Math.max(0, Math.min(width - a.length, hatCol - Math.floor(a.length / 2)));
  return ' '.repeat(start) + a + ' '.repeat(width - start - a.length);
}

/**
 * One frame worn: `{E}` becomes the eye, row 0 the hat (dropped with no hat),
 * and a shiny one gets a sparkle column, the `*` alternating rows by frame.
 */
export function wearFrame(frame: Frame, eye: string, hat: string | null, width: number, hatCol: number, shinyFrame: number | null): string[] {
  const rows = frame.map((row, r) => (r === 0 ? (hat === null ? null : hatRow(width, hatCol, hat)) : row.split(EYE_TOKEN).join(eye))).filter((r): r is string => r !== null);
  if (shinyFrame === null) return rows;
  return rows.map((row, r) => row + (r === shinyFrame % 2 ? '*' : ' '));
}

export function fillName(pools: Partial<Record<LineEvent, string[]>>, name: string): Partial<Record<LineEvent, string[]>> {
  const out: Partial<Record<LineEvent, string[]>> = {};
  for (const [event, pool] of Object.entries(pools) as [LineEvent, string[]][]) out[event] = pool.map((l) => l.split('{name}').join(name));
  return out;
}

export function cardOf(bones: Bones, soul: Soul): { subtitle: string; rows: string[] } {
  const subtitle = `${bones.species} · ${stars(bones.rarity)} ${bones.rarity}${bones.shiny ? ' · shiny ✨' : ''}`;
  return { subtitle, rows: [...STATS.map((s) => statBar(s, bones.stats[s])), `hatched ${hatchedDate(soul.hatchedAt)}`] };
}

export type AdoptInput = { soul: Soul; bones: Bones; variant: Variant; template: SpeciesTemplate; hats: HatArt };

/** The adopted companion as a Character; an error when the art it needs is missing. */
export function adoptCharacter(i: AdoptInput): Validation {
  const { soul, bones, template: t } = i;
  if (t.species !== bones.species) return { ok: false, error: `species template is ${t.species}, the companion is a ${bones.species}` };
  let hat: string | null = null;
  if (bones.hat !== 'none') {
    const art = i.hats[bones.hat];
    if (art === undefined) return { ok: false, error: `species/hats.json has no ${bones.hat}` };
    hat = art;
  }
  const poses: Partial<Record<Pose, Frame[]>> = {};
  for (const [pose, list] of Object.entries(t.poses) as [Pose, Frame[]][]) {
    poses[pose] = list.map((frame, f) => wearFrame(frame, bones.eye, hat, t.width, t.hatCol, bones.shiny ? f : null));
  }
  const norm = normalizeFrames(poses);
  const character: Character = {
    id: ADOPTED_ID,
    name: soul.name,
    description: `${stars(bones.rarity)} ${bones.rarity} ${bones.species}${bones.shiny ? ', shiny' : ''} (${i.variant})`,
    persona: personaOf(soul, bones),
    color: RARITY_COLOR[bones.rarity],
    poses: norm.poses,
    lines: fillName(t.lines, soul.name),
    motion: { ...DEFAULT_MOTION },
    width: norm.width,
    height: norm.height,
    card: cardOf(bones, soul),
  };
  if (bones.shiny) character.shiny = true;
  return { ok: true, character };
}

export function adoptedTitle(name: string, bones: Bones): string {
  return `${name} the ${bones.rarity} ${bones.species}${bones.shiny ? ' (shiny!)' : ''}`;
}

/** The bubble on arrival. */
export function welcomeLine(origin: SoulOrigin, name: string): string {
  return origin.kind === 'hatched' ? `Hello! I'm ${name}.` : `Welcome back, ${name}!`;
}

/** The reply to `/buddy adopt`, the account shown only as its last 4 characters. */
export function adoptReply(i: { name: string; bones: Bones; variant: Variant; origin: SoulOrigin; account: string; notes?: readonly string[] }): string {
  const lines = [`${adoptedTitle(i.name, i.bones)} ${i.origin.kind === 'hatched' ? 'hatched' : 'is back'}.`];
  if (i.origin.kind === 'backup') lines.push(`Its soul came from the backup ${i.origin.label}.`);
  if (i.origin.kind === 'saved') lines.push('Its soul is the one saved at your last /buddy adopt.');
  lines.push(`Account ${i.account}, rolled as the ${i.variant} install did.`);
  lines.push(i.variant === 'native' ? 'Hatched on an npm install? /buddy adopt npm' : 'Hatched on the native install? /buddy adopt');
  return [...lines, ...(i.notes ?? [])].join('\n');
}

// ---- a new soul, from the model ------------------------------------------

export const SOUL_SYSTEM = [
  'You name a newly hatched companion: a tiny ASCII creature that lives above a developer\'s terminal prompt.',
  'Reply with one JSON object and nothing else: {"name": "...", "personality": "..."}.',
  `name: one short, friendly word (two at most), at most ${SOUL_NAME_MAX} characters, no emoji.`,
  'personality: one sentence of at most 25 words describing the creature in the third person, shaped by its species, rarity and stats.',
].join('\n');

export function soulPrompt(bones: Bones, inspirationSeed: number, lastError = ''): string {
  const rows = [
    `Species: ${bones.species}`,
    `Rarity: ${bones.rarity}${bones.shiny ? ' (shiny)' : ''}`,
    `Stats (out of 100): ${STATS.map((s) => `${s} ${bones.stats[s]}`).join(', ')}`,
    `Inspiration seed: ${inspirationSeed}`,
  ];
  if (lastError) rows.push(`Your last reply was not usable (${lastError}). Reply with the JSON object only.`);
  return rows.join('\n');
}

/** The model's soul, validated: one short name and one line of personality. */
export function parseSoul(text: string): { soul?: Soul; error?: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'no JSON object in the reply' };
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch (error) {
    return { error: `the reply is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isObject(raw)) return { error: 'the reply is not a JSON object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const personality = typeof raw.personality === 'string' ? raw.personality.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > SOUL_NAME_MAX || name.split(/\s+/).length > 2 || !/^[\x20-\x7EÀ-ɏ]+$/.test(name)) return { error: `name must be one or two words, at most ${SOUL_NAME_MAX} characters` };
  if (personality.length < 10 || personality.length > SOUL_PERSONALITY_MAX) return { error: `personality must be one sentence of 10 to ${SOUL_PERSONALITY_MAX} characters` };
  return { soul: { name, personality } };
}

/** A stored soul record back as a soul: our own `soul:*` store key, validated like the file's. */
export function savedSoulOf(value: unknown): { soul?: Soul; label?: string } {
  const s = soulOf(value);
  if (!s.soul || !isObject(value)) return {};
  return { soul: s.soul, label: typeof value.from === 'string' ? value.from : undefined };
}

export function adoptChoiceOf(value: unknown): AdoptChoice | undefined {
  if (!isObject(value) || (value.variant !== 'native' && value.variant !== 'npm')) return undefined;
  return typeof value.path === 'string' && value.path !== '' ? { variant: value.variant, path: value.path } : { variant: value.variant };
}

/** The store key of an identity's soul per variant: the identity's hash, never the identity. */
export function soulKey(identityHash: string, variant: Variant): string {
  return `soul:${identityHash}:${variant}`;
}
