/**
 * A minimal stand-in for the `obsidian` module: just the API this plugin
 * touches. The real one is provided by the app at runtime and marked external
 * in the build, so nothing here ships.
 */

interface DomElementInfo {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string>;
  title?: string;
}

interface HTMLElement {
  empty(): void;
  createEl(tag: string, options?: DomElementInfo): HTMLElement;
  createDiv(options?: DomElementInfo): HTMLDivElement;
  createSpan(options?: DomElementInfo): HTMLSpanElement;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  addClass(...classes: string[]): void;
  removeClass(...classes: string[]): void;
  toggleClass(cls: string, value: boolean): void;
  hasClass(cls: string): boolean;
}

declare module "obsidian" {
  export class App {
    vault: Vault;
    workspace: Workspace;
  }

  export class Vault {
    getMarkdownFiles(): TFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    read(file: TFile): Promise<string>;
    cachedRead(file: TFile): Promise<string>;
    process(file: TFile, fn: (data: string) => string): Promise<string>;
    modify(file: TFile, data: string): Promise<void>;
    create(path: string, data: string): Promise<TFile>;
    createFolder(path: string): Promise<TAbstractFile>;
    on(event: "modify" | "create" | "delete", callback: (file: TAbstractFile) => unknown): unknown;
  }

  export class TAbstractFile {
    path: string;
    name: string;
  }

  export class TFile extends TAbstractFile {
    basename: string;
    extension: string;
  }

  export class Workspace {
    getLeavesOfType(type: string): WorkspaceLeaf[];
    getLeaf(createNew?: boolean | "tab" | "split", direction?: "vertical" | "horizontal"): WorkspaceLeaf;
    /** The right sidebar's leaf; `split` forces a new one instead of reusing it. */
    getRightLeaf(split: boolean): WorkspaceLeaf | null;
    revealLeaf(leaf: WorkspaceLeaf): void;
    onLayoutReady(callback: () => unknown): void;
  }

  export class WorkspaceLeaf {
    view: View;
    setViewState(state: { type: string; active?: boolean }): Promise<void>;
    /** `eState.line` is the line the editor should put its cursor on. */
    openFile(file: TFile, options?: { eState?: { line?: number } }): Promise<void>;
  }

  /** The context a markdown post-processor gets: where the block lives, and what to unload with it. */
  export class MarkdownPostProcessorContext {
    sourcePath: string;
    addChild(child: MarkdownRenderChild): void;
  }

  /** A piece of rendered markdown with a lifetime of its own. */
  export class MarkdownRenderChild {
    constructor(containerEl: HTMLElement);
    containerEl: HTMLElement;
    onunload(): void;
  }

  export class View {
    app: App;
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    getViewType(): string;
  }

  export class ItemView extends View {
    constructor(leaf: WorkspaceLeaf);
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
  }

  export class Plugin {
    constructor(app: App, manifest?: unknown);
    app: App;
    addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement;
    addCommand(command: { id: string; name: string; callback: () => unknown }): void;
    addSettingTab(tab: PluginSettingTab): void;
    registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void;
    registerMarkdownCodeBlockProcessor(
      language: string,
      handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>,
    ): void;
    registerEvent(eventRef: unknown): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
  }

  export class PluginSettingTab {
    constructor(app: App, plugin: Plugin);
    containerEl: HTMLElement;
    display(): void;
  }

  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(description: string): this;
    addText(callback: (component: TextComponent) => unknown): this;
    addTextArea(callback: (component: TextAreaComponent) => unknown): this;
    addToggle(callback: (component: ToggleComponent) => unknown): this;
    addDropdown(callback: (component: DropdownComponent) => unknown): this;
  }

  export class TextComponent {
    setValue(value: string): this;
    setPlaceholder(value: string): this;
    onChange(callback: (value: string) => void | Promise<void>): this;
  }

  export class TextAreaComponent {
    setValue(value: string): this;
    setPlaceholder(value: string): this;
    onChange(callback: (value: string) => void | Promise<void>): this;
  }

  export class ToggleComponent {
    setValue(value: boolean): this;
    onChange(callback: (value: boolean) => void | Promise<void>): this;
  }

  export class DropdownComponent {
    addOption(value: string, display: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => void | Promise<void>): this;
  }

  export class ButtonComponent {
    setButtonText(text: string): this;
    setCta(): this;
    setTooltip(text: string): this;
    onClick(callback: () => unknown): this;
  }

  export class Modal {
    constructor(app: App);
    app: App;
    containerEl: HTMLElement;
    modalEl: HTMLElement;
    titleEl: HTMLElement;
    contentEl: HTMLElement;
    open(): void;
    close(): void;
    onOpen?(): void;
    onClose?(): void;
  }

  export class Notice {
    constructor(message: string, timeout?: number);
  }
}
