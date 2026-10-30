# Quadrant

**Author:** [T. Bautista](https://github.com/aknari)

An Eisenhower matrix for Obsidian. The repository is `obsidian-quadrant`; the plugin is **Quadrant**, and its id is `quadrant` — so it installs into `.obsidian/plugins/quadrant/`. *Eisenhower matrix*, *quadrant* or *obsidian-quadrant* all lead here.

It works over the tasks that already live in your vault. No board note, no links, no copy of a task: the board is read from the Markdown lines, and moving a card rewrites the one line it came from.

Plain `#task` lines are all it needs. If you also run [Operon](https://github.com/hasanyilmaz/operon), its tasks are recognised by their `{{operonId:: …}}`, they sit on the same board, and a drop writes Operon's own `{{status:: …}}` instead of a bare checkbox.

## Installation

Quadrant is not in Obsidian's community plugin list. Obsidian **1.5.0 or newer**.

**From a release (recommended).** Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest), put them in `<vault>/.obsidian/plugins/quadrant/`, then enable **Quadrant** under *Settings → Community plugins*.

**BRAT.** Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run **BRAT: Add a beta plugin for testing** and enter `aknari/obsidian-quadrant`; updates follow the releases.

**From source.** `npm install && npm run build`, then copy `dist/main.js`, `manifest.json` and `styles.css` into that folder — see [Build](#build).

## What it does

- **Four quadrants, an inbox and a dropped lane.** Pending tasks with no quadrant wait in *Unclassified*; tasks you have given up on sit in *Dropped*, out of the way but still visible.
- **Both kinds of task.** Operon tasks (recognised by their `{{operonId:: ...}}`) and plain `#task` lines, side by side, each card showing its note, its day and its Operon priority.
- **One field per drop.** A quadrant writes `[eisenhower:: 1]` … `[eisenhower:: 4]` on the line, replaced in place if it is already there. Dropping writes Operon's own `{{status:: Project.Dropped}}` for an Operon task, and `[eisenhower:: 5]` for a plain one.
- **Nothing else is touched.** Operon's `{{priority::}}` stays exactly as you set it; it only decides the order inside a lane (S, A, B, C, then the rest).
- **Safe writes.** The line is checked against the one the board was drawn from before anything is written. If the note changed underneath, the write is skipped and the board is redrawn — no stale edit lands on the wrong line.
- **A Done strip, as a record.** What you have finished lately, newest first, with the day on each card and seven marks for the last week. Drop a card on it and that task is finished today. The filters above do not apply to it.

The four cells carry their meaning under the name — *urgent · important* and so on — rather than drawn Urgent / Important axes, and the third one is **Quick pass**, not *Delegate*: these are your tasks, and handing one to someone else is a note you add, not a drawer the board decides for you.

**Filters** narrow what is on the board without changing anything: *Overdue*, *Next 7 days*, *Priority S/A* (Operon's two top priorities), and they add up. They live in the plugin, so they survive closing the board and every surface shows the same narrowing. The header says how much of the board you are seeing (`7 of 23 live`) and when it was last read, so **Refresh** is never a button you cannot tell from a broken one.

| Lane | Drop writes |
| --- | --- |
| Do now / Schedule / Quick pass / Some day | `[eisenhower:: 1..4]` |
| Dropped — Operon task | `{{status:: Project.Dropped}}` |
| Dropped — plain task | `- [-]` and `[eisenhower:: 5]` |
| Unclassified — Operon task that was dropped | back to `{{status:: Project.Planned}}` |
| Unclassified — plain task | `- [ ]` again, and the field is removed |
| Done — plain task | `- [x]` and `✅ today` |
| Done — Operon task | `- [x]`, `{{status:: Project.Finished}}` and `{{dateCompleted:: today}}` |

## Where the board lives

The board is a projection, so the same one can be shown in four places. Only the container differs.

**The right sidebar** — what the ribbon icon (*layout-grid*) opens. It sits *beside* the note instead of over it, Obsidian remembers its width and its place across restarts, and you can drag it wherever you like or collapse it. In a narrow panel the four cells stack in one column and the board scrolls; in a wide one it goes back to 2×2. This is the placement to live in. If the board is already open, that one is revealed instead of a second one being built.

**A tab** — command **Quadrant: Open the matrix in a tab**, for when you want it wide. A tab means a tab: if a tab already holds the board it is revealed, and if the board is only in the sidebar a tab is created — a command that says *tab* and quietly does nothing would be worse than one that opens.

**A dialog** — command **Quadrant: Open the matrix in a dialog**. It behaves like a dialog should and gets out of the way: click a task and it closes itself, because a note opened underneath a dialog is a note you still cannot see.

**Inside a note** — a fenced code block:

````
```quadrant
```
````

The note holds the block and nothing else; the board is drawn into it. No setting names the note, because the note names itself by containing the block: put it in your home note and it is the first thing you see, put it in a project note and it is there. Nothing is generated and nothing is rewritten — a note the plugin filled with tasks would be a second copy that goes stale, and the tasks would stop being only in their lines.

Rendering is at its best in reading view (`Ctrl+E`): in live preview the block draws only while the cursor is outside it, and dragging inside an editor competes with the editor.

## What you have finished

The third strip at the bottom is **Done**. It is not a fifth quadrant, and a card lands there when its line says it is finished — either because you wrote that in the note, or because you dropped the card on the strip and the board wrote it for you.

**Finishing by dropping.** Drag any live card onto the strip and that task is finished today: a plain line is ticked and stamped `✅ today`, an Operon line is ticked and given `{{status:: Project.Finished}}` with `{{dateCompleted:: today}}`. Each notation gets what it already reads and nothing else is added. The quadrant is left on the line, so unticking it in the note puts the task back in its cell instead of back in the inbox, and Operon's `{{datetimeModified::}}` is not touched — that timestamp is Operon's to write.

**How a line counts as finished.** A plain task when its box is ticked; an Operon task when its status is `Project.Finished`, because that is what Operon itself reads — a ticked box still saying `Project.Planned` is work whose status has not caught up. Done and live never overlap, so every task is on exactly one side of the board.

**Where the date comes from.** The line itself: the `✅ 2026-10-29` stamp the Tasks plugin writes, or Operon's `{{dateCompleted:: …}}`. Nothing is invented — a ticked box with no date appears under *All* and in no window, because there is no day to put it in.

**Three windows**, as chips in the strip's own header: `7d`, `30d`, `All`. The choice is saved with the plugin's settings, and switching it does not re-read the vault — the finished tasks are already in hand, only the narrowing changes. *All* is not all of history: it is everything the folder settings let the board see, and since the daily-note archive is excluded and the journal keeps only its last fifteen notes, that stays a small list.

**The seven marks** are the last week, one bar per day, ending today. Their height is that day's count relative to the busiest day of the week, so a quiet week still reads as a shape; the header's `N done today` is the same number for today. Both are the point of the strip: the list answers *what*, the marks answer *how much*.

**A finished card** still points at its line — click it and you land there — but it cannot be dragged, and the *Overdue* / *Next 7 days* / *Priority* filters leave it alone: those are questions about work left, and a finished task is never late in a way worth showing.

## Clicking a task

A card is a pointer to exactly one line, so a click opens that note **at that line**, not at the top of it. Titles on the cards carry the path and the line number (`10-journal/daily notes/2026-10-28.md:42`) so you can see where a task comes from without leaving the board.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Task tag | `#task` | A plain task is shown when it carries this tag. Operon tasks never need it. Empty = any pending line. |
| Folders for plain tasks | `10-journal/daily notes` | One folder per line. Plain tasks are read only from here (plus anywhere, once they have a quadrant). This is what keeps task-syntax examples, checklists inside notes and old lists off the board. Empty = no limit. |
| Excluded folders | `10-journal/archive`, `80-support/templates` | One folder per line. Nothing inside them is read at all: archives hold finished work, templates hold placeholders. |
| Done window | `7` | How far back the Done strip looks: `7`, `30`, or `0` for everything. Set from the chips in the strip, not here; it is saved with the rest. |

## The field is still `eisenhower`

The plugin is called Quadrant, but the field it writes is `[eisenhower:: n]`: it names the method, not the plugin, and it is already written on every line the board has placed. Renaming it would send every placed task back to *Unclassified*.

## What it does not do

- It does not create tasks, dates or durations; it places the ones you have.
- It does not rewrite Operon's priority, and it does not move a task to another note.
- It does not delete anything: a dropped task stays in its note, and the daily-note consolidation sees a plain dropped task exactly like any other cancelled line.
- It does not move a finished task anywhere, and it does not tick a task you have not dropped: the Done strip reads what your notes already say, plus the one line you dropped on it.
- It does not count work done outside task lines — sessions in the time ruler, or days with no ticked box, are not in the bars.

## Build

```sh
npm install
npm run typecheck
npm test
npm run deploy          # or OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/quadrant npm run deploy
```
