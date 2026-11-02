/**
 * Model tests. Run with: npm test
 *
 * The fixtures are the shapes the vault actually holds: plain `#task` lines
 * written by hand or by the Tasks plugin, Operon lines with their `{{...}}`
 * block, ruler-scheduled lines, and their tombstones.
 *
 * What matters here:
 *  - a line's text is read without its fields, dates and tags, and those are
 *    kept apart, because the board shows the text and nothing else;
 *  - the quadrant is a field of the matrix and only of the matrix: Operon's
 *    priority is never rewritten;
 *  - dropped is Operon's status when Operon owns the task, and the field when
 *    the task is plain, so no task ends up with two contradicting answers;
 *  - a note that *shows* a task (fenced code) is not a note that holds one.
 */
import assert from "node:assert/strict";
import {
  DROPPED,
  NO_FILTER,
  addDays,
  applyFinish,
  applyMove,
  archiveBlock,
  archiveCutoff,
  clearQuadrant,
  renameQuadrantField,
  createdOf,
  monthOf,
  planArchive,
  completedOf,
  doneByDay,
  doneWithin,
  inFolder,
  isDone,
  laneOf,
  matchesFilter,
  parseTaskLine,
  plainTaskVisible,
  quadrantOf,
  scanNote,
  setQuadrant,
  sortTasks,
  taskKey,
  titleParts,
  todayOf,
  toggleCondition,
  windowLabel,
  type MatrixTask,
} from "../src/model";

let failed = 0;

function check(name: string, got: unknown, expected: unknown): void {
  try {
    assert.deepEqual(got, expected);
    console.log(`  ok  ${name}`);
  } catch {
    failed += 1;
    console.error(`FAIL  ${name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(expected)}`);
  }
}

function task(raw: string, line = 0): MatrixTask {
  const parsed = parseTaskLine(raw, "note.md", line);
  assert.ok(parsed !== null, `expected a task line: ${raw}`);
  return parsed;
}

const PLAIN = "- [ ] Mirar la práctica 1 #task ➕ 2026-09-16";
const SCHEDULED = "- [ ] Revisar el tema 3 #task [scheduled:: 2026-09-18T09:00] [duration:: 30m] [eisenhower:: 2]";
const OPERON =
  "- [ ] Descargar las transparencias {{operonId:: 8l9f9l2}} {{status:: Project.Brainstorming}} {{priority:: A}} {{dateScheduled:: 2026-09-20T10:00:00}}";

console.log("\nReading a line");

check("a plain task keeps its text and its tag apart", [task(PLAIN).title, task(PLAIN).tags], ["Mirar la práctica 1", ["#task"]]);
check("its quadrant is the matrix field", task(PLAIN).quadrant, null);
check("a scheduled task keeps the day", task(SCHEDULED).scheduled, "2026-09-18");
check("and the fields never reach the text", task(SCHEDULED).title, "Revisar el tema 3");
check("its quadrant is read", task(SCHEDULED).quadrant, 2);
check(
  "an Operon task keeps its identity, status and priority",
  [task(OPERON).operonId, task(OPERON).operonStatus, task(OPERON).priority],
  ["8l9f9l2", "Project.Brainstorming", "A"],
);
check("and its text is the text before the fields", task(OPERON).title, "Descargar las transparencias");
check("the Operon date is read as the day it is planned for", task(OPERON).scheduled, "2026-09-20");
check("a plan prefix is scheduling, not text", task("- [ ] 09:00 - 09:30 Llamar al banco #task").title, "Llamar al banco");
check(
  "a link keeps its words and drops its target",
  task("- [ ] Leer el libro [Administración de Proyectos](file:///Users/aknari/misc/doc/ulpgc/docencia/c-202627/51248-gdpp/support/books/Administracion_de_Proyectos_4ed_Clifford.pdf) #task").title,
  "Leer el libro Administración de Proyectos",
);
check("a target full of parentheses is still a target", task("- [ ] Ver [el PDF](file:///x/Proyectos_(4ed).pdf) #task").title, "Ver el PDF");
check("and so is one in angle brackets", task("- [ ] Mira [esto](<file:///x/con espacio.pdf>) #task").title, "Mira esto");
check("a link with no words leaves nothing behind", task("- [ ] Ver [](file:///x/a.pdf) y listo #task").title, "Ver y listo");
check("an embed is not text either", task("- [ ] Revisar ![esquema](file:///x/esquema.png) del tema #task").title, "Revisar del tema");
check(
  "a wikilink keeps its words and drops its brackets",
  task("- [ ] Ver [[Apuntes de Lisa]] antes #task").title,
  "Ver Apuntes de Lisa antes",
);
check("an alias is what a wikilink says", task("- [ ] Mirar [[Nota|las notas]] #task").title, "Mirar las notas");
check(
  "a heading is a place in the note, not part of its name",
  task("- [ ] Repasar [[Nota#Tema 3]] #task").title,
  "Repasar Nota",
);
check("an embedded note is not text either", task("- [ ] Ver ![[esquema.png]] esto #task").title, "Ver esto");
check(
  "code is read as code, without its backticks",
  titleParts("Revisar `mask` ahora"),
  [{ text: "Revisar " }, { text: "mask", code: true }, { text: " ahora" }],
);
check(
  "and what is inside code is never a mark",
  titleParts("Llamar a `set_cap_cfg()` y `_init_`"),
  [
    { text: "Llamar a " },
    { text: "set_cap_cfg()", code: true },
    { text: " y " },
    { text: "_init_", code: true },
  ],
);
check(
  "bold is a mark the card draws, not a word in the text",
  task("- [ ] Repasar **el tema 3** y a otra cosa #task").title,
  "Repasar **el tema 3** y a otra cosa",
);
check(
  "and it is read as styling",
  titleParts("Repasar **el tema 3**"),
  [
    { text: "Repasar " },
    { text: "el tema 3", bold: true },
  ],
);
check(
  "italics come in both notations, and bold in both too",
  ["*uno*", "_dos_", "__tres__"].map((one) => titleParts(one)),
  [
    [{ text: "uno", italic: true }],
    [{ text: "dos", italic: true }],
    [{ text: "tres", bold: true }],
  ],
);
check(
  "both at once is both",
  titleParts("***esto***"),
  [{ text: "esto", bold: true, italic: true }],
);
check(
  "an underscore inside a word is not emphasis",
  titleParts("Llamar a set_cap_cfg() y a p_stream"),
  [{ text: "Llamar a set_cap_cfg() y a p_stream" }],
);
check("a lone asterisk stays where it is", titleParts("El comodín gram*"), [{ text: "El comodín gram*" }]);
check("marks that do not close are words after all", titleParts("2 ** 3 y 4"), [{ text: "2 ** 3 y 4" }]);
check(
  "every word survives the reading, only the marks go",
  titleParts("**A** y *b* con _c_").map((part) => part.text).join(""),
  "A y b con c",
);
check(
  "a highlight is drawn as well, since asking for attention is the point",
  titleParts("Revisar ==esto== hoy"),
  [{ text: "Revisar " }, { text: "esto", highlight: true }, { text: " hoy" }],
);
check(
  "and so is a strike",
  titleParts("~~Viejo~~ Nuevo"),
  [{ text: "Viejo", strike: true }, { text: " Nuevo" }],
);
check(
  "a mark inside a mark keeps both",
  titleParts("**un _esto_ dentro**"),
  [{ text: "un ", bold: true }, { text: "esto", bold: true, italic: true }, { text: " dentro", bold: true }],
);
check(
  "and a highlight inside a bold one does too",
  titleParts("**Ojo: ==esto== y más**"),
  [{ text: "Ojo: ", bold: true }, { text: "esto", bold: true, highlight: true }, { text: " y más", bold: true }],
);
check(
  "a highlight that would close at a space is not one",
  titleParts("un ==dos == tres"),
  [{ text: "un ==dos == tres" }],
);
check("and one that never closes is not one", titleParts("pulsa ==esto"), [{ text: "pulsa ==esto" }]);
check("an indented subtask keeps its indent", task("  - [ ] Repasar el tema 3 #task").indent, 2);
check("a tombstone is not a task", parseTaskLine("- [>] Ya se llevó #task", "note.md", 0), null);
check("neither is a line that is not a task", parseTaskLine("En /home/bautista hay algo", "note.md", 0), null);
check("`- [!]` counts as pending", task("- [!] Mirar el vuelo #task").pending, true);

console.log("\nWhat the vault contributes");

const NOTE = [
  "# Nota",
  "- [ ] Real #task",
  "```md",
  "- [ ] De mentira #task",
  "```",
  "- [ ] Otra #task",
  "- [ ] Suelta, sin etiqueta",
  "- [x] Hecha #task",
  "- [-] Cancelada #task",
  "- [-] Descartada #task [eisenhower:: 5]",
  "",
].join("\n");
const scanned = scanNote(NOTE, "note.md", { taskTag: "#task" });
check("only the live, tagged lines come through", scanned.map((line) => line.title), ["Real", "Otra", "Descartada"]);
check("and a fenced sample is skipped", scanned.some((line) => line.title === "De mentira"), false);
check(
  "every scanned line knows where it lives",
  scanned.map((line) => line.line),
  [1, 5, 9],
);

console.log("\nWhat is finished");

check("a ✅ stamp is the day the line was closed", completedOf("- [x] X #task ✅ 2026-10-29"), "2026-10-29");
check("Operon writes the same day in its own field", completedOf("- [x] X {{operonId:: a}} {{dateCompleted:: 2026-10-19}}"), "2026-10-19");
check("a ticked box with no date has no day", completedOf("- [x] X #task"), null);
check("the stamp never reaches the text", task("- [x] X #task ✅ 2026-10-29").title, "X");
check("a plain ticked line is done", isDone(task("- [x] X #task ✅ 2026-10-29")), true);
check("a plain pending one is not", isDone(task("- [ ] X #task")), false);
check(
  "an Operon task follows its status, not its box",
  isDone(task("- [x] X {{operonId:: a}} {{status:: Project.Planned}}")),
  false,
);
check(
  "and one finished with the box behind it is done anyway",
  isDone(task("- [ ] X {{operonId:: a}} {{status:: Project.Finished}}")),
  true,
);
check(
  "a dropped Operon task is not a finished one",
  isDone(task("- [x] X {{operonId:: a}} {{status:: Project.Dropped}}")),
  false,
);

const withDone = scanNote(NOTE, "note.md", { taskTag: "#task", includeDone: true });
check("finished lines come back only when asked for", withDone.filter(isDone).map((line) => line.title), ["Hecha"]);
check(
  "and the live ones are untouched by the asking",
  withDone.filter((line) => !isDone(line)).map((line) => line.title),
  ["Real", "Otra", "Descartada"],
);
check("a cancelled line is never finished", withDone.some((line) => line.title === "Cancelada"), false);

console.log("\nLooking back at what is finished");

const finished = [
  task("- [x] Vieja #task ✅ 2026-10-01", 0),
  task("- [x] Ayer #task ✅ 2026-10-25", 1),
  task("- [x] Hoy #task ✅ 2026-10-26", 2),
  task("- [x] Sin fecha #task", 3),
];
const DAY = "2026-10-26";
check("a week back includes today", doneWithin(finished, 7, DAY).map((line) => line.title), ["Hoy", "Ayer"]);
check("a month reaches further", doneWithin(finished, 30, DAY).map((line) => line.title), ["Hoy", "Ayer", "Vieja"]);
check(
  "everything keeps the undated one, last",
  doneWithin(finished, 0, DAY).map((line) => line.title),
  ["Hoy", "Ayer", "Vieja", "Sin fecha"],
);
check(
  "a date in the future is shown rather than hidden",
  doneWithin([task("- [x] Mañana #task ✅ 2026-10-30")], 7, DAY).length,
  1,
);
check("the window has a name for the chip", [windowLabel(7), windowLabel(30), windowLabel(0)], ["last 7 days", "last 30 days", "everything"]);
const bars = doneByDay(finished, DAY);
check("seven bars, oldest first, ending today", [bars.length, bars[0].day, bars[6].day], [7, "2026-10-20", DAY]);
check("each bar counts its own day", [bars[0].count, bars[5].count, bars[6].count], [0, 1, 1]);

console.log("\nWhat reaches the board at all");

check("a folder matches its own notes", inFolder("10-journal/daily notes/2026-10-27.md", "10-journal/daily notes"), true);
check("and not a folder that merely starts the same", inFolder("10-journal/daily notes-old/x.md", "10-journal/daily notes"), false);
const inDaily = parseTaskLine("- [ ] X #task", "10-journal/daily notes/2026-10-27.md", 0)!;
const elsewhere = parseTaskLine("- [ ] X #task", "00-src/30-dev/notes.md", 0)!;
check("a plain task in a listed folder is shown", plainTaskVisible(inDaily, ["10-journal/daily notes"]), true);
check("a plain task elsewhere is not", plainTaskVisible(elsewhere, ["10-journal/daily notes"]), false);
check(
  "but one already placed stays visible wherever it lives",
  plainTaskVisible(parseTaskLine("- [ ] X #task [eisenhower:: 2]", "00-src/30-dev/notes.md", 0)!, ["10-journal/daily notes"]),
  true,
);
check(
  "an Operon task is shown wherever it lives",
  plainTaskVisible(parseTaskLine("- [ ] X {{operonId:: abc}}", "00-src/10-operon/tasks/inbox.md", 0)!, ["10-journal/daily notes"]),
  true,
);
check("an empty list imposes no limit", plainTaskVisible(elsewhere, []), true);

console.log("\nWriting the quadrant");

check("a quadrant is appended when the line has none", setQuadrant("- [ ] X #task", 3), "- [ ] X #task [quadrant:: 3]");
check("and replaced in place when it has one", setQuadrant("- [ ] X #task [quadrant:: 1]", 4), "- [ ] X #task [quadrant:: 4]");
check("an old eisenhower field is replaced by the new name", setQuadrant("- [ ] X #task [eisenhower:: 1]", 4), "- [ ] X #task [quadrant:: 4]");
check("a quadrant can be taken away", clearQuadrant("- [ ] X #task [quadrant:: 4]"), "- [ ] X #task");
check("and the old spelling is taken away too", clearQuadrant("- [ ] X #task [eisenhower:: 4]"), "- [ ] X #task");
check("the Operon block stays where it was", setQuadrant("- [ ] X {{operonId:: abc}}", 2), "- [ ] X {{operonId:: abc}} [quadrant:: 2]");

console.log("\nDropping and reviving");

check("a plain task dropped is cancelled, as the vault writes it", applyMove("- [ ] X #task", DROPPED), "- [-] X #task [quadrant:: 5]");
check("an indented plain task dropped keeps its indent", applyMove("  - [ ] X #task", DROPPED), "  - [-] X #task [quadrant:: 5]");
check(
  "an Operon task dropped gets Operon's own status",
  applyMove("- [ ] X {{operonId:: abc}} {{status:: Project.Planned}}", DROPPED),
  "- [ ] X {{operonId:: abc}} {{status:: Project.Dropped}}",
);
check(
  "an Operon task revived goes back to Planned and lands in its quadrant",
  applyMove("- [ ] X {{operonId:: abc}} {{status:: Project.Dropped}}", 2),
  "- [ ] X {{operonId:: abc}} {{status:: Project.Planned}} [quadrant:: 2]",
);
check(
  "a plain task revived from the dropped lane loses the field",
  applyMove("- [-] X #task [eisenhower:: 5]", 0),
  "- [ ] X #task",
);
check(
  "and one revived into a quadrant is pending again there",
  applyMove("- [-] X #task [eisenhower:: 5]", 3),
  "- [ ] X #task [quadrant:: 3]",
);
check(
  "the priority of Operon is never rewritten",
  applyMove("- [ ] X {{operonId:: abc}} {{priority:: A}}", 1).includes("{{priority:: A}}"),
  true,
);

console.log("\nFinishing a task");

check(
  "a plain task ticked on the Done lane is ticked and stamped today",
  applyFinish("- [ ] X #task [eisenhower:: 2]", "2026-10-29"),
  "- [x] X #task [eisenhower:: 2] ✅ 2026-10-29",
);
check("a cancelled line finished is ticked, not left cancelled", applyFinish("- [-] X #task", "2026-10-29"), "- [x] X #task ✅ 2026-10-29");
check(
  "an older stamp is replaced rather than doubled",
  applyFinish("- [x] X #task ✅ 2026-10-20", "2026-10-29"),
  "- [x] X #task ✅ 2026-10-29",
);
check(
  "an Operon task is finished in Operon's own notation",
  applyFinish("- [ ] X {{operonId:: abc}} {{status:: Project.Planned}} {{priority:: A}}", "2026-10-29"),
  "- [x] X {{operonId:: abc}} {{status:: Project.Finished}} {{priority:: A}} {{dateCompleted:: 2026-10-29}}",
);
check(
  "and an existing date is replaced where it was",
  applyFinish("- [x] X {{operonId:: abc}} {{status:: Project.Finished}} {{dateCompleted:: 2026-09-14}}", "2026-10-29"),
  "- [x] X {{operonId:: abc}} {{status:: Project.Finished}} {{dateCompleted:: 2026-10-29}}",
);
const finishedPlain = task(applyFinish("- [ ] X #task [eisenhower:: 3]", "2026-10-29"));
check("the finished line reads back as finished today", [isDone(finishedPlain), finishedPlain.completed], [true, "2026-10-29"]);
check("and it stays in its quadrant, so unticking it returns it there", laneOf(finishedPlain), 3);
check("nothing else is touched by the stamp", task(applyFinish("- [ ] X #task ➕ 2026-10-01", "2026-10-29")).title, "X");

console.log("\nRecognising the line again");

check("moving a plain task does not change its identity", taskKey("- [ ] X #task"), taskKey("- [ ] X #task [eisenhower:: 2]"));
check("moving an Operon task does not either", taskKey("- [ ] X {{operonId:: abc}}"), taskKey("- [ ] X [eisenhower:: 4] {{operonId:: abc}}"));
check("but any other edit does", taskKey("- [ ] X #task") === taskKey("- [ ] X, corregida #task"), false);
check("the old field and the new one are one identity", taskKey("- [ ] X #task [eisenhower:: 3]"), taskKey("- [ ] X #task [quadrant:: 4]"));

console.log("\nRenaming the old field");

check(
  "the old name becomes the new one, and nothing else changes",
  renameQuadrantField("- [ ] X #task [eisenhower:: 2] ➕ 2026-10-01"),
  "- [ ] X #task [quadrant:: 2] ➕ 2026-10-01",
);
check("a line already renamed is left alone", renameQuadrantField("- [ ] X #task [quadrant:: 2]"), null);
check("and so is a line with no quadrant at all", renameQuadrantField("- [ ] X #task"), null);
check(
  "renaming twice changes nothing more",
  renameQuadrantField(renameQuadrantField("- [ ] X #task [eisenhower:: 5]") ?? ""),
  null,
);

console.log("\nThe lane a task belongs to");

check("a quadrant field is its lane", laneOf(task("- [ ] X #task [quadrant:: 3]")), 3);
check("and the old spelling still puts it there", laneOf(task("- [ ] X #task [eisenhower:: 3]")), 3);
check("a task with no quadrant waits in the inbox", laneOf(task("- [ ] X #task")), 0);
check("a dropped Operon task is dropped even if it kept a quadrant", laneOf(task("- [ ] X {{operonId:: abc}} {{status:: Project.Dropped}} [eisenhower:: 2]")), DROPPED);
check("a plain task dropped by the field is dropped too", laneOf(task("- [ ] X #task [eisenhower:: 5]")), DROPPED);

console.log("\nOrder inside a lane");

const sorted = sortTasks([
  task("- [ ] Sin prioridad #task"),
  task("- [ ] C #task {{operonId:: c}} {{priority:: C}}", 1),
  task("- [ ] S #task {{operonId:: s}} {{priority:: S}}", 2),
  task("- [ ] A #task {{operonId:: a}} {{priority:: A}}", 3),
]);
check("Operon priority orders the lane, S first", sorted.map((line) => line.title), ["S", "A", "C", "Sin prioridad"]);

const byEmoji = sortTasks([task("- [ ] Sin #task"), task("- [ ] Emoji #task 🔼", 1)]);
check("a plain task with an emoji sorts by its rank, not with the ones that have none", byEmoji.map((line) => line.title), ["Emoji", "Sin"]);

check("an out-of-range quadrant is not a quadrant", quadrantOf("- [ ] X [eisenhower:: 9]"), null);

console.log("\nArchiving");

// The archive section comes before the filter fixtures declare TODAY, so it
// carries its own day instead of reaching forward for one.
const ARCHIVE_TODAY = "2026-10-26";
const OLD = addDays(ARCHIVE_TODAY, -40);
const ARCHIVE_NOTE = [
  `- [x] Vieja #task ✅ ${OLD}`,
  `- [x] Reciente #task ✅ ${ARCHIVE_TODAY}`,
  `- [-] Descartada #task [eisenhower:: 5] ➕ ${OLD}`,
  "- [-] Sin fecha #task [eisenhower:: 5]",
  `- [x] De Operon {{operonId:: zz1}} {{status:: Project.Finished}} {{dateCompleted:: ${OLD}}}`,
].join("\n");
const ARCHIVE_OPTIONS = { taskTag: "#task", folders: ["10-journal/daily notes"], today: ARCHIVE_TODAY, days: 30 };
const plan = planArchive([{ path: "10-journal/daily notes/2026-01-01.md", content: ARCHIVE_NOTE }], ARCHIVE_OPTIONS);
check("only what is old enough moves", plan.moving.map((item) => item.title), ["Vieja", "Descartada"]);
check("a recent one is counted, not moved", plan.recent, 1);
check("and one with no date is left alone", plan.undated, 1);
check(
  "the source keeps a tombstone, and everything else intact",
  plan.rewrites[0].content.split("\n"),
  [
    `- [>] Vieja #task ✅ ${OLD}`,
    `- [x] Reciente #task ✅ ${ARCHIVE_TODAY}`,
    `- [>] Descartada #task [eisenhower:: 5] ➕ ${OLD}`,
    "- [-] Sin fecha #task [eisenhower:: 5]",
    `- [x] De Operon {{operonId:: zz1}} {{status:: Project.Finished}} {{dateCompleted:: ${OLD}}}`,
  ],
);
check("an Operon task is never taken: its status is Operon's", plan.moving.some((item) => item.title === "De Operon"), false);
check("the archive names the note the lines came from", archiveBlock(plan.moving).split("\n")[0], "## De [[2026-01-01]]");
check("and keeps every line as it was", archiveBlock(plan.moving).includes(`- [x] Vieja #task ✅ ${OLD}`), true);
check("a day knows its month", monthOf(ARCHIVE_TODAY), ARCHIVE_TODAY.slice(0, 7));
check("the cutoff is the day the window opens", archiveCutoff(ARCHIVE_TODAY, 30), addDays(ARCHIVE_TODAY, -30));
check("the ➕ of a line is its date when it has no ✅", createdOf(`- [-] X #task ➕ ${OLD}`), OLD);
check("a line outside the folders the board reads is not the archive's business", planArchive([{ path: "80-support/x.md", content: `- [x] Vieja #task ✅ ${OLD}` }], ARCHIVE_OPTIONS).moving.length, 0);
check(
  "nothing old enough is nothing to rewrite",
  planArchive([{ path: "10-journal/daily notes/2026-01-02.md", content: `- [x] Nueva #task ✅ ${ARCHIVE_TODAY}` }], ARCHIVE_OPTIONS).rewrites.length,
  0,
);

console.log("\nNarrowing the board");

const TODAY = "2026-10-26";
const late = task("- [ ] Tarde #task ⏳ 2026-10-20", 0);
const today = task("- [ ] Hoy #task ⏳ 2026-10-26", 1);
const thisWeek = task("- [ ] Semana #task ⏳ 2026-10-30", 2);
const later = task("- [ ] Diciembre #task ⏳ 2026-12-01", 3);
const urgent = task("- [ ] Urgente #task {{operonId:: u}} {{priority:: S}}", 4);
const lateAndUrgent = task("- [ ] Ambas #task ⏳ 2026-10-20 {{operonId:: a}} {{priority:: A}}", 5);
const starred = task("- [ ] Destacada #task 🔺 ➕ 2026-10-27", 6);

check("today is a local calendar day", todayOf(new Date(2026, 9, 28, 23, 30)), "2026-10-28");
check("a week ahead crosses the month", addDays("2026-10-28", 7), "2026-11-04");
check("and a week back crosses it too", addDays("2026-11-04", -7), "2026-10-28");
check("no condition keeps every task", matchesFilter(later, NO_FILTER, TODAY), true);
check(
  "overdue is planned before today, not today",
  [late, today, thisWeek, later].filter((line) => matchesFilter(line, { ...NO_FILTER, overdue: true }, TODAY)).map((line) => line.title),
  ["Tarde"],
);
check(
  "the next seven days include today and the week",
  [late, today, thisWeek, later].filter((line) => matchesFilter(line, { ...NO_FILTER, soon: true }, TODAY)).map((line) => line.title),
  ["Hoy", "Semana"],
);
check(
  "the priority condition keeps S and A",
  [urgent, late].filter((line) => matchesFilter(line, { ...NO_FILTER, priority: true }, TODAY)).map((line) => line.title),
  ["Urgente"],
);
check(
  "conditions add up rather than replace each other",
  [late, today, urgent, lateAndUrgent].filter((line) => matchesFilter(line, { overdue: true, soon: false, priority: true }, TODAY)).map((line) => line.title),
  ["Ambas"],
);
check("a task with no date is never overdue", matchesFilter(task("- [ ] Sin fecha #task"), { ...NO_FILTER, overdue: true }, TODAY), false);
check("nor does it count as due soon", matchesFilter(task("- [ ] Sin fecha #task"), { ...NO_FILTER, soon: true }, TODAY), false);

check(
  "the emoji of a plain task is read as a priority",
  [starred.priority, task("- [ ] X #task ⏫").priority, task("- [ ] X #task 🔼").priority],
  ["S", "A", "B"],
);
check("and it is not part of the title", starred.title, "Destacada");
check("Operon's field wins when both are there", task("- [ ] X {{operonId:: e}} {{priority:: C}} ⏫").priority, "C");
check("no emoji and no field means no priority", task("- [ ] X #task").priority, null);
check("the priority condition reads the emoji too", matchesFilter(starred, { ...NO_FILTER, priority: true }, TODAY), true);

check(
  "overdue and next 7 days cannot be on together",
  toggleCondition({ ...NO_FILTER, overdue: true }, "soon"),
  { overdue: false, soon: true, priority: false },
);
check("a second click on the same chip clears it", toggleCondition({ ...NO_FILTER, soon: true }, "soon"), NO_FILTER);
check(
  "priority adds to a deadline condition",
  toggleCondition({ ...NO_FILTER, overdue: true }, "priority"),
  { overdue: true, soon: false, priority: true },
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nmodel: all checks passed");
