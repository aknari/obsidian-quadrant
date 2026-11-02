/**
 * Reading and rewriting task lines, with no Obsidian in sight.
 *
 * The matrix works on the lines that are already in the vault — the ones
 * Operon owns (`{{operonId:: ...}} {{status:: ...}}`) and the plain `#task`
 * lines — so everything here is string in, string out, and can be tested
 * without an app.
 *
 * Three rules decide what the matrix may write:
 *
 *  - **The quadrant is the matrix's own field.** `[quadrant:: 1]` … `[quadrant:: 5]`,
 *    a Dataview inline field on the line itself, replaced in place if it is
 *    there and appended at the end if it is not. The field was written as
 *    `[eisenhower:: n]` until 0.5.0; that name is still read, so no note had to
 *    be rewritten for the board to keep working (`renameQuadrantField` does it
 *    for the whole vault when asked), but nothing new is written with it.
 *    Operon's `{{priority::}}` is never touched: what Operon calls A, B or C is
 *    the user's judgement and a quadrant is a different question.
 *  - **Dropped is Operon's, when Operon owns the task.** An Operon line put in
 *    the dropped lane gets `{{status:: Project.Dropped}}`, which is exactly
 *    what Operon writes when you drop it there; bringing it back sets
 *    `Project.Planned`. A plain line has no such status, so dropping it means
 *    what it means everywhere else in the vault: `- [-]`, the cancelled line
 *    the daily notes already use, plus `[quadrant:: 5]` so the board can
 *    still find it. Bringing it back sets `- [ ]` again.
 *  - **Finishing is the vault's own notation.** A task dropped on the Done
 *    lane is ticked and stamped `✅ today`; an Operon task also gets
 *    `{{status:: Project.Finished}}` and `{{dateCompleted:: today}}`, because
 *    that is what Operon reads. Nothing else is added, and the quadrant stays.
 *
 * Appending the field at the end is deliberate: an Operon line's fields all sit
 * after its text, so anything added after the last one cannot become part of
 * the title.
 */

/** The lane for tasks that have been dropped, after the four quadrants. */
export const DROPPED = 5;

/** The four Eisenhower quadrants. */
export const QUADRANTS = [1, 2, 3, 4] as const;

/** Operon statuses that mean the task is still live. */
export const OPERON_PENDING = [
  "Project.Brainstorming",
  "Project.Planned",
  "Project.InProgress",
  "Project.Paused",
] as const;

export const OPERON_DROPPED = "Project.Dropped";
export const OPERON_PLANNED = "Project.Planned";
export const OPERON_FINISHED = "Project.Finished";

export interface MatrixTask {
  /** Vault path of the note holding the line. */
  path: string;
  /** Zero-based line index, so a write lands on the line that was read. */
  line: number;
  /** The line as it was read. */
  raw: string;
  /** The line with its task metadata stripped, for display. */
  title: string;
  pending: boolean;
  cancelled: boolean;
  done: boolean;
  operonId: string | null;
  operonStatus: string | null;
  priority: string | null;
  /** 1–4, 5 for dropped, `null` for a task the matrix has not placed yet. */
  quadrant: number | null;
  tags: string[];
  /** The day the task is planned for, as `YYYY-MM-DD`, when the line says so. */
  scheduled: string | null;
  /** The day it was finished — `✅ 2026-10-29` or `{{dateCompleted:: ...}}` — if it says so. */
  completed: string | null;
  indent: number;
}

const TASK_LINE = /^(\s*)- \[([^\]\n])\]\s?(.*)$/u;
const OPERON_FIELD = /\{\{\s*([^{}]*?)\s*::\s*([^{}]*?)\s*\}\}/gu;
const INLINE_FIELD = /\[\s*([A-Za-z][\w-]*)\s*::\s*([^\]]*?)\s*\]/gu;
/**
 * The field the matrix writes, and the one it used to write. Both are read, so
 * a note that predates the rename needs no edit to keep its place; only
 * `quadrant` is ever written.
 */
const QUADRANT = /\[\s*(?:quadrant|eisenhower)\s*::\s*([^\]]*?)\s*\]/u;
/** The old name alone, which is what the one-off rename looks for. */
const LEGACY_QUADRANT = /\[\s*eisenhower\s*::\s*([^\]]*?)\s*\]/u;
const TAG = /(^|\s)(#[^\s#[\](){}"'`]+)/gu;

/** The decorations a task line carries that are not part of its text. */
const STAMPS = [
  /➕\s*\d{4}-\d{2}-\d{2}/gu,
  /⏳\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2})?/gu,
  /✅\s*\d{4}-\d{2}-\d{2}/gu,
  /📅\s*\d{4}-\d{2}-\d{2}/gu,
  /🛫\s*\d{4}-\d{2}-\d{2}/gu,
  /🔺|⏫|🔼|🔽|⏬/gu,
  /@\{\s*[^}]*\}/gu,
  /@@\{\s*[^}]*\}/gu,
];

/** The `simple`-format plan the ruler writes at the start of a line. */
const LEADING_PLAN = /^(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/u;

function readField(raw: string, key: string): string | null {
  const re = new RegExp(`\\{\\{\\s*${key}\\s*::\\s*([^{}]*?)\\s*\\}\\}`, "u");
  const match = re.exec(raw);
  return match === null ? null : match[1].trim();
}

/** The Operon identity of the line, or `null`. */
export function operonIdOf(raw: string): string | null {
  const id = readField(raw, "operonId");
  return id === null || id === "" ? null : id;
}

/** The quadrant the line is filed under, or `null` when it has none. */
export function quadrantOf(raw: string): number | null {
  const match = QUADRANT.exec(raw);
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value)) return null;
  return value >= 1 && value <= DROPPED ? value : null;
}

/** Every inline `[key:: value]` field of the line, key unchanged. */
function inlineFields(raw: string): Array<{ key: string; value: string }> {
  const fields: Array<{ key: string; value: string }> = [];
  INLINE_FIELD.lastIndex = 0;
  for (let match = INLINE_FIELD.exec(raw); match !== null; match = INLINE_FIELD.exec(raw)) {
    fields.push({ key: match[1], value: match[2].trim() });
  }
  return fields;
}

/**
 * A markdown link, and an embed. A card is a title, so a link shows the words
 * it was given and not where it points: printing
 * `file:///Users/…/Administracion_de_Proyectos_4ed_Clifford.pdf` in the middle
 * of a card makes the card unreadable, and the line underneath still holds the
 * link for whoever opens the note. An embed has no words worth keeping, so it
 * goes.
 */
// The target is either `<…>` or anything without a closing paren, with one
// level of nested parens allowed for the likes of `Proyectos_(4ed).pdf`.
const LINK = /\[([^\]]*)\]\((?:<[^>]*>|[^()]*(?:\([^()]*\)[^()]*)*)\)/gu;
const EMBED = /!\[[^\]]*\]\((?:<[^>]*>|[^()]*(?:\([^()]*\)[^()]*)*)\)/gu;

/**
 * The other notation, and the one this vault writes most: `[[…]]`. A wikilink
 * shows what it would show in the note — the alias if it has one, the note's
 * name if not — and never its brackets. A heading is a place inside the note,
 * not part of its name, so `[[Nota#Tema 3]]` shows `Nota`; leaving the `#` in
 * would both read badly and be taken for a tag. An embedded note goes, like an
 * embedded picture: a card is a title, not a gallery.
 */
const WIKI_EMBED = /!\[\[[^\]]*\]\]/gu;
const WIKI_LINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/gu;

/** The text of a task line: no fields, no dates, no tags, no plan prefix. */
export function titleOf(rest: string): string {
  let text = rest;
  text = text.replace(WIKI_EMBED, " ");
  text = text.replace(WIKI_LINK, (_all, target: string, alias?: string) => (alias !== undefined && alias.trim() !== "" ? alias : target));
  text = text.replace(EMBED, " ");
  text = text.replace(LINK, "$1");
  text = text.replace(OPERON_FIELD, " ");
  text = text.replace(INLINE_FIELD, " ");
  text = text.replace(/\s*\{\{[^{}]*\}\}/gu, " ");
  for (const stamp of STAMPS) text = text.replace(stamp, " ");
  text = text.replace(LEADING_PLAN, "");
  text = text.replace(TAG, "$1");
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * One stretch of a card's title, and how the note asked for it to look. A flag
 * is only there when the note asked for that style, so a plain stretch is just
 * its text.
 */
export interface TitlePart {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  highlight?: boolean;
  code?: boolean;
}

interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  highlight: boolean;
  code: boolean;
}

const PLAIN: Style = { bold: false, italic: false, strike: false, highlight: false, code: false };

/**
 * Emphasis in a title, as a mark rather than as a word.
 *
 * Bold was put there to be seen, so the card draws it instead of printing the
 * asterisks; the same goes for italics, for strikethrough early in a line's
 * life, and for the highlighter — the one way a note has of asking for
 * attention in the middle of everything else a board shows. The line keeps
 * every mark: the card is a reading of it, not a copy.
 *
 * Both notations count, because the vault uses both: `**fuerte**` and
 * `__fuerte__`, `*suave*` and `_suave_`. An underscore inside a word is not
 * emphasis — `set_cap_cfg`, `p_stream` — and neither is a lone asterisk —
 * `gram*` — so both stay exactly as written, which is what Obsidian does too.
 * Marks nest, so `**un _esto_ dentro**` is bold and its inner word is italic.
 */
// Longest first: at `***` the triple is meant, not a bold and a spare asterisk.
const MARKS = ["***", "___", "**", "__", "~~", "==", "*", "_"] as const;

/** The longest mark written at `at`, if any. */
function markAt(text: string, at: number): string | null {
  const char = text[at];
  if (char !== "*" && char !== "_" && char !== "~" && char !== "=") return null;
  // A mark never starts in the middle of a run: the run was read from its start.
  if ((char === "*" || char === "_") && text[at - 1] === char) return null;
  for (const mark of MARKS) if (text.startsWith(mark, at)) return mark;
  return null;
}

/** What a mark asks for. */
function stylesOf(mark: string): Style {
  if (mark === "~~") return { ...PLAIN, strike: true };
  if (mark === "==") return { ...PLAIN, highlight: true };
  const bold = mark.length >= 2;
  return { bold, italic: !bold || mark.length === 3, strike: false, highlight: false, code: false };
}

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/u.test(char);
const isWord = (char: string | undefined): boolean => char !== undefined && /\w/u.test(char);

/** Whether a mark can begin here: a space after it is just a space. */
function opens(text: string, at: number, mark: string): boolean {
  if (isSpace(text[at + mark.length])) return false;
  // `set_cap_cfg` is one word, not an italic `cap`.
  return mark[0] !== "_" || !isWord(text[at - 1]);
}

/** Where the mark that started before `from` ends, or `-1` if it never does. */
function closes(text: string, from: number, mark: string): number {
  for (let at = from; at < text.length; at += 1) {
    if (markAt(text, at) !== mark) continue;
    // A closing mark never starts at a space, nor closes a word it is inside of.
    if (isSpace(text[at - 1])) continue;
    if (mark[0] === "_" && isWord(text[at + mark.length])) continue;
    return at;
  }
  return -1;
}

/** Reads the marks of `text`, and keeps its words in the style they were written in. */
function read(text: string, style: Style, out: TitlePart[]): void {
  let at = 0;
  let i = 0;
  while (i < text.length) {
    // Code is read before any mark is: what is inside backticks is what it
    // says, so `set_cap_cfg` and `_init_` keep their underscores.
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        i += 1;
        continue;
      }
      if (i > at) push(out, text.slice(at, i), style);
      push(out, text.slice(i + 1, end), { ...style, code: true });
      i = end + 1;
      at = i;
      continue;
    }
    const mark = markAt(text, i);
    if (mark === null || !opens(text, i, mark)) {
      i += 1;
      continue;
    }
    const end = closes(text, i + mark.length, mark);
    // A mark with no closing mark is a character, and stays where it is.
    if (end === -1) {
      i += mark.length;
      continue;
    }
    if (i > at) push(out, text.slice(at, i), style);
    read(text.slice(i + mark.length, end), merge(style, stylesOf(mark)), out);
    i = end + mark.length;
    at = i;
  }
  if (at < text.length) push(out, text.slice(at), style);
}

function merge(one: Style, other: Style): Style {
  return {
    bold: one.bold || other.bold,
    italic: one.italic || other.italic,
    strike: one.strike || other.strike,
    highlight: one.highlight || other.highlight,
    code: one.code || other.code,
  };
}

function push(out: TitlePart[], text: string, style: Style): void {
  if (text === "") return;
  const last = out[out.length - 1];
  const same =
    last !== undefined &&
    (last.bold === true) === style.bold &&
    (last.italic === true) === style.italic &&
    (last.strike === true) === style.strike &&
    (last.highlight === true) === style.highlight &&
    (last.code === true) === style.code;
  if (same) {
    last.text += text;
    return;
  }
  const part: TitlePart = { text };
  if (style.bold) part.bold = true;
  if (style.italic) part.italic = true;
  if (style.strike) part.strike = true;
  if (style.highlight) part.highlight = true;
  if (style.code) part.code = true;
  out.push(part);
}

/** A title in pieces: the words, and the stretches the note emphasised. */
export function titleParts(title: string): TitlePart[] {
  const parts: TitlePart[] = [];
  read(title, { ...PLAIN }, parts);
  return parts;
}

function tagsOf(raw: string): string[] {
  const tags: string[] = [];
  TAG.lastIndex = 0;
  for (let match = TAG.exec(raw); match !== null; match = TAG.exec(raw)) {
    const tag = match[2];
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * The day the line was finished, in either of the two notations the vault
 * uses: the `✅ 2026-10-29` stamp the Tasks plugin writes, and Operon's
 * `{{dateCompleted:: 2026-10-29}}` field. `null` when the line does not say —
 * a ticked checkbox with no date is still finished, it just cannot be placed
 * on a day.
 */
export function completedOf(raw: string): string | null {
  const stamp = /✅\s*(\d{4}-\d{2}-\d{2})/u.exec(raw);
  if (stamp !== null) return stamp[1];
  const field = readField(raw, "dateCompleted");
  const day = field === null ? null : /(\d{4}-\d{2}-\d{2})/u.exec(field);
  return day === null ? null : day[1];
}

function scheduledOf(raw: string, rest: string): string | null {
  const emoji = /⏳\s*(\d{4}-\d{2}-\d{2})/u.exec(raw);
  if (emoji !== null) return emoji[1];
  for (const field of inlineFields(raw)) {
    if (field.key !== "scheduled" && field.key !== "date") continue;
    const date = /\d{4}-\d{2}-\d{2}/u.exec(field.value);
    if (date !== null) return date[0];
  }
  const kanban = /@\{\s*(\d{4}-\d{2}-\d{2})/u.exec(raw);
  if (kanban !== null) return kanban[1];
  const operon = readField(raw, "dateScheduled");
  if (operon !== null) {
    const date = /\d{4}-\d{2}-\d{2}/u.exec(operon);
    if (date !== null) return date[0];
  }
  const prefix = /^(?:(\d{4}-\d{2}-\d{2})\s+)?\d{1,2}:\d{2}/u.exec(rest.trimStart());
  return prefix !== null && prefix[1] !== undefined ? prefix[1] : null;
}

/**
 * One line, as a task the matrix can show — or `null` when it is not a task
 * line at all, or it is a tombstone (`- [>]`): the record of something already
 * carried forward, not work to place.
 */
export function parseTaskLine(raw: string, path: string, line: number): MatrixTask | null {
  const match = TASK_LINE.exec(raw);
  if (match === null) return null;
  const mark = match[2];
  if (mark !== " " && mark !== "!" && mark !== "-" && mark !== "x" && mark !== "X") return null;
  const rest = match[3];
  return {
    path,
    line,
    raw,
    title: titleOf(rest),
    pending: mark === " " || mark === "!",
    cancelled: mark === "-",
    done: mark === "x" || mark === "X",
    operonId: operonIdOf(raw),
    operonStatus: readField(raw, "status"),
    priority: priorityOf(raw),
    quadrant: quadrantOf(raw),
    tags: tagsOf(raw),
    scheduled: scheduledOf(raw, rest),
    completed: completedOf(raw),
    indent: match[1].length,
  };
}

/** Whether the task is still live work: pending, or an Operon task not finished. */
export function isLive(task: MatrixTask): boolean {
  if (task.operonId !== null) {
    if (task.operonStatus === null) return task.pending;
    return task.operonStatus === OPERON_DROPPED
      || (OPERON_PENDING as readonly string[]).includes(task.operonStatus);
  }
  return task.pending || (task.cancelled && task.quadrant === DROPPED);
}

/**
 * Whether the task is finished. For an Operon task the status is the answer,
 * because that is what Operon itself reads: a ticked box that still says
 * `Project.Planned` is work whose status has not caught up, and one that says
 * `Project.Finished` is finished even if the box lags behind. A plain line has
 * only its box.
 *
 * Done and live never overlap, so a task is on exactly one side of the board.
 */
export function isDone(task: MatrixTask): boolean {
  if (task.operonId !== null && task.operonStatus !== null) return task.operonStatus === OPERON_FINISHED;
  return task.done;
}

export interface ScanOptions {
  /** The task tag, e.g. `#task`. Empty means "any pending line counts". */
  taskTag: string;
  /** Whether finished lines come back too. They are left out by default. */
  includeDone?: boolean;
}

/**
 * Every task of a note the matrix should show, in line order.
 *
 * A line is skipped when it is cancelled, when it sits inside a fenced code
 * block (a note that *shows* a task is not a note that holds one), and — for
 * a plain line — when it carries neither the task tag nor a quadrant: without
 * either there is no way to tell it from a checklist item. Finished lines come
 * back only when `includeDone` asks, and they pass the same tag and quadrant
 * gate as the live ones: something finished is still something the vault wrote
 * as a task.
 */
export function scanNote(content: string, path: string, options: ScanOptions): MatrixTask[] {
  const tag = options.taskTag.trim();
  const tasks: MatrixTask[] = [];
  let fenced = false;
  let fence = "";
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const marker = trimmed.startsWith("```") ? "```" : "~~~";
      if (!fenced) { fenced = true; fence = marker; } else if (marker === fence) { fenced = false; fence = ""; }
      continue;
    }
    if (fenced) continue;
    const task = parseTaskLine(raw, path, i);
    if (task === null) continue;
    if (isDone(task) ? options.includeDone !== true : !isLive(task)) continue;
    if (task.operonId === null && task.quadrant === null) {
      if (tag === "") continue;
      if (!task.tags.includes(tag)) continue;
    }
    tasks.push(task);
  }
  return tasks;
}

/** Whether the path sits in the given folder (or is the folder itself). */
export function inFolder(path: string, folder: string): boolean {
  const clean = folder.trim().replace(/^\/+|\/+$/gu, "");
  if (clean === "") return false;
  return path === clean || path.startsWith(`${clean}/`);
}

/**
 * Whether a task belongs on the board at all.
 *
 * An Operon task does, wherever it lives: its `operonId` is proof enough that
 * it is work and not a piece of prose. A plain task has to earn it, either by
 * being in one of the folders the settings name — a vault also keeps examples
 * of task syntax, checklists inside notes, and lines that were notes before
 * someone ticked a box — or by carrying a quadrant already, so that placing it
 * once keeps it visible from wherever it lives. An empty list turns the check
 * off.
 */
export function plainTaskVisible(task: MatrixTask, folders: string[]): boolean {
  if (task.operonId !== null || task.quadrant !== null) return true;
  if (folders.length === 0) return true;
  return folders.some((folder) => inFolder(task.path, folder));
}

/**
 * The Tasks-plugin priority emoji, read by rank: the same ladder as Operon's
 * letters, which is how Operon itself converts them when it takes a line over.
 * A plain `#task` line carries its priority this way and nowhere else.
 */
const PRIORITY_EMOJI: ReadonlyArray<readonly [string, string]> = [
  ["🔺", "S"],
  ["⏫", "A"],
  ["🔼", "B"],
  ["🔽", "C"],
  ["⏬", "D"],
];

/**
 * The priority of the line, in whichever notation wrote it.
 *
 * Operon's `{{priority:: …}}` wins when it is there, because that is the value
 * Operon itself reads and rewrites. Failing that, the emoji of a plain task is
 * translated into the same letter, so one board can order both kinds together
 * and neither has to learn the other's syntax. Nothing is written back: the
 * translation only exists while the board is drawn.
 */
export function priorityOf(raw: string): string | null {
  const field = readField(raw, "priority");
  if (field !== null && field !== "") return field;
  for (const [emoji, letter] of PRIORITY_EMOJI) {
    if (raw.includes(emoji)) return letter;
  }
  return null;
}

/** Operon's priority, as a sort key: S first, then A, B, C, anything else last. */
export function priorityRank(priority: string | null): number {
  if (priority === null) return 8;
  const key = priority.trim().toUpperCase();
  if (key === "S") return 0;
  if (key === "A") return 1;
  if (key === "B") return 2;
  if (key === "C") return 3;
  if (key === "D") return 4;
  return 7;
}

/** Priority, then the day it is planned for, then the text. */
export function sortTasks(tasks: MatrixTask[]): MatrixTask[] {
  return [...tasks].sort((a, b) => {
    const rank = priorityRank(a.priority) - priorityRank(b.priority);
    if (rank !== 0) return rank;
    const left = a.scheduled ?? "9999-99-99";
    const right = b.scheduled ?? "9999-99-99";
    if (left !== right) return left < right ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** The local day as `YYYY-MM-DD`, which is how the vault writes days. */
export function todayOf(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `date` (a `YYYY-MM-DD` day) moved by `days`; negative goes back. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return todayOf(new Date(year, month - 1, day + days));
}

/**
 * What the board is narrowing down to. Every flag set is one more condition the
 * task has to meet, and none set is the whole board: the filters are for
 * looking at the urgent or the late work, not for changing what is there.
 *
 * `overdue` and `soon` are one axis, so they are never on together: one asks
 * for a day before today and the other for a day from today on, and a filter
 * that can only match nothing is not a filter.
 */
export interface MatrixFilter {
  /** Planned for a day before today; off whenever `soon` is on. */
  overdue: boolean;
  /** Planned for today or within the next week; off whenever `overdue` is on. */
  soon: boolean;
  /** The two top priorities: S or A, whether Operon's field or a plain line's emoji wrote it. */
  priority: boolean;
}

export const NO_FILTER: MatrixFilter = { overdue: false, soon: false, priority: false };

/**
 * The filter after a click on one of its chips.
 *
 * Turning on *Overdue* turns off *Next 7 days* and the other way round, because
 * a day cannot be both before today and from today on. Priority is a different
 * axis, so it adds to whichever of the two is on.
 */
export function toggleCondition(filter: MatrixFilter, key: keyof MatrixFilter): MatrixFilter {
  const on = !filter[key];
  const next: MatrixFilter = { ...filter, [key]: on };
  if (on && key === "overdue") next.soon = false;
  if (on && key === "soon") next.overdue = false;
  return next;
}

/**
 * How far back the Done strip looks: a week, a month, or everything the board
 * can see. The last one is not "all of history" — it is all of *this* vault as
 * the folder settings leave it, which is a small, pruned set: the daily-note
 * archive is excluded and the journal keeps only its last fifteen notes.
 */
export type DoneWindow = 7 | 30 | 0;

export const DONE_WINDOWS: readonly DoneWindow[] = [7, 30, 0] as const;

/** What the chip and the lane's hint call that window. */
export function windowLabel(window: DoneWindow): string {
  if (window === 0) return "everything";
  return window === 7 ? "last 7 days" : `last ${window} days`;
}

/**
 * The finished tasks that fall in the window, newest first.
 *
 * A dated window keeps only the tasks that carry a date, because a ticked box
 * with no `✅` cannot be placed on a day and counting it in "this week" would
 * be inventing one. "Everything" keeps them, and sorts them last. The upper
 * bound is deliberately absent: a completion stamped in the future is a typo,
 * and hiding it would hide the task instead of the typo.
 */
export function doneWithin(tasks: MatrixTask[], window: DoneWindow, today: string): MatrixTask[] {
  const from = window === 0 ? null : addDays(today, -(window - 1));
  if (from === null) return sortDone(tasks);
  return sortDone(tasks.filter((task) => task.completed !== null && task.completed >= from));
}

/** Newest completion first; tasks with no date after them, by text. */
export function sortDone(tasks: MatrixTask[]): MatrixTask[] {
  return [...tasks].sort((a, b) => {
    const left = a.completed ?? "";
    const right = b.completed ?? "";
    if (left !== right) return left > right ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * One entry per day, oldest first, ending today: what the seven bars show.
 * The bars always cover the last week, whatever window the list is set to —
 * they are the rhythm, not the list.
 */
export function doneByDay(tasks: MatrixTask[], today: string, days = 7): Array<{ day: string; count: number }> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.completed === null) continue;
    counts.set(task.completed, (counts.get(task.completed) ?? 0) + 1);
  }
  const out: Array<{ day: string; count: number }> = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = addDays(today, -back);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/** Whether any condition is on, so the board can show it is narrowed. */
export function filterActive(filter: MatrixFilter): boolean {
  return filter.overdue || filter.soon || filter.priority;
}

/** Whether the task passes every active condition of the filter. */
export function matchesFilter(task: MatrixTask, filter: MatrixFilter, today: string): boolean {
  if (filter.overdue && (task.scheduled === null || task.scheduled >= today)) return false;
  if (filter.soon) {
    if (task.scheduled === null) return false;
    if (task.scheduled < today || task.scheduled > addDays(today, 7)) return false;
  }
  if (filter.priority && priorityRank(task.priority) > 1) return false;
  return true;
}

/**
 * The identity of a line for the write-it-back check: the `operonId` when it
 * has one, the text otherwise, ignoring the quadrant the matrix itself wrote.
 * A line that changed in any other way is not the line that was dragged.
 */
export function taskKey(raw: string): string {
  const id = operonIdOf(raw);
  if (id !== null) return `operon:${id}`;
  return raw.replace(QUADRANT, "").replace(/\s+/gu, " ").trim();
}

/** The line with its quadrant replaced in place, or added at the end. */
export function setQuadrant(raw: string, quadrant: number): string {
  const field = `[quadrant:: ${quadrant}]`;
  if (QUADRANT.test(raw)) return raw.replace(QUADRANT, field);
  return `${raw.trimEnd()} ${field}`;
}

/**
 * The line with its checkbox set to pending (`- [ ]`) or cancelled (`- [-]`).
 * Only the status character changes: the text, the fields and the indent stay.
 */
export function setPending(raw: string, pending: boolean): string {
  return raw.replace(/^(\s*- )\[[^\]\n]\]/u, `$1[${pending ? " " : "-"}]`);
}

/** The line with its checkbox ticked: `- [x]`. */
export function setDone(raw: string): string {
  return raw.replace(/^(\s*- )\[[^\]\n]\]/u, "$1[x]");
}

/**
 * The line with a `✅ YYYY-MM-DD` stamp: replaced where it already is, added at
 * the end otherwise. That is the stamp the Tasks plugin writes, and the one the
 * rest of the vault already reads.
 */
export function setCompletedStamp(raw: string, day: string): string {
  const stamp = /✅\s*\d{4}-\d{2}-\d{2}/u;
  if (stamp.test(raw)) return raw.replace(stamp, `✅ ${day}`);
  return `${raw.trimEnd()} ✅ ${day}`;
}

/** The line with its quadrant field removed, whichever name it carries. */
export function clearQuadrant(raw: string): string {
  if (!QUADRANT.test(raw)) return raw;
  return raw.replace(QUADRANT, "").replace(/\s+$/u, "");
}

/**
 * The line with the old `[eisenhower:: n]` field written as `[quadrant:: n]`,
 * or `null` when the line has no old field. Only the name of the field changes:
 * the value, its place in the line and everything around it stay.
 *
 * The board reads both names, so this is housekeeping rather than a migration:
 * skipping it changes nothing, and running it twice changes nothing either.
 */
export function renameQuadrantField(raw: string): string | null {
  if (!LEGACY_QUADRANT.test(raw)) return null;
  return raw.replace(LEGACY_QUADRANT, (_match, value: string) => `[quadrant:: ${value.trim()}]`);
}

/** An Operon `{{key:: value}}` field replaced in place, or added at the end. */
export function setOperonField(raw: string, key: string, value: string): string {
  const field = `{{${key}:: ${value}}}`;
  const re = new RegExp(`\\{\\{\\s*${key}\\s*::\\s*[^{}]*?\\}\\}`, "u");
  if (re.test(raw)) return raw.replace(re, field);
  return `${raw.trimEnd()} ${field}`;
}

/** The line with Operon's `{{status:: ...}}` replaced in place, or added. */
export function setOperonStatus(raw: string, status: string): string {
  return setOperonField(raw, "status", status);
}

/**
 * The line after it was dropped on the Done lane: finished today.
 *
 * Each notation gets what it already reads, and only that. A plain line is
 * ticked and stamped `✅ day`, which is exactly what the vault writes when you
 * tick a box with the Tasks plugin. An Operon task is ticked, given
 * `{{status:: Project.Finished}}` and `{{dateCompleted:: day}}`, because its
 * status is what Operon itself reads. The quadrant is left alone: finishing a
 * task does not forget where it was, and unticking it puts it back there.
 * Operon's `{{datetimeModified::}}` is not ours to write.
 */
export function applyFinish(raw: string, day: string): string {
  const ticked = setDone(raw);
  if (operonIdOf(raw) !== null) {
    const dated = setOperonField(ticked, "dateCompleted", day);
    return setOperonStatus(dated, OPERON_FINISHED);
  }
  return setCompletedStamp(ticked, day);
}

/**
 * The line after a drop in `target` (0 = unclassified, 1–4 = quadrant, 5 =
 * dropped). Reviving an Operon task that was dropped puts its status back to
 * `Project.Planned`: that is the state it can be worked on from, and the only
 * one this view can honestly claim to restore.
 */
export function applyMove(raw: string, target: number): string {
  const operon = operonIdOf(raw) !== null;
  const dropped = operon && readField(raw, "status") === OPERON_DROPPED;
  if (target === 0) {
    const next = clearQuadrant(raw);
    if (operon) return dropped ? setOperonStatus(next, OPERON_PLANNED) : next;
    return setPending(next, true);
  }
  if (target === DROPPED) {
    if (operon) return setOperonStatus(raw, OPERON_DROPPED);
    return setQuadrant(setPending(raw, false), DROPPED);
  }
  const next = setQuadrant(raw, target);
  if (operon) return dropped ? setOperonStatus(next, OPERON_PLANNED) : next;
  return setPending(next, true);
}

/** Which lane a task belongs to: 1–4, 5 for dropped, 0 for unclassified. */
export function laneOf(task: MatrixTask): number {
  if (task.operonId !== null && task.operonStatus === OPERON_DROPPED) return DROPPED;
  if (task.quadrant === DROPPED) return DROPPED;
  return task.quadrant ?? 0;
}

/**
 * Archiving: the one operation that takes a line out of its note.
 *
 * The board does not need it — a finished task leaves its quadrant when it is
 * ticked and shows up in Done with its date. Notes do, in time: a daily note
 * that keeps every task it ever held stops being a diary and becomes a list.
 *
 * The rule is a move, never a delete. The line travels to the month's archive
 * exactly as it was, stamp and all, under the note it came from, and the note
 * keeps `- [>]`: the tombstone the daily-note consolidation already leaves, and
 * which this reader has always refused to see as work. Written in that order, a
 * job that stops halfway duplicates a line instead of losing one, and a
 * duplicate can be seen.
 */

/** The day a line says it was created (`➕ 2026-09-16`), when it says so. */
export function createdOf(raw: string): string | null {
  const stamp = /➕\s*(\d{4}-\d{2}-\d{2})/u.exec(raw);
  return stamp === null ? null : stamp[1];
}

/** The month a day belongs to, as `YYYY-MM`: the archive is one file per month. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The day a line has to be older than to be archived. */
export function archiveCutoff(today: string, days: number): string {
  return addDays(today, -Math.max(1, Math.round(days)));
}

/**
 * The line as the record of what left it: the box becomes `- [>]` and nothing
 * else changes. The text, the tag, the `✅` and the `➕` all stay, because they
 * are what the note held; the box alone is what the reader skips on.
 */
export function tombstone(raw: string): string {
  return raw.replace(/^(\s*)- \[[^\]\n]\]/u, "$1- [>]");
}

export interface NoteText {
  path: string;
  content: string;
}

export interface ArchiveCandidate {
  path: string;
  line: number;
  raw: string;
  title: string;
}

export interface ArchivePlan {
  /** The lines that will move, in the order they were read. */
  moving: ArchiveCandidate[];
  /** The notes that change, each with its whole new content. */
  rewrites: Array<{ path: string; content: string }>;
  /** Finished lines younger than the cutoff: there is no hurry for them. */
  recent: number;
  /** Lines with no date of their own, which the cutoff cannot judge. */
  undated: number;
}

export interface ArchiveOptions {
  taskTag: string;
  /** The folders a plain task has to be in to be the board's business. */
  folders: string[];
  today: string;
  /** How many days a line has to be old before it may leave. */
  days: number;
}

/**
 * What the archive job would do, without doing it.
 *
 * Only plain lines take part: an Operon task's status is Operon's, and moving
 * its line out of the project note would be editing a record this plugin does
 * not own. A finished line is judged by the day it was finished, a dropped one
 * by the `➕` it carries; a line with neither is left where it is rather than
 * guessed at, because this is the one thing here that edits notes.
 */
export function planArchive(notes: NoteText[], options: ArchiveOptions): ArchivePlan {
  const cutoff = archiveCutoff(options.today, options.days);
  const plan: ArchivePlan = { moving: [], rewrites: [], recent: 0, undated: 0 };
  for (const note of notes) {
    const lines = note.content.split("\n");
    const chosen: ArchiveCandidate[] = [];
    for (const task of scanNote(note.content, note.path, { taskTag: options.taskTag, includeDone: true })) {
      if (task.operonId !== null) continue;
      if (!plainTaskVisible(task, options.folders)) continue;
      const day = isDone(task) ? task.completed : createdOf(task.raw);
      if (day === null) {
        plan.undated += 1;
        continue;
      }
      if (day >= cutoff) {
        plan.recent += 1;
        continue;
      }
      chosen.push({ path: task.path, line: task.line, raw: task.raw, title: task.title });
    }
    if (chosen.length === 0) continue;
    for (const item of chosen) lines[item.line] = tombstone(item.raw);
    plan.moving.push(...chosen);
    plan.rewrites.push({ path: note.path, content: lines.join("\n") });
  }
  return plan;
}

/**
 * The block an archive file gains: one section per source note, its lines kept
 * verbatim underneath. Verbatim matters — Tasks and Dataview still read them,
 * and an archive is a record, not a summary.
 */
export function archiveBlock(moving: ArchiveCandidate[]): string {
  const byNote = new Map<string, ArchiveCandidate[]>();
  for (const item of moving) {
    const list = byNote.get(item.path) ?? [];
    list.push(item);
    byNote.set(item.path, list);
  }
  const lines: string[] = [];
  for (const [path, items] of byNote) {
    const name = path.split("/").pop()?.replace(/\.md$/u, "") ?? path;
    lines.push(`## De [[${name}]]`, "");
    for (const item of items) lines.push(item.raw);
    lines.push("");
  }
  return lines.join("\n");
}
