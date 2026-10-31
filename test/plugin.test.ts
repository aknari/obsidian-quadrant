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
import { todayOf } from "../src/model";
import { FakeEl, TFile } from "./obsidian-stub";

// The finished line is stamped with the day the test runs: the Done strip looks
// at the last seven days, and a fixed date would fall out of its window.
const TODAY = todayOf();

const notes: Record<string, string> = {
  "10-journal/daily notes/2026-10-29.md": [
    "# Jueves",
    "",
    "- [ ] Escribir el guion del tema 1 #task",
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
    ["open-sidebar", "open-tab", "open-dialog", "refresh"],
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
