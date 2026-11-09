/**
 * Plugin smoke test. Run with: npm test
 *
 * The model tests say what a line means. This one says where the board lands
 * and what a click does: the plugin is loaded against an Obsidian double, in
 * the smallest app that can hold it — a vault of two notes, a workspace, a
 * leaf and a dialog.
 *
 * What it checks is what the change was about: the ribbon lands in the sidebar
 * and not on top of everything, a click opens the note *at the task's line*,
 * the filters belong to the plugin and redraw every surface, the code block
 * draws a live board into a note, and the dialog gets out of the way after you
 * have clicked a card.
 */

import assert from "node:assert/strict";
import QuadrantPlugin from "../src/main";
import { addDays, todayOf } from "../src/model";
import { FakeEl, TFile } from "./obsidian-stub";

// The finished line is stamped with the day the test runs: the Done strip looks
// at the last seven days, and a fixed date would fall out of its window.
const TODAY = todayOf();

const notes: Record<string, string> = {
  "10-journal/daily notes/2026-10-29.md": [
    "# Jueves",
    "",
    `- [ ] Escribir el guion del tema 1 #task [focus:: ${TODAY}T10:32]`,
    "- [ ] Preparar tema 2 {{operonId:: abc123}} {{status:: Project.Planned}} {{priority:: A}} [date:: 2026-10-30]",
    `- [x] Ya está hecho #task ✅ ${TODAY}`,
  ].join("\n"),
  "80-support/templates/daily.md": "- [ ] Plantilla que no debe salir #task",
};

const files = new Map<string, TFile>();
function fileOf(path: string): TFile {
  let file = files.get(path);
  if (file === undefined) {
    file = new TFile();
    file.path = path;
    file.name = path.split("/").pop() ?? path;
    file.basename = file.name.replace(/\.md$/u, "");
    files.set(path, file);
  }
  return file;
}

const opened: Array<{ path: string; line?: number }> = [];
const revealed: unknown[] = [];

let plugin: any;

const leaves: any[] = [];

function makeLeaf(): any {
  const leaf: any = {
    app,
    view: null,
    async setViewState(state: any) {
      const factory = plugin.__views.get(state.type);
      assert.ok(factory, `no view registered for ${state.type}`);
      leaf.view = factory(leaf);
      await leaf.view.onOpen();
    },
    async openFile(file: any, options?: any) {
      opened.push({ path: file.path, line: options?.eState?.line });
    },
  };
  leaves.push(leaf);
  return leaf;
}

/** The leaves that actually hold a board; a note's leaf holds none. */
const boards = () => leaves.filter((leaf) => leaf.view?.getViewType?.() === "quadrant-view");

/** The cards that are work to place — the Done strip's cards are a record. */
const liveCards = (el: FakeEl) => el.all("q-task").filter((card) => !card.hasClass("is-done"));

const workspace = {
  getLeavesOfType(type: string) {
    return leaves.filter((leaf) => leaf.view?.getViewType?.() === type);
  },
  getLeaf() { return makeLeaf(); },
  getRightLeaf() { return makeLeaf(); },
  revealLeaf(leaf: any) { revealed.push(leaf); },
  onLayoutReady(cb: () => unknown) { cb(); },
};

let readCount = 0;

const vault = {
  getMarkdownFiles() { return Object.keys(notes).map(fileOf); },
  getAbstractFileByPath(path: string) { return notes[path] === undefined ? null : fileOf(path); },
  async read(file: any) { readCount += 1; return notes[file.path]; },
  async cachedRead(file: any) { readCount += 1; return notes[file.path]; },
  async process(file: any, fn: (data: string) => string) {
    const next = fn(notes[file.path]);
    notes[file.path] = next;
    return next;
  },
  async modify() {},
  async create(path: string, data: string) { notes[path] = data; return fileOf(path); },
  async createFolder() {},
  on() { return {}; },
};

const app: any = { vault, workspace };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function main(): Promise<void> {
  plugin = new QuadrantPlugin(app);

  // --- what `onload` wires up -------------------------------------------
  await plugin.onload();
  assert.equal(plugin.__views.has("quadrant-view"), true, "the view is registered");
  assert.deepEqual(
    plugin.__commands.map((c: any) => c.id),
    [
      "open-sidebar",
      "open-tab",
      "open-dialog",
      "refresh",
      "archive",
      "rename-quadrant-field",
      "clear-extra-focus-marks",
    ],
    "the commands, in order",
  );
  assert.equal(plugin.__ribbon.length, 1, "one ribbon icon");
  assert.equal(plugin.__ribbon[0].title, "Quadrant");
  assert.equal(plugin.__ribbon[0].icon, "layout-grid");
  assert.equal(plugin.__blocks.has("quadrant"), true, "the fence is registered");

  // --- the ribbon opens the sidebar, beside the note ---------------------
  await plugin.__ribbon[0].callback();
  await flush(); // the ribbon callback is fire-and-forget: the board loads after it
  assert.equal(boards().length, 1, "one board for the first open");
  assert.equal(boards()[0].view.getViewType(), "quadrant-view");
  assert.equal(plugin.tasks.length, 2, "the template task is excluded, the done one is not live");
  assert.equal(plugin.done.length, 1, "and the finished one is kept apart");
  assert.equal(plugin.doneWindow, 7, "the strip starts at a week");

  const root: FakeEl = boards()[0].view.contentEl;
  assert.equal(root.hasClass("q-root"), true, "the board knows where it is");
  assert.equal(root.all("q-quadrant").length, 4, "four quadrants");
  assert.equal(root.all("q-strip").length, 3, "inbox, dropped and done");
  assert.equal(liveCards(root).length, 2, "both live tasks on the board");
  assert.equal(root.all("is-done").length, 1, "and the finished one, as a record");
  assert.equal(root.all("q-done-bar").length, 7, "seven marks, one per day");
  assert.equal(root.all("q-done-bar").filter((bar) => bar.classes.size > 1).length, 1, "today's mark is filled");

  // --- the focus is read from the line and painted, never written --------
  // The mark is the vault's: the board says which task it is and does not touch
  // the note. `Sin foco` is the other half, because an absence you can see is
  // the difference between "nothing is marked" and "I forgot".
  const inFocus = liveCards(root).filter((card) => card.hasClass("is-focus"));
  assert.equal(inFocus.length, 1, "the marked line is the card drawn in focus");
  assert.equal(inFocus[0].all("q-focus-time")[0].text.startsWith("En foco · "), true, "and the card says since when");
  assert.equal(
    root.all("q-focus")[0].text.startsWith("En foco: Escribir el guion del tema 1 · "),
    true,
    "the header names it",
  );
  assert.equal(
    root.all("q-focus").filter((el) => el.hasClass("is-none")).length,
    0,
    "and the board does not also say there is none",
  );
  assert.equal(
    notes["10-journal/daily notes/2026-10-29.md"].includes(`[focus:: ${TODAY}T10:32]`),
    true,
    "reading the board wrote nothing",
  );

  notes["10-journal/daily notes/2026-10-29.md"] = notes["10-journal/daily notes/2026-10-29.md"].replace(
    / \[focus:: [^\]]*\]/u,
    "",
  );
  await plugin.refresh();
  assert.equal(root.all("q-focus")[0].text, "Sin foco", "no mark reads as Sin foco");

  // --- a click opens the note at the task's line ------------------------
  // Priority A sorts first inside the inbox, so the Operon line is card 0.
  liveCards(root)[0].click();
  await flush();
  assert.deepEqual(opened.at(-1), { path: "10-journal/daily notes/2026-10-29.md", line: 3 });
  liveCards(root)[1].click();
  await flush();
  assert.equal(opened.at(-1)?.line, 2, "each card opens its own line");

  // A finished card is a pointer too, and it is not draggable: the quadrant of
  // something already done is not a question the board should ask.
  root.all("is-done")[0].click();
  await flush();
  assert.equal(opened.at(-1)?.line, 4, "the finished card opens its own line");
  assert.equal(root.all("is-done")[0].draggable, false, "and cannot be dragged");

  // --- the ribbon again reveals the board instead of building a second --
  const revealsBefore = revealed.length;
  await plugin.__ribbon[0].callback();
  await flush();
  assert.equal(boards().length, 1, "still one board");
  assert.equal(revealed.length, revealsBefore + 1, "and the same board was revealed");

  // --- "open in a tab" means a tab, not the sidebar's board ------------
  const tabCommand = plugin.__commands.find((c: any) => c.id === "open-tab");
  tabCommand.callback();
  await flush();
  assert.equal(boards().length, 2, "a second board, in a tab");
  assert.equal(boards()[1].view.getViewType(), "quadrant-view");
  assert.equal(liveCards(boards()[1].view.contentEl).length, 2, "and it holds the same board");

  // --- the filters belong to the plugin, and every surface is redrawn --
  assert.equal(plugin.filters.priority, false);
  plugin.toggleFilter("priority");
  assert.equal(plugin.filters.priority, true, "the filter is the plugin's");
  assert.equal(liveCards(root).length, 1, "priority S/A keeps the A task only");
  assert.equal(liveCards(boards()[1].view.contentEl).length, 1, "the tab narrows the same way");
  assert.equal(root.all("is-done").length, 1, "the finished work is not a filter's business");
  plugin.clearFilters();
  assert.equal(liveCards(root).length, 2, "and clearing brings both back");

  // --- the Done window is the board's, not a re-read --------------------
  const readsBefore = readCount;
  plugin.setDoneWindow(30);
  assert.equal(plugin.doneWindow, 30, "the window moved");
  assert.equal(readCount, readsBefore, "and nothing was read again to do it");
  plugin.setDoneWindow(7);
  assert.equal(plugin.doneWindow, 7, "and back");

  // --- the three strips close as one row, and it is remembered -----------
  // The row may be closed; the four cells may not, and there is one control for
  // the three strips rather than three chevrons: it is one decision, not six.
  assert.equal(plugin.stripsCollapsed, false, "the strips start open");
  root.all("q-strips-fold")[0].click();
  await flush();
  assert.equal(plugin.stripsCollapsed, true, "the row is closed");
  assert.equal(root.all("q-strip").length, 0, "and the three lanes are gone");
  assert.equal(root.all("q-quadrant").length, 4, "while the four cells stay");
  assert.equal(boards()[1].view.contentEl.all("q-strips-line").length, 1, "every surface closes together");

  // Closed is not hidden: the row becomes a line of counts, so nothing leaves
  // the screen — a lane you cannot see is one you forget.
  const folded = root.all("q-strips-line")[0];
  const foldedText = folded.all("q-strips-line-text")[0].text;
  assert.ok(
    /^Done 1 · Unclassified \d+ · Dropped \d+$/u.test(foldedText),
    `the line counts what is in the three lanes (got ${foldedText})`,
  );
  folded.click();
  await flush();
  assert.equal(plugin.stripsCollapsed, false, "and clicking the line opens them again");
  assert.equal(root.all("q-strip").length, 3, "all three back, not one");
  assert.equal(root.all("q-strips-line").length, 0, "the line gives way to the lanes");

  // --- the code block: a board inside a note ----------------------------
  const inNote = new FakeEl();
  const children: any[] = [];
  const ctx = { sourcePath: "01-inbox/home.md", addChild(child: any) { children.push(child); } };
  const handler = plugin.__blocks.get("quadrant");
  const attachedBefore = plugin.surfaces.size;
  await handler("", inNote, ctx);
  assert.equal(plugin.surfaces.size, attachedBefore + 1, "the block's board is attached");
  assert.equal(inNote.hasClass("q-inline"), true, "the block has its own sizing");
  assert.equal(inNote.all("q-quadrant").length, 4, "the whole board, in a note");
  assert.equal(liveCards(inNote).length, 2);
  assert.equal(inNote.all("q-done-bar").length, 7, "the rhythm comes with it");
  assert.equal(children.length, 1, "the block registered something to unload");

  liveCards(inNote)[0].click();
  await flush();
  assert.equal(opened.at(-1)?.line, 3, "a card in a note goes to its line too");

  // A note is redrawn whenever it is shown, so the old board must let go.
  children[0].onunload();
  assert.equal(inNote.children.length, 0, "unloading the block empties it");
  assert.equal(plugin.surfaces.size, attachedBefore, "and forgets its board");

  // --- the dialog: same board, and it gets out of the way ---------------
  const dialog = plugin.__commands.find((c: any) => c.id === "open-dialog");
  dialog.callback();
  await flush();
  const modal = (globalThis as any).__modals.at(-1);
  assert.equal(modal.contentEl.hasClass("q-modal"), true);
  assert.equal(liveCards(modal.contentEl).length, 2);
  assert.equal(modal.contentEl.all("is-done").length, 1);
  const before = opened.length;
  liveCards(modal.contentEl)[1].click();
  await flush();
  assert.equal(opened.length, before + 1, "the click still navigates");
  assert.equal(opened.at(-1)?.line, 2);
  assert.equal(modal.closed, true, "and the dialog closes itself");

  // --- a board that cannot be mounted still shows ------------------------
  // A leaf that refuses the view is the bug the dialog exists for: the board
  // must land on screen anyway, and say why it took the second route.
  const refusingWorkspace = {
    getLeavesOfType() { return []; },
    getRightLeaf() { return { async setViewState() { throw new Error("the leaf refused"); } }; },
    getLeaf() { return { async setViewState() { throw new Error("the leaf refused"); } }; },
    revealLeaf() {},
    onLayoutReady() {},
  };
  const refusing: any = new QuadrantPlugin({
    vault: { ...vault, getMarkdownFiles: () => [] },
    workspace: refusingWorkspace,
  } as any);
  await refusing.onload();
  const modalsBefore = (globalThis as any).__modals.length;
  const noticesBefore = (globalThis as any).__notices.length;
  // The plugin logs the failure on purpose; keep it out of the test's output
  // but check that it happened.
  const logged: unknown[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    await refusing.openSidebar();
  } finally {
    console.error = realError;
  }
  assert.equal(logged.length, 1, "the failure is logged, not swallowed");
  assert.equal((globalThis as any).__modals.length, modalsBefore + 1, "the dialog is the fallback");
  assert.ok((globalThis as any).__notices.length > noticesBefore, "and the failure is reported");

  // --- the settings tab draws -------------------------------------------
  plugin.__tab.display();
  assert.ok(plugin.__tab.containerEl.children.length > 0, "the settings tab has content");

  // --- dropping a card on Done finishes it -------------------------------
  // The lane is not a place a task goes, it is a conclusion: the drop writes
  // the completion on the line, in the notation that line already reads. Both
  // of these run last, because afterwards there is nothing live left to test.
  const notePath = "10-journal/daily notes/2026-10-29.md";
  const doneStrip = root.all("q-done-strip")[0];
  assert.ok(doneStrip, "the Done strip is on the board");
  const dropOn = (path: string, line: number): void => {
    const event = {
      preventDefault() {},
      relatedTarget: null,
      dataTransfer: { getData: () => JSON.stringify({ path, line }), dropEffect: "" },
    };
    for (const fn of doneStrip.listeners.drop ?? []) fn(event);
  };

  assert.equal(liveCards(root)[1].dataset.line, "2", "the plain card is the second one");
  dropOn(notePath, 2);
  await flush();
  await flush();
  assert.equal(
    notes[notePath].split("\n")[2],
    `- [x] Escribir el guion del tema 1 #task ✅ ${TODAY}`,
    "a plain task dropped on Done is ticked and stamped with today",
  );
  assert.equal(plugin.tasks.length, 1, "it left the live board");
  assert.equal(plugin.done.length, 2, "and joined the finished ones");

  dropOn(notePath, 3);
  await flush();
  await flush();
  const operonLine = notes[notePath].split("\n")[3];
  assert.ok(operonLine.includes("{{status:: Project.Finished}}"), "an Operon task gets Operon's own status");
  assert.ok(operonLine.includes(`{{dateCompleted:: ${TODAY}}}`), "and Operon's own completion date");
  assert.ok(operonLine.includes("{{priority:: A}}"), "the priority is left alone");
  assert.ok(operonLine.includes("[date:: 2026-10-30]"), "as is the day it was planned for");
  assert.equal(plugin.tasks.length, 0, "nothing live is left on the board");
  assert.equal(plugin.done.length, 3, "all three are finished now");
  assert.equal(root.all("is-done").length, 3, "and the strip shows three records");
  assert.equal(root.all("is-done").every((card) => card.draggable === false), true, "none of which can be dragged");

  // A drop with a payload that is not a card of this board writes nothing.
  const settled = notes[notePath];
  dropOn(notePath, 99);
  await flush();
  assert.equal(notes[notePath], settled, "a stale payload is ignored instead of writing");

  // --- the ribbon lands where the setting says ---------------------------
  // The sidebar is the default, so the two other placements are the ones the
  // setting has to change: the same icon, a different container, and no board
  // built twice when one is already there.
  plugin.settings.openIn = "tab";
  const tabBoardsBefore = boards().length;
  const revealsBeforePlacement = revealed.length;
  await plugin.openFromRibbon();
  await flush();
  assert.equal(boards().length, tabBoardsBefore, "a tab in the main area is reused, not duplicated");
  assert.equal(revealed.length, revealsBeforePlacement + 1, "and it is brought to the front");

  plugin.settings.openIn = "dialog";
  const modalsBeforePlacement = (globalThis as any).__modals.length;
  await plugin.openFromRibbon();
  await flush();
  assert.equal((globalThis as any).__modals.length, modalsBeforePlacement + 1, "a dialog opens a board of its own");

  // An unknown value in a hand-edited data.json is not allowed to leave the
  // ribbon doing nothing: it falls back to the sidebar.
  const odd: any = new QuadrantPlugin({ vault, workspace } as any);
  odd.loadData = async () => ({ openIn: "nowhere" });
  await odd.onload();
  assert.equal(odd.settings.openIn, "sidebar", "a placement that is not one of the three is ignored");

  // --- the archive command: a move, not a delete --------------------------
  // A line old enough travels to the month's file and its note keeps the
  // tombstone; a recent one, or one with no date to judge it by, stays put.
  const OLD = addDays(TODAY, -40);
  const archiveSource = "10-journal/daily notes/2026-01-05.md";
  notes[archiveSource] = [
    `- [x] Tarea vieja #task ✅ ${OLD}`,
    `- [x] Tarea de ayer #task ✅ ${TODAY}`,
    `- [ ] Pendiente vieja #task ➕ ${OLD}`,
    `- [-] Descartada hace tiempo #task [eisenhower:: 5] ➕ ${OLD}`,
    "- [-] Sin fecha #task [eisenhower:: 5]",
  ].join("\n");
  await plugin.refresh();

  plugin.__commands.find((c: any) => c.id === "archive").callback();
  await flush();
  const archiveModal = (globalThis as any).__modals.at(-1);
  assert.equal(archiveModal.contentEl.hasClass("q-archive-modal"), true, "the archive asks before it writes");
  archiveModal.contentEl.all("q-archive-go")[0].click();
  for (let i = 0; i < 5; i += 1) await flush();

  const source = notes[archiveSource].split("\n");
  assert.equal(source[0], `- [>] Tarea vieja #task ✅ ${OLD}`, "the archived line leaves a tombstone behind");
  assert.equal(source[1], `- [x] Tarea de ayer #task ✅ ${TODAY}`, "a recent one is not touched");
  assert.equal(source[2], `- [ ] Pendiente vieja #task ➕ ${OLD}`, "an old line still to do is not archived");
  assert.equal(source[3], `- [>] Descartada hace tiempo #task [eisenhower:: 5] ➕ ${OLD}`, "a dropped one moves by its own date");
  assert.equal(source[4], "- [-] Sin fecha #task [eisenhower:: 5]", "and the one with no date stays");

  const archiveFile = notes[`10-journal/archive/tareas/${TODAY.slice(0, 7)}.md`];
  assert.ok(archiveFile, "the month's file exists");
  assert.ok(archiveFile.includes(`- [x] Tarea vieja #task ✅ ${OLD}`), "and keeps the line as it was");
  assert.ok(archiveFile.includes("## De [[2026-01-05]]"), "naming the note it came from");
  assert.ok(!archiveFile.includes("Sin fecha"), "nothing undated was taken");
  assert.ok(!archiveFile.includes("Pendiente vieja"), "and nothing still open was taken either");

  // Unticking one line in the dialog leaves it where it is: the job says what
  // it would do, and you are the one who says what it does.
  const picky = "10-journal/daily notes/2026-01-07.md";
  notes[picky] = [
    `- [x] Una #task ✅ ${OLD}`,
    `- [x] Otra #task ✅ ${OLD}`,
  ].join("\n");
  await plugin.refresh();
  plugin.__commands.find((c: any) => c.id === "archive").callback();
  await flush();
  const pickyModal = (globalThis as any).__modals.at(-1);
  const walk = (el: any): any[] => [el, ...el.children.flatMap(walk)];
  const boxes = walk(pickyModal.contentEl).filter((el: any) => el.tagName === "input");
  assert.equal(boxes.length, 2, "the dialog offers a tick per task, all of them on");
  const kept = boxes.find((box: any) => box.parent.children[1].text === "Otra");
  kept.checked = false;
  for (const fn of kept.listeners.change) fn();
  const pickyGo = pickyModal.contentEl.all("q-archive-go")[0];
  assert.equal(pickyGo.text, "Archive 1", "the button counts what is still ticked");
  pickyGo.click();
  for (let i = 0; i < 5; i += 1) await flush();

  const pickyLines = notes[picky].split("\n");
  assert.equal(pickyLines[0], `- [>] Una #task ✅ ${OLD}`, "the ticked line moves");
  assert.equal(pickyLines[1], `- [x] Otra #task ✅ ${OLD}`, "the unticked one does not, and is not tombstoned");
  assert.ok(!notes[`10-journal/archive/tareas/${TODAY.slice(0, 7)}.md`].includes("- [x] Otra"), "nor is it written to the archive");

  // --- renaming the old field: housekeeping, and only the name -----------
  // The board reads both names, so this command exists only to leave the vault
  // saying one thing. The value and the rest of the line must survive it, and
  // the lines that need no rename must not be written at all.
  const legacyNote = "10-journal/daily notes/2026-01-06.md";
  notes[legacyNote] = [
    "- [ ] Vieja #task [eisenhower:: 2] ➕ 2026-01-06",
    "- [ ] Nueva #task [quadrant:: 4]",
    "- [ ] Sin cuadrante #task",
  ].join("\n");
  await plugin.refresh();
  plugin.__commands.find((c: any) => c.id === "rename-quadrant-field").callback();
  for (let i = 0; i < 3; i += 1) await flush();
  const renameModal = (globalThis as any).__modals.at(-1);
  const renameGo = renameModal.contentEl.all("q-archive-go")[0];
  assert.equal(renameGo.text, "Rename", "the rename asks before it writes");
  renameGo.click();
  for (let i = 0; i < 5; i += 1) await flush();
  assert.deepEqual(
    notes[legacyNote].split("\n"),
    [
      "- [ ] Vieja #task [quadrant:: 2] ➕ 2026-01-06",
      "- [ ] Nueva #task [quadrant:: 4]",
      "- [ ] Sin cuadrante #task",
    ],
    "the old name becomes the new one, and the line is otherwise untouched",
  );

  // --- the order inside a lane -------------------------------------------
  // Dropping a card on another one says where it goes, and the arrangement is
  // remembered in the plugin's data. Nothing about the task changed, so the
  // note must not be rewritten for a reordering.
  const orderNote = "10-journal/daily notes/2026-01-07.md";
  const orderText = ["- [ ] Zeta #task", "- [ ] Alfa #task"].join("\n");
  notes[orderNote] = orderText;
  await plugin.refresh();
  const cardsIn = (): any[] => liveCards(root).filter((card: any) => card.dataset.path === orderNote);
  assert.deepEqual(cardsIn().map((card: any) => card.dataset.line), ["1", "0"], "the lane opens in the automatic order");
  const reorderEvent = {
    preventDefault() {},
    stopPropagation() {},
    relatedTarget: null,
    clientY: 0,
    dataTransfer: { getData: () => JSON.stringify({ path: orderNote, line: 0 }), dropEffect: "" },
  };
  for (const fn of cardsIn()[0].listeners.drop ?? []) fn(reorderEvent);
  for (let i = 0; i < 3; i += 1) await flush();
  assert.deepEqual(cardsIn().map((card: any) => card.dataset.line), ["0", "1"], "dropping Zeta on Alfa puts it first");
  assert.equal(notes[orderNote], orderText, "and the note is not rewritten to say so");
  await plugin.refresh();
  assert.deepEqual(cardsIn().map((card: any) => card.dataset.line), ["0", "1"], "the arrangement outlives a refresh");

  // --- the pin: one session at a time ------------------------------------
  // Pinning writes two things at once — the mark, and the card's place in Do
  // now/Doing — and asks before it takes the mark off another task. A second
  // click on the same pin takes the mark off and moves nothing.
  const focusNote = "10-journal/daily notes/2026-01-08.md";
  notes[focusNote] = [
    "- [ ] Borrador #task [quadrant:: 2]",
    "- [ ] Guion #task [quadrant:: 3]",
  ].join("\n");
  await plugin.refresh();
  const cardIn = (line: number): any => liveCards(root).find(
    (card: any) => card.dataset.path === focusNote && card.dataset.line === String(line),
  );
  assert.ok(cardIn(0) && cardIn(1), "both tasks of the note are on the board");
  assert.equal(cardIn(0).all("q-pin").length, 1, "every live card carries the pin");
  assert.equal(cardIn(0).all("q-pin")[0].attrs["aria-label"], "Work on this task now", "which says what it will do");

  cardIn(0).all("q-pin")[0].click();
  for (let i = 0; i < 5; i += 1) await flush();
  let focusLines = notes[focusNote].split("\n");
  assert.equal(
    focusLines[0].startsWith(`- [ ] Borrador #task [quadrant:: 1] [focus:: ${TODAY}T`),
    true,
    "pinning marks the line and moves it to Do now, in one write",
  );
  assert.equal(root.all("q-focus")[0].text.startsWith("En foco: Borrador · "), true, "and the header names it");
  assert.equal(
    plugin.settings.order["1"],
    undefined,
    "and pinning writes nothing about the order: the front is only how it is drawn",
  );
  assert.equal(
    cardIn(0).all("q-pin")[0].attrs["aria-label"],
    "Take the focus off this task",
    "the pin now says how to stop",
  );

  const modalsBeforeFocus = (globalThis as any).__modals.length;
  cardIn(1).all("q-pin")[0].click();
  for (let i = 0; i < 3; i += 1) await flush();
  assert.equal((globalThis as any).__modals.length, modalsBeforeFocus + 1, "moving the focus asks first");
  const focusModal = (globalThis as any).__modals.at(-1);
  assert.equal(focusModal.contentEl.hasClass("q-focus-modal"), true, "the question is the focus one");
  assert.equal(
    notes[focusNote].split("\n")[1],
    "- [ ] Guion #task [quadrant:: 3]",
    "and nothing is written while it is open",
  );

  focusModal.contentEl.all("q-focus-go")[0].click();
  for (let i = 0; i < 6; i += 1) await flush();
  focusLines = notes[focusNote].split("\n");
  assert.equal(
    focusLines[0],
    "- [ ] Borrador #task [quadrant:: 1]",
    "yes takes the mark off the old one, and leaves its card where it is",
  );
  assert.equal(
    focusLines[1].startsWith(`- [ ] Guion #task [quadrant:: 1] [focus:: ${TODAY}T`),
    true,
    "and puts it on the new one, in Do now",
  );

  assert.deepEqual(
    liveCards(root)
      .filter((card: any) => card.dataset.path === focusNote)
      .map((card: any) => card.dataset.line),
    ["1", "0"],
    "and the task you are on is the first card of the lane",
  );

  cardIn(1).all("q-pin")[0].click();
  for (let i = 0; i < 5; i += 1) await flush();
  assert.equal(
    notes[focusNote].split("\n")[1],
    "- [ ] Guion #task [quadrant:: 1]",
    "a second click takes the mark off and moves nothing",
  );
  assert.deepEqual(
    liveCards(root)
      .filter((card: any) => card.dataset.path === focusNote)
      .map((card: any) => card.dataset.line),
    ["0", "1"],
    "and the card goes back to its place as soon as the mark is gone",
  );
  assert.equal(root.all("q-focus")[0].hasClass("is-none"), true, "and the board says there is no focus");

  // --- two marks by hand: the board says so, and one command settles it ---
  // The pin cannot leave two (it clears the old one first). A hand edit or two
  // devices can, so the header says it out loud, and the command lists them and
  // clears all but the one you keep — nothing else on the lines moves.
  const clashNote = "10-journal/daily notes/2026-01-09.md";
  notes[clashNote] = [
    `- [ ] Uno #task [quadrant:: 1] [focus:: ${TODAY}T09:00]`,
    `- [ ] Dos #task [quadrant:: 1] [focus:: ${TODAY}T09:30]`,
  ].join("\n");
  await plugin.refresh();
  assert.equal(root.all("q-focus")[0].hasClass("is-conflict"), true, "two marks at once are said out loud");

  plugin.__commands.find((c: any) => c.id === "clear-extra-focus-marks").callback();
  await flush();
  const clashModal = (globalThis as any).__modals.at(-1);
  assert.equal(clashModal.contentEl.hasClass("q-focus-modal"), true, "and the command shows them before it writes");
  clashModal.contentEl.all("q-focus-go")[0].click();
  for (let i = 0; i < 8; i += 1) await flush();

  assert.deepEqual(
    notes[clashNote].split("\n"),
    [`- [ ] Uno #task [quadrant:: 1] [focus:: ${TODAY}T09:00]`, "- [ ] Dos #task [quadrant:: 1]"],
    "the one you keep keeps its mark, and the other loses only that",
  );
  assert.equal(root.all("q-focus")[0].hasClass("is-conflict"), false, "and the board is back to one focus");

  console.log("plugin: all checks passed", {
    tasks: plugin.tasks.length,
    opened: opened.length,
    revealed: revealed.length,
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
