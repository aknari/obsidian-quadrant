/**
 * Quadrant — an Eisenhower matrix over the tasks that already live in the vault.
 *
 * The plugin holds no task list of its own. Every draw reads the Markdown
 * lines, and every drop rewrites the one line that was dragged: the quadrant
 * is a field on that line, and for an Operon task the dropped lane is Operon's
 * own `{{status:: Project.Dropped}}`. Nothing is copied, linked or moved.
 *
 * The board is a projection, so it can be shown in more than one place at once
 * and all of them say the same thing: the right sidebar (the default), a tab,
 * a dialog, or a `quadrant` code block inside a note. Only the container
 * differs — `Board` takes one and draws.
 */

import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  DONE_WINDOWS,
  NO_FILTER,
  applyFinish,
  applyMove,
  archiveBlock,
  isDone,
  monthOf,
  planArchive,
  plainTaskVisible,
  scanNote,
  taskKey,
  todayOf,
  tombstone,
  toggleCondition,
  type ArchiveCandidate,
  type ArchivePlan,
  type DoneWindow,
  type MatrixFilter,
  type MatrixTask,
  type NoteText,
} from "./model";
import {
  ArchiveModal,
  BLOCK_LANGUAGE,
  Board,
  BoardModal,
  MatrixView,
  VIEW_TYPE,
  type MatrixHost,
  type MatrixSurface,
} from "./view";

/** What a write did: nothing changed, it landed, or the line moved underneath. */
type WriteResult = "written" | "unchanged" | "stale";

/** Where the ribbon icon puts the board. */
type BoardPlacement = "sidebar" | "tab" | "dialog";

/** The three placements, with the name each one goes by in the settings. */
const PLACEMENTS: ReadonlyArray<readonly [BoardPlacement, string]> = [
  ["sidebar", "Right sidebar"],
  ["tab", "Tab in the main area"],
  ["dialog", "Dialog over the note"],
];

interface QuadrantSettings {
  /** The tag a plain task line must carry to be shown (empty = any pending line). */
  taskTag: string;
  /** One folder per line; only plain tasks inside them are shown (empty = no limit). */
  plainTaskFolders: string;
  /** One folder per line; nothing inside them is read. */
  excludedFolders: string;
  /** How far back the Done strip looks: 7, 30, or 0 for everything. */
  doneWindow: DoneWindow;
  /** Where archived lines go, one file per month. */
  archiveFolder: string;
  /** How many days a finished line has to be old before it may move. */
  archiveDays: number;
  /** Where the ribbon icon opens the board. */
  openIn: BoardPlacement;
}

const DEFAULT_SETTINGS: QuadrantSettings = {
  taskTag: "#task",
  plainTaskFolders: "10-journal/daily notes",
  excludedFolders: "10-journal/archive\n80-support/templates",
  doneWindow: 7,
  openIn: "sidebar",
  archiveFolder: "10-journal/archive/tareas",
  archiveDays: 30,
};

const REFRESH_DELAY = 1200;

export default class QuadrantPlugin extends Plugin implements MatrixHost {
  settings: QuadrantSettings = { ...DEFAULT_SETTINGS };
  tasks: MatrixTask[] = [];
  /** Every finished task the folder settings let through, at any date. */
  done: MatrixTask[] = [];
  lastLoaded: Date | null = null;
  /**
   * The filters live here, not in `Board`: closing the board must not forget
   * what you were looking at, and a note holding the board has to narrow the
   * same way the sidebar does.
   */
  filters: MatrixFilter = { ...NO_FILTER };

  /** The Done window is stored as a setting, but the board reads it like the filters. */
  get doneWindow(): DoneWindow {
    return this.settings.doneWindow;
  }

  private surfaces = new Set<MatrixSurface>();
  /** The leaf the ribbon put the board in, so “open in a tab” means a tab. */
  private sidebarLeaf: WorkspaceLeaf | null = null;
  private timer: number | null = null;
  private scanning = false;
  private queued = false;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // A `data.json` edited by hand can say anything; a window that is not one
    // of the three would leave the lane unfiltered without saying so.
    if (!DONE_WINDOWS.includes(this.settings.doneWindow)) this.settings.doneWindow = DEFAULT_SETTINGS.doneWindow;
    if (!PLACEMENTS.some(([value]) => value === this.settings.openIn)) this.settings.openIn = DEFAULT_SETTINGS.openIn;
    this.registerView(VIEW_TYPE, (leaf) => new MatrixView(leaf, this));
    this.registerBlock();

    // The ribbon opens the board wherever the settings say. The sidebar is the
    // default — it sits beside the note instead of over it, Obsidian remembers
    // its width and its place, and clicking a task then opens that note where
    // you can see both — but when the board is the thing you are looking at, a
    // tab in the main area is the honest place for it.
    this.addRibbonIcon("layout-grid", "Quadrant", () => { void this.openFromRibbon(); });
    this.addCommand({ id: "open-sidebar", name: "Open the matrix in the right sidebar", callback: () => { void this.openSidebar(); } });
    this.addCommand({ id: "open-tab", name: "Open the matrix in a tab", callback: () => { void this.openTab(); } });
    this.addCommand({ id: "open-dialog", name: "Open the matrix in a dialog", callback: () => { this.openDialog(); } });
    this.addCommand({ id: "refresh", name: "Refresh the matrix", callback: () => { void this.refresh(); } });
    this.addCommand({ id: "archive", name: "Archive finished and dropped tasks...", callback: () => { void this.archiveOldTasks(); } });
    this.addSettingTab(new QuadrantSettingsTab(this));
    this.registerEvent(this.app.vault.on("modify", () => { this.schedule(); }));
  }

  /**
   * The board inside a note: a fenced code block, and nothing else in the file.
   *
   * Deliberately *not* a generated note. The plugin's one guarantee is that a
   * task lives in its line and nowhere else, and a note the plugin rewrote with
   * the tasks in it would be a second copy that goes stale between redraws.
   * The fence is a placeholder; the tasks stay where they are, and Obsidian
   * redraws the block whenever the note is shown.
   */
  private registerBlock(): void {
    this.registerMarkdownCodeBlockProcessor(
      BLOCK_LANGUAGE,
      (_source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        el.addClass("q-inline");
        const board = new Board(el, this);
        const child = new MarkdownRenderChild(el);
        child.onunload = () => {
          this.forget(board);
          el.empty();
        };
        ctx.addChild(child);
        this.attach(board);
        board.render();
      },
    );
  }

  /**
   * The ribbon's one question, answered by the settings: which of the three
   * placements. A dialog is the only one that cannot be revealed, so it is the
   * only one that opens a new board every time.
   */
  async openFromRibbon(): Promise<void> {
    if (this.settings.openIn === "tab") return this.openTab();
    if (this.settings.openIn === "dialog") {
      this.openDialog();
      return;
    }
    await this.openSidebar();
  }

  /**
   * Shows the board in the sidebar, creating it the first time. If the board is
   * already somewhere — the sidebar from a past session, a tab, a split — that
   * leaf is revealed instead of a second board being built next to it.
   */
  async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing !== undefined) {
      this.reveal(existing);
      await this.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(true);
    if (leaf === null) {
      this.openDialog();
      return;
    }
    this.sidebarLeaf = leaf;
    await this.mount(leaf, "the sidebar");
  }

  /**
   * The board in a tab of its own, for when you want it wide. A tab means a
   * tab: the sidebar's own board is not reused for it, or the command would
   * silently do nothing while the board is open in the narrow place.
   */
  async openTab(): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .find((leaf) => leaf !== this.sidebarLeaf);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await this.mount(leaf, "the tab");
  }

  /** The board in a dialog: nothing to register, nothing to mount. */
  openDialog(): void {
    new BoardModal(this.app, this).open();
  }

  /**
   * Mounts the view and checks that it really is the view: a ribbon button that
   * does nothing is the hardest kind of bug to report, so every failure lands
   * on screen and the board still gets shown.
   */
  private async mount(leaf: WorkspaceLeaf, where: string): Promise<void> {
    try {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.reveal(leaf);
      if (leaf.view.getViewType() !== VIEW_TYPE) throw new Error(`the view opened as ${leaf.view.getViewType()}`);
      await this.refresh();
    } catch (error) {
      console.error(`[quadrant] could not open ${where}, showing the dialog instead`, error);
      new Notice(`Quadrant: ${where} could not be opened (${String(error)}), showing the dialog instead.`);
      this.openDialog();
    }
  }

  /** Revealing can fail on a collapsed sidebar; the board is already there. */
  private reveal(leaf: WorkspaceLeaf): void {
    try {
      this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.error("[quadrant] could not reveal the board", error);
    }
  }

  /** A note changed: redraw once the writing has settled. */
  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, REFRESH_DELAY);
  }

  /** Re-reads the vault and redraws. The board is a projection, so this is cheap. */
  async refresh(): Promise<void> {
    if (this.scanning) {
      this.queued = true;
      return;
    }
    this.scanning = true;
    try {
      const scan = await this.collect();
      this.tasks = scan.live;
      this.done = scan.done;
      this.lastLoaded = new Date();
    } catch (error) {
      console.error("[quadrant] could not read the vault", error);
      new Notice(`Quadrant: could not read the vault (${String(error)})`);
    } finally {
      this.scanning = false;
    }
    this.redraw();
    if (this.queued) {
      this.queued = false;
      await this.refresh();
    }
  }

  redraw(): void {
    for (const surface of this.surfaces) surface.render();
  }

  toggleFilter(key: keyof MatrixFilter): void {
    this.filters = toggleCondition(this.filters, key);
    this.redraw();
  }

  /**
   * The Done window is a preference, so it outlives the session — but changing
   * it is not a reason to re-read the vault: the finished tasks are already in
   * hand, and only the narrowing changes.
   */
  setDoneWindow(window: DoneWindow): void {
    if (this.settings.doneWindow === window) return;
    this.settings.doneWindow = window;
    void this.saveData(this.settings);
    this.redraw();
  }

  clearFilters(): void {
    this.filters = { ...NO_FILTER };
    this.redraw();
  }

  attach(surface: MatrixSurface): void {
    this.surfaces.add(surface);
  }

  forget(surface: MatrixSurface): void {
    this.surfaces.delete(surface);
  }

  private folders(value: string): string[] {
    return value
      .split("\n")
      .map((line) => line.trim().replace(/\/+$/u, ""))
      .filter((line) => line !== "");
  }

  /**
   * One pass over the vault, two answers: what is still to do and what is
   * already done. They are read together because they come from the same lines
   * — splitting the walk in two would read every note twice for no reason —
   * and they are kept apart because they are two different questions.
   */
  private async collect(): Promise<{ live: MatrixTask[]; done: MatrixTask[] }> {
    const excluded = this.folders(this.settings.excludedFolders);
    const plainFolders = this.folders(this.settings.plainTaskFolders);
    const live: MatrixTask[] = [];
    const done: MatrixTask[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (excluded.some((folder) => file.path === folder || file.path.startsWith(`${folder}/`))) continue;
      const content = await this.app.vault.cachedRead(file);
      for (const task of scanNote(content, file.path, { taskTag: this.settings.taskTag, includeDone: true })) {
        if (!plainTaskVisible(task, plainFolders)) continue;
        if (isDone(task)) done.push(task);
        else live.push(task);
      }
    }
    return { live, done };
  }

  /**
   * Rewrites one line of a note, after checking that it is still the line the
   * board was drawn from. A note edited underneath the board would otherwise
   * take the change on a line that no longer holds that task.
   */
  private async rewrite(task: MatrixTask, change: (raw: string) => string): Promise<WriteResult> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return "stale";
    let result: WriteResult = "unchanged";
    await this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const current = lines[task.line];
      if (current === undefined || taskKey(current) !== taskKey(task.raw)) return content;
      const next = change(current);
      if (next === current) return content;
      lines[task.line] = next;
      result = "written";
      return lines.join("\n");
    });
    return result;
  }

  /** Rewrites the single line of a dropped task. */
  async move(task: MatrixTask, target: number): Promise<void> {
    const result = await this.rewrite(task, (raw) => applyMove(raw, target));
    if (result === "stale") new Notice("That line changed since the board was drawn; nothing was written.");
    await this.refresh();
  }

  /**
   * Finishes a task: the one write the Done lane does, and it does it by
   * ticking the line the way the vault already ticks one, not by moving it.
   * The board then reads the new line like any other, so the card leaves its
   * quadrant and appears in Done with today's date — and unticking it in the
   * note puts it back where it was, because the quadrant was never removed.
   */
  async finish(task: MatrixTask): Promise<void> {
    const day = todayOf();
    const result = await this.rewrite(task, (raw) => applyFinish(raw, day));
    if (result === "stale") new Notice("That line changed since the board was drawn; nothing was written.");
    await this.refresh();
  }

  /**
   * Goes to a task: its note, at its line. The line matters — a card is a
   * pointer to one line, and landing at the top of the note means finding the
   * task again by hand, which is the work the board was meant to save.
   */
  async openTask(task: MatrixTask): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { eState: { line: task.line } });
  }

  /** The file the archive goes to: one per month, inside the configured folder. */
  private archivePath(month: string): string {
    const folder = this.settings.archiveFolder.trim().replace(/^\/+|\/+$/gu, "");
    return folder === "" ? `${month}.md` : `${folder}/${month}.md`;
  }

  /** What the archive job would move, read with the same rules the board reads by. */
  private async collectArchivePlan(): Promise<ArchivePlan> {
    const excluded = this.folders(this.settings.excludedFolders);
    const notes: NoteText[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (excluded.some((folder) => file.path === folder || file.path.startsWith(`${folder}/`))) continue;
      notes.push({ path: file.path, content: await this.app.vault.cachedRead(file) });
    }
    return planArchive(notes, {
      taskTag: this.settings.taskTag,
      folders: this.folders(this.settings.plainTaskFolders),
      today: todayOf(),
      days: this.settings.archiveDays,
    });
  }

  /**
   * The command: read, say what would move, and only then move it. A job that
   * rewrites several notes is not something to do behind the user's back, and
   * archiving is the only thing this plugin does that takes a line away.
   */
  async archiveOldTasks(): Promise<void> {
    const plan = await this.collectArchivePlan();
    if (plan.moving.length === 0) {
      new Notice("Quadrant: nothing is old enough to archive.");
      return;
    }
    const month = monthOf(todayOf());
    new ArchiveModal(this.app, plan, this.archivePath(month), () => { void this.runArchive(plan); }).open();
  }

  /**
   * The archive is written first, then the notes: if this stops halfway, the
   * line exists twice — where it was and in the archive — which can be seen and
   * undone, instead of once and gone.
   */
  private async runArchive(plan: ArchivePlan): Promise<void> {
    const month = monthOf(todayOf());
    const path = this.archivePath(month);
    try {
      await this.appendArchive(path, month, plan.moving);
    } catch (error) {
      console.error("[quadrant] could not write the archive", error);
      new Notice(`Quadrant: the archive could not be written (${String(error)}); nothing was moved.`);
      return;
    }

    let moved = 0;
    let left = 0;
    for (const rewrite of plan.rewrites) {
      const chosen = plan.moving.filter((item) => item.path === rewrite.path);
      const file = this.app.vault.getAbstractFileByPath(rewrite.path);
      if (!(file instanceof TFile)) {
        left += chosen.length;
        continue;
      }
      try {
        await this.app.vault.process(file, (content) => {
          const lines = content.split("\n");
          for (const item of chosen) {
            // The note may have moved on since it was read: a tombstone goes on
            // the line that still holds that task, and on no other.
            if (lines[item.line] !== item.raw) {
              left += 1;
              continue;
            }
            lines[item.line] = tombstone(item.raw);
            moved += 1;
          }
          return lines.join("\n");
        });
      } catch (error) {
        console.error(`[quadrant] could not rewrite ${rewrite.path}`, error);
        left += chosen.length;
      }
    }

    const where = path.replace(/\.md$/u, "");
    const also = left > 0 ? `, ${left} left alone (that note changed since the board was drawn)` : "";
    new Notice(moved === 1 ? `Quadrant: 1 task archived to ${where}${also}.` : `Quadrant: ${moved} tasks archived to ${where}${also}.`);
    await this.refresh();
  }

  /** Appends the month's block, creating the folder and the file the first time. */
  private async appendArchive(path: string, month: string, moving: ArchiveCandidate[]): Promise<void> {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder !== "" && this.app.vault.getAbstractFileByPath(folder) === null) {
      await this.app.vault.createFolder(folder);
    }
    const block = archiveBlock(moving);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => `${content.trimEnd()}\n\n${block}\n`);
      return;
    }
    await this.app.vault.create(path, `# Tareas archivadas — ${month}\n\n${block}\n`);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refresh();
  }
}

class QuadrantSettingsTab extends PluginSettingTab {
  constructor(private plugin: QuadrantPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Quadrant" });

    new Setting(containerEl)
      .setName("Task tag")
      .setDesc("Plain tasks carrying this tag are shown (e.g. #task). Operon tasks are always shown, whatever the tag. Leave empty to show any pending line, tagged or not.")
      .addText((text) => text
        .setPlaceholder("#task")
        .setValue(this.plugin.settings.taskTag)
        .onChange(async (value) => {
          this.plugin.settings.taskTag = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Folders for plain tasks")
      .setDesc("One folder per line. A plain task is shown when it lives in one of them, and always once it has a quadrant. This is what keeps the board free of task-syntax examples, checklists inside notes and old lists. Operon tasks are not affected: their id is enough. Leave empty for no limit.")
      .addTextArea((text) => text
        .setPlaceholder("10-journal/daily notes")
        .setValue(this.plugin.settings.plainTaskFolders)
        .onChange(async (value) => {
          this.plugin.settings.plainTaskFolders = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("One folder per line. Nothing inside them is read: archives and templates hold old or placeholder tasks, not work to place.")
      .addTextArea((text) => text
        .setPlaceholder("10-journal/archive")
        .setValue(this.plugin.settings.excludedFolders)
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The Done strip shows what is already finished, newest first, with the day on each card. A plain task counts as done when its box is ticked; an Operon task when its status is Project.Finished. The dates come from the line itself — the ✅ stamp or Operon's dateCompleted — so a ticked box with no date appears under All and nowhere else. A finished card cannot be dragged, but dropping a live card on the lane finishes it today: it is ticked and stamped, or given Operon's status and dateCompleted. Nothing is moved.",
    });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Dropping a task in a quadrant writes [eisenhower:: 1] … [eisenhower:: 4] on its line. Dropping it in Dropped writes Operon's {{status:: Project.Dropped}} when the task is Operon's, and '- [-]' plus [eisenhower:: 5] when it is a plain task. Bringing a dropped task back sets Operon's status to Project.Planned, or the checkbox back to '- [ ]'. Operon's {{priority::}} is never touched, and the quadrant stays on a line finished through the Done lane.",
    });

    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Where archived tasks go, one file per month (2026-11.md and so on). Keep it inside one of the excluded folders above: the archive is a record, not work to place, and the board must not read it back.")
      .addText((text) => text
        .setPlaceholder("10-journal/archive/tareas")
        .setValue(this.plugin.settings.archiveFolder)
        .onChange(async (value) => {
          this.plugin.settings.archiveFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Archive after")
      .setDesc("Days a line has to be old before the archive command may move it. A finished task is judged by the day it was finished; a dropped one by its ➕ date, and one with neither is never moved — the command says how many it left behind and why.")
      .addText((text) => text
        .setPlaceholder("30")
        .setValue(String(this.plugin.settings.archiveDays))
        .onChange(async (value) => {
          const days = Number(value.trim());
          this.plugin.settings.archiveDays = Number.isInteger(days) && days > 0 ? Math.min(days, 3650) : DEFAULT_SETTINGS.archiveDays;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Archiving moves a line: the task travels to the month's file exactly as it was, under the note it came from, and the note keeps a '- [>]' tombstone where the line stood — the mark the daily notes already use for work that moved on. Nothing is deleted, no Operon task takes part (its status is Operon's), and the command asks before it writes.",
    });

    new Setting(containerEl)
      .setName("The ribbon opens the board in")
      .setDesc("Where the ribbon icon puts the board. The commands for the sidebar, a tab and a dialog are always there, whatever this says, so this only decides which one the icon opens.")
      .addDropdown((menu) => {
        for (const [value, label] of PLACEMENTS) menu.addOption(value, label);
        menu.setValue(this.plugin.settings.openIn);
        menu.onChange(async (value) => {
          this.plugin.settings.openIn = value as BoardPlacement;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The ribbon opens the board where the setting above says, and the commands for the sidebar, a tab and a dialog are there whatever it says. To keep it in a note, write a fenced block that starts with \"quadrant\" — the note holds the block, never a copy of the tasks.",
    });
  }
}
