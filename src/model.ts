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
 *  - **The quadrant is the matrix's own field.** `[eisenhower:: 1]` … `[eisenhower:: 5]`,
 *    a Dataview inline field on the line itself, replaced in place if it is
 *    there and appended at the end if it is not. Operon's `{{priority::}}` is
 *    never touched: what Operon calls A, B or C is the user's judgement and a
 *    quadrant is a different question.
 *  - **Dropped is Operon's, when Operon owns the task.** An Operon line put in
 *    the dropped lane gets `{{status:: Project.Dropped}}`, which is exactly
 *    what Operon writes when you drop it there; bringing it back sets
 *    `Project.Planned`. A plain line has no such status, so dropping it means
 *    what it means everywhere else in the vault: `- [-]`, the cancelled line
 *    the daily notes already use, plus `[eisenhower:: 5]` so the board can
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
const QUADRANT = /\[\s*eisenhower\s*::\s*([^\]]*?)\s*\]/u;
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

/** The text of a task line: no fields, no dates, no tags, no plan prefix. */
export function titleOf(rest: string): string {
  let text = rest;
  text = text.replace(OPERON_FIELD, " ");
  text = text.replace(INLINE_FIELD, " ");
  text = text.replace(/\s*\{\{[^{}]*\}\}/gu, " ");
  for (const stamp of STAMPS) text = text.replace(stamp, " ");
  text = text.replace(LEADING_PLAN, "");
  text = text.replace(TAG, "$1");
  return text.replace(/\s+/gu, " ").trim();
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
    priority: readField(raw, "priority"),
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
 */
export interface MatrixFilter {
  /** Planned for a day before today. */
  overdue: boolean;
  /** Planned for today or within the next week. */
  soon: boolean;
  /** Operon priority S or A. */
  priority: boolean;
}

export const NO_FILTER: MatrixFilter = { overdue: false, soon: false, priority: false };

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
  const field = `[eisenhower:: ${quadrant}]`;
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

/** The line with its quadrant field removed. */
export function clearQuadrant(raw: string): string {
  if (!QUADRANT.test(raw)) return raw;
  return raw.replace(QUADRANT, "").replace(/\s+$/u, "");
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
