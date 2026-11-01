/**
 * The board itself, and the three places it can live: the sidebar, a tab, and
 * a note.
 *
 * The drawing lives in `Board`, which knows nothing about Obsidian views: it
 * takes a container and a host, and the host decides what a click does. That
 * way a leaf Obsidian agreed to mount, a dialog built on the spot and a note
 * that merely contains a code block cannot behave differently.
 *
 * No copy of a task is ever made: the note keeps being the only place the task
 * exists, and the board is just a reading of it.
 */

import { App, ItemView, Modal, Notice, WorkspaceLeaf } from "obsidian";
import {
  DONE_WINDOWS,
  DROPPED,
  doneByDay,
  doneWithin,
  filterActive,
  laneOf,
  matchesFilter,
  sortTasks,
  titleParts,
  todayOf,
  windowLabel,
  type DoneWindow,
  type MatrixFilter,
  type MatrixTask,
} from "./model";

export const VIEW_TYPE = "quadrant-view";

/** The fence that draws the board inside a note. */
export const BLOCK_LANGUAGE = "quadrant";

/**
 * The four cells. No Urgent / Important axes are drawn: the hint under each
 * name says which cell it is, and "Quick pass" replaces the usual "Delegate"
 * because these are tasks you do yourself — handing one to someone else is a
 * note you add, not a drawer the board decides for you.
 */
const QUADRANTS: Array<{ n: number; title: string; hint: string }> = [
  { n: 1, title: "Do now", hint: "urgent · important" },
  { n: 2, title: "Schedule", hint: "important · not urgent" },
  { n: 3, title: "Quick pass", hint: "urgent · not important" },
  { n: 4, title: "Some day", hint: "neither urgent nor important" },
];

/** Anything that shows the board and can be asked to redraw. */
export interface MatrixSurface {
  render(): void;
}

/**
 * What the board needs from the plugin: the tasks, the filters — which live in
 * the plugin so that every surface shows the same narrowing and it survives
 * closing the board — a reload, a write, and a way to go to a task.
 */
export interface MatrixHost {
  tasks: MatrixTask[];
  /**
   * Every finished task the board is allowed to see, whatever its date: the
   * window only narrows how they are shown, so switching it needs no re-read.
   */
  done: MatrixTask[];
  doneWindow: DoneWindow;
  lastLoaded: Date | null;
  filters: MatrixFilter;
  refresh(): Promise<void>;
  setDoneWindow(window: DoneWindow): void;
  move(task: MatrixTask, target: number): Promise<void>;
  /** Ticks the task's line as finished today; Done is the only lane that writes a completion. */
  finish(task: MatrixTask): Promise<void>;
  openTask(task: MatrixTask): void | Promise<void>;
  toggleFilter(key: keyof MatrixFilter): void;
  clearFilters(): void;
  attach(surface: MatrixSurface): void;
  forget(surface: MatrixSurface): void;
}

interface DragPayload {
  path?: string;
  line?: number;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export class Board {
  private busy = false;

  /**
   * `afterOpen` runs once a card has been clicked: the dialog uses it to close
   * itself, because a note opened underneath a dialog is a note you cannot see.
   */
  constructor(
    private container: HTMLElement,
    private host: MatrixHost,
    private afterOpen: () => void = () => {},
  ) {}

  /** Draws, or says why it could not: a blank pane with no message is a bug report with no content. */
  render(): void {
    try {
      this.draw();
    } catch (error) {
      console.error("[quadrant] could not draw the board", error);
      new Notice(`Quadrant: could not draw the board (${String(error)})`);
    }
  }

  private draw(): void {
    const today = todayOf();
    const filter = this.host.filters;
    const visible = this.host.tasks.filter((task) => matchesFilter(task, filter, today));
    const lanes = new Map<number, MatrixTask[]>();
    for (const n of [0, ...QUADRANTS.map((q) => q.n), DROPPED]) lanes.set(n, []);
    for (const task of visible) {
      const lane = laneOf(task);
      lanes.get(lane)?.push(task);
    }
    for (const [lane, tasks] of lanes) lanes.set(lane, sortTasks(tasks));

    const root = this.container;
    root.empty();

    const header = root.createDiv({ cls: "q-header" });
    header.createEl("h2", { text: "Quadrant" });

    const unclassified = lanes.get(0)?.length ?? 0;
    const shown = visible.length;
    const total = this.host.tasks.length;
    const week = doneByDay(this.host.done, today);
    const todayDone = week[week.length - 1]?.count ?? 0;
    const summary = [
      shown === total ? `${total} live` : `${shown} of ${total} live`,
      `${unclassified} unclassified`,
      `${todayDone} done today`,
    ];
    if (this.host.lastLoaded !== null && !this.busy) summary.push(`updated ${clock(this.host.lastLoaded)}`);
    header.createSpan({ cls: "q-summary", text: summary.join(" · ") });

    const refresh = header.createEl("button", {
      cls: "q-refresh",
      text: this.busy ? "Refreshing…" : "Refresh",
    });
    if (this.busy) refresh.setAttr("disabled", "true");
    refresh.addEventListener("click", () => { void this.reload(); });

    const bar = root.createDiv({ cls: "q-filters" });
    const chip = (label: string, key: keyof MatrixFilter): void => {
      const el = bar.createEl("button", { cls: "q-chip", text: label });
      if (filter[key]) el.addClass("is-on");
      el.addEventListener("click", () => this.host.toggleFilter(key));
    };
    chip("Overdue", "overdue");
    chip("Next 7 days", "soon");
    chip("Priority S/A", "priority");
    if (filterActive(filter)) {
      const clear = bar.createEl("button", { cls: "q-chip is-clear", text: "Clear filters" });
      clear.addEventListener("click", () => this.host.clearFilters());
    }

    const board = root.createDiv({ cls: "q-board" });
    for (const quadrant of QUADRANTS) {
      this.lane(board, "q-quadrant", quadrant.n, quadrant.title, quadrant.hint, lanes.get(quadrant.n) ?? []);
    }

    const strips = root.createDiv({ cls: "q-strips" });
    this.lane(strips, "q-strip", 0, "Unclassified", "not placed yet", lanes.get(0) ?? []);
    this.lane(strips, "q-strip is-dropped", DROPPED, "Dropped", "out of the way", lanes.get(DROPPED) ?? []);
    this.doneLane(strips, today);
  }

  /**
   * The finished work, read-only in its cards but not in its lane: what you
   * have closed lately, the rhythm of the last week in seven marks, and the one
   * place a card can be dropped to say it is finished.
   *
   * Dropping here writes the completion on the line the card came from — the
   * `✅` stamp for a plain task, Operon's status for an Operon one — and the
   * board then reads the line like any other. A finished card itself cannot be
   * dragged, and the filters above do not apply to the lane: "overdue" and
   * "this week" are about work left, and a finished task is never late in a way
   * worth showing.
   */
  private doneLane(container: HTMLElement, today: string): void {
    const window = this.host.doneWindow;
    const tasks = doneWithin(this.host.done, window, today);
    const lane = container.createDiv({ cls: "q-strip q-done-strip" });

    const head = lane.createDiv({ cls: "q-lane-head" });
    head.createEl("h3", { text: "Done", attr: { title: "Drop a card here to finish it today" } });
    head.createSpan({ cls: "q-lane-hint", text: windowLabel(window) });
    head.createSpan({ cls: "q-count", text: String(tasks.length) });

    // The window and the rhythm share one row so the lane keeps the height of
    // the other two: three strips have to line up, or the board stops reading
    // as three columns.
    const tools = lane.createDiv({ cls: "q-done-tools" });
    const windows = tools.createDiv({ cls: "q-done-windows" });
    for (const option of DONE_WINDOWS) {
      const chip = windows.createEl("button", { cls: "q-chip", text: option === 0 ? "All" : `${option}d` });
      if (option === window) chip.addClass("is-on");
      chip.setAttr("title", option === 0 ? "Everything the board can see" : `Finished in the last ${option} days`);
      chip.addEventListener("click", () => this.host.setDoneWindow(option));
    }

    const bars = tools.createDiv({ cls: "q-done-bars" });
    bars.setAttr("title", "Finished per day, last 7 days");
    const days = doneByDay(this.host.done, today);
    const most = Math.max(1, ...days.map((entry) => entry.count));
    for (const entry of days) {
      const bar = bars.createSpan({ cls: "q-done-bar" });
      if (entry.count > 0) bar.addClass(`is-l${Math.max(1, Math.ceil((entry.count / most) * 4))}`);
      bar.setAttr("title", `${entry.day}: ${entry.count === 0 ? "nothing finished" : `${entry.count} finished`}`);
    }

    const list = lane.createDiv({ cls: "q-list" });
    if (tasks.length === 0) {
      list.createDiv({
        cls: "q-empty",
        text: window === 0 ? "Nothing finished in this vault yet." : "Nothing finished in that window.",
      });
    }
    for (const task of tasks) list.appendChild(this.doneEl(task));

    this.droppable(lane, (event) => this.dropDone(event));
  }

  /** A finished card: a pointer to its line, and nothing you can drag or place. */
  private doneEl(task: MatrixTask): HTMLElement {
    const el = document.createElement("div");
    el.addClass("q-task");
    el.addClass("is-done");
    el.dataset.path = task.path;
    el.dataset.line = String(task.line);
    el.setAttr("title", `${task.path}:${task.line + 1} — click to open at that line`);

    this.titleEl(el, task.title);

    const meta = el.createDiv({ cls: "q-task-meta" });
    const note = task.path.split("/").pop()?.replace(/\.md$/u, "") ?? task.path;
    meta.createSpan({ cls: "q-note", text: note });
    const when = task.completed === null ? "no date" : task.completed.slice(5);
    meta.createSpan({ cls: "q-done-date", text: when });
    if (task.priority !== null && task.priority !== "") {
      meta.createSpan({ cls: "q-priority", text: task.priority });
    }
    for (const tag of task.tags.slice(0, 3)) meta.createSpan({ cls: "q-tag", text: tag });

    el.addEventListener("click", () => {
      void Promise.resolve(this.host.openTask(task)).catch((error) => {
        console.error("[quadrant] could not open the task", error);
        new Notice(`Quadrant: could not open that task (${String(error)})`);
      });
    });
    return el;
  }

  /**
   * Reloads and says so while it does: a button that redraws the same board in
   * silence is a button you cannot tell from a broken one.
   */
  private async reload(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.host.refresh();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private lane(container: HTMLElement, cls: string, target: number, title: string, hint: string, tasks: MatrixTask[]): void {
    const lane = container.createDiv({ cls });
    lane.dataset.quadrant = String(target);

    const head = lane.createDiv({ cls: "q-lane-head" });
    head.createEl("h3", { text: title });
    head.createSpan({ cls: "q-lane-hint", text: hint });
    head.createSpan({ cls: "q-count", text: String(tasks.length) });

    const list = lane.createDiv({ cls: "q-list" });
    if (tasks.length === 0) {
      list.createDiv({
        cls: "q-empty",
        text: filterActive(this.host.filters) ? "Nothing matches the filter." : target === 0 ? "Everything is placed." : "Nothing here.",
      });
    }
    for (const task of tasks) list.appendChild(this.taskEl(task));

    this.droppable(lane, (event) => this.drop(event, target));
  }

  /**
   * Makes an element take a card: highlight while the card is over it, and run
   * `act` with the drop. A failed write is said out loud — the card would stay
   * where it was, and a drop that does nothing looks exactly like one that
   * worked.
   */
  private droppable(el: HTMLElement, act: (event: DragEvent) => Promise<void>): void {
    el.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
      el.addClass("is-over");
    });
    el.addEventListener("dragleave", (event) => {
      if (!el.contains(event.relatedTarget as Node | null)) el.removeClass("is-over");
    });
    el.addEventListener("drop", (event) => {
      event.preventDefault();
      el.removeClass("is-over");
      void act(event).catch((error) => {
        console.error("[quadrant] could not write the task", error);
        new Notice(`Quadrant: could not write that task (${String(error)})`);
      });
    });
  }

  /** The task the dragged card stands for, or `undefined` if it is not one of ours. */
  private dragged(event: DragEvent): MatrixTask | undefined {
    const raw = event.dataTransfer?.getData("text/plain") ?? "";
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return undefined;
    }
    return this.host.tasks.find(
      (candidate) => candidate.path === payload.path && candidate.line === payload.line,
    );
  }

  /** The card's title, with the note's bold and italics drawn rather than spelled. */
  private titleEl(parent: HTMLElement, title: string): HTMLElement {
    const el = parent.createDiv({ cls: "q-task-title" });
    for (const part of titleParts(title === "" ? "(untitled)" : title)) {
      const tags: string[] = [];
      if (part.bold === true) tags.push("strong");
      if (part.italic === true) tags.push("em");
      if (part.strike === true) tags.push("s");
      if (part.highlight === true) tags.push("mark");
      if (part.code === true) tags.push("code");
      if (tags.length === 0) {
        el.createSpan({ text: part.text });
        continue;
      }
      let node: HTMLElement = el;
      for (const tag of tags.slice(0, -1)) node = node.createEl(tag);
      node.createEl(tags[tags.length - 1], { text: part.text });
    }
    return el;
  }

  private taskEl(task: MatrixTask): HTMLElement {
    const el = document.createElement("div");
    el.addClass("q-task");
    el.draggable = true;
    el.dataset.path = task.path;
    el.dataset.line = String(task.line);
    if (task.scheduled !== null) el.dataset.scheduled = task.scheduled;
    if (task.priority !== null) el.dataset.priority = task.priority;
    el.setAttr("title", `${task.path}:${task.line + 1} — click to open at that line, drag to place it or to finish it`);

    this.titleEl(el, task.title);

    const meta = el.createDiv({ cls: "q-task-meta" });
    const note = task.path.split("/").pop()?.replace(/\.md$/u, "") ?? task.path;
    meta.createSpan({ cls: "q-note", text: note });
    if (task.scheduled !== null) meta.createSpan({ cls: "q-date", text: task.scheduled.slice(5) });
    if (task.priority !== null && task.priority !== "") {
      const priority = meta.createSpan({ cls: "q-priority", text: task.priority });
      priority.setAttr("title", `Priority ${task.priority}`);
    }
    if (task.indent > 0) meta.createSpan({ cls: "q-subtask", text: "subtask" });
    for (const tag of task.tags.slice(0, 4)) meta.createSpan({ cls: "q-tag", text: tag });

    el.addEventListener("dragstart", (event) => {
      const payload: DragPayload = { path: task.path, line: task.line };
      event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
      if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
      el.addClass("is-dragging");
    });
    el.addEventListener("dragend", () => el.removeClass("is-dragging"));
    el.addEventListener("click", () => {
      // A card that opens nothing and says nothing is the worst outcome; the
      // dialog only closes once the note is really on screen.
      void Promise.resolve(this.host.openTask(task)).then(this.afterOpen, (error) => {
        console.error("[quadrant] could not open the task", error);
        new Notice(`Quadrant: could not open that task (${String(error)})`);
      });
    });
    return el;
  }

  private async drop(event: DragEvent, target: number): Promise<void> {
    const task = this.dragged(event);
    if (task === undefined) return;
    await this.host.move(task, target);
  }

  /** The Done lane's drop: not a place, a conclusion. It ticks the line. */
  private async dropDone(event: DragEvent): Promise<void> {
    const task = this.dragged(event);
    if (task === undefined) return;
    await this.host.finish(task);
  }
}

/** The board in a tab of its own. */
export class MatrixView extends ItemView implements MatrixSurface {
  private board: Board | null = null;

  constructor(leaf: WorkspaceLeaf, private host: MatrixHost) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Quadrant"; }
  getIcon(): string { return "layout-grid"; }

  async onOpen(): Promise<void> {
    try {
      this.contentEl.addClass("q-root");
      this.board = new Board(this.contentEl, this.host);
      this.host.attach(this);
      this.render();
      await this.host.refresh();
    } catch (error) {
      console.error("[quadrant] the view could not be mounted", error);
      new Notice(`Quadrant: the tab could not be mounted (${String(error)}). Use "Open the matrix in a dialog" instead.`);
    }
  }

  async onClose(): Promise<void> {
    this.host.forget(this);
    this.contentEl.empty();
  }

  render(): void { this.board?.render(); }
}

/**
 * The same board, in a dialog. It closes itself once you have clicked a task:
 * a note opened under a dialog is a note you still cannot see, so the dialog
 * gets out of the way instead of staying on top of the thing you asked for.
 */
export class BoardModal extends Modal implements MatrixSurface {
  private board: Board | null = null;

  constructor(app: App, private host: MatrixHost) {
    super(app);
  }

  onOpen(): void {
    try {
      this.contentEl.addClass("q-modal");
      this.board = new Board(this.contentEl, this.host, () => this.close());
      this.host.attach(this);
      this.render();
      void this.host.refresh();
    } catch (error) {
      console.error("[quadrant] the dialog could not be opened", error);
      new Notice(`Quadrant: the dialog could not be opened (${String(error)})`);
    }
  }

  onClose(): void {
    this.host.forget(this);
    this.contentEl.empty();
  }

  render(): void { this.board?.render(); }
}
