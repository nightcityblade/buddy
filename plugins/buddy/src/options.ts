// The plugin's userConfig, resolved to typed values with the manifest's
// defaults; a bad value is ignored by name and listed, never silently.

export type QuestionMode = 'fork' | 'complete' | 'off';
export const QUESTION_MODES: readonly QuestionMode[] = ['fork', 'complete', 'off'];

export type Options = {
  character: string;
  characterDir: string;
  motion: boolean;
  questionMode: QuestionMode;
  quips: boolean;
  quipModel: string;
  quipCooldownSec: number;
  errors: string[];
};

export const DEFAULTS: Omit<Options, 'errors'> = {
  character: 'professor',
  characterDir: '',
  motion: true,
  questionMode: 'fork',
  quips: false,
  quipModel: 'haiku',
  quipCooldownSec: 45,
};

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

export function resolveOptions(raw: Record<string, unknown>): Options {
  const o: Options = { ...DEFAULTS, errors: [] };
  const bad = (key: string, why: string) => o.errors.push(`option ${key} ignored: ${why}`);
  const { character, characterDir, motion, questionMode, quips, quipModel, quipCooldownSec } = raw;
  if (character !== undefined && character !== '') {
    if (typeof character === 'string') o.character = character.trim().toLowerCase();
    else bad('character', 'not a string');
  }
  if (characterDir !== undefined && characterDir !== '') {
    if (typeof characterDir === 'string') o.characterDir = characterDir.trim();
    else bad('characterDir', 'not a string');
  }
  if (motion !== undefined) {
    const b = bool(motion);
    if (b === undefined) bad('motion', `${JSON.stringify(motion)} is not true or false`);
    else o.motion = b;
  }
  if (quips !== undefined) {
    const b = bool(quips);
    if (b === undefined) bad('quips', `${JSON.stringify(quips)} is not true or false`);
    else o.quips = b;
  }
  if (questionMode !== undefined && questionMode !== '') {
    const m = typeof questionMode === 'string' ? questionMode.trim().toLowerCase() : '';
    if ((QUESTION_MODES as readonly string[]).includes(m)) o.questionMode = m as QuestionMode;
    else bad('questionMode', `${JSON.stringify(questionMode)} is not fork, complete or off`);
  }
  if (quipModel !== undefined && quipModel !== '') {
    if (typeof quipModel === 'string') o.quipModel = quipModel.trim();
    else bad('quipModel', 'not a string');
  }
  if (quipCooldownSec !== undefined && quipCooldownSec !== '') {
    const n = typeof quipCooldownSec === 'number' ? quipCooldownSec : Number(quipCooldownSec);
    if (Number.isFinite(n) && n >= 0) o.quipCooldownSec = n;
    else bad('quipCooldownSec', `${JSON.stringify(quipCooldownSec)} is not a number of seconds`);
  }
  return o;
}

/** `~` or `~/...` against the home directory; anything else as given. */
export function expandHome(dir: string, home: string | undefined): string {
  if (!home || !(dir === '~' || dir.startsWith('~/'))) return dir;
  return home.replace(/\/$/, '') + dir.slice(1);
}
