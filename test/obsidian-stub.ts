/**
 * An Obsidian double: just enough of the app for `Quadrant` to load, draw and
 * be clicked, without Chrome and without the vault.
 */

export class FakeEl {
  tagName: string;
  classes = new Set<string>();
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, Array<(event: any) => void>> = {};
  text = "";
  parent: FakeEl | null = null;
  draggable = false;

  constructor(tag = "div") {
    this.tagName = tag;
  }

  get classList() {
    return {
      add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
      contains: (name: string) => this.classes.has(name),
    };
  }

  private apply(options?: any): void {
    if (!options) return;
    if (typeof options.text === "string") this.text = options.text;
    if (typeof options.cls === "string") options.cls.split(/\s+/).filter(Boolean).forEach((c: string) => this.classes.add(c));
    if (Array.isArray(options.cls)) options.cls.forEach((c: string) => this.classes.add(c));
    if (options.attr) Object.assign(this.attrs, options.attr);
    if (options.title) this.attrs.title = options.title;
  }

  empty(): void {
    this.children = [];
    this.text = "";
  }

  createDiv(options?: any): FakeEl {
    const el = new FakeEl("div");
    el.apply(options);
    this.appendChild(el);
    return el;
  }

  createEl(tag: string, options?: any): FakeEl {
    const el = new FakeEl(tag);
    el.apply(options);
    this.appendChild(el);
    return el;
  }

  createSpan(options?: any): FakeEl {
    return this.createEl("span", options);
  }

  setText(text: string): void { this.text = text; }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.attrs[name] = "";
    else delete this.attrs[name];
  }
  setAttr(name: string, value: string): void { this.attrs[name] = value; }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  addClass(...classes: string[]): void { classes.forEach((c) => this.classes.add(c)); }
  removeClass(...classes: string[]): void { classes.forEach((c) => this.classes.delete(c)); }
  toggleClass(cls: string, value: boolean): void { if (value) this.classes.add(cls); else this.classes.delete(cls); }
  hasClass(cls: string): boolean { return this.classes.has(cls); }

  appendChild(el: FakeEl): FakeEl {
    el.parent = this;
    this.children.push(el);
    return el;
  }

  contains(node: FakeEl | null): boolean {
    if (node === null) return false;
    let current: FakeEl | null = node;
    while (current !== null) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  addEventListener(type: string, fn: (event: any) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  click(): void {
    for (const fn of this.listeners.click ?? []) fn({ preventDefault() {} });
  }

  /** Every descendant with the given class, in document order. */
  all(cls: string): FakeEl[] {
    const found: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      if (el.classes.has(cls)) found.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return found;
  }
}

(globalThis as any).document = {
  createElement: (tag: string) => new FakeEl(tag),
};
(globalThis as any).__notices = [];
(globalThis as any).__modals = [];
(globalThis as any).window = globalThis;

export class TAbstractFile { path = ""; name = ""; }
export class TFile extends TAbstractFile { basename = ""; extension = "md"; }

export class Notice {
  constructor(public message: string) { (globalThis as any).__notices.push(message); }
}

/** Icons are the app's, not the plugin's: the double only records which one was asked for. */
export function setIcon(el: FakeEl, icon: string): void {
  el.setAttr("data-icon", icon);
}

export class Plugin {
  app: any;
  __ribbon: Array<{ icon: string; title: string; callback: (event?: any) => unknown }> = [];
  __commands: Array<{ id: string; name: string; callback: () => unknown }> = [];
  __views = new Map<string, (leaf: any) => any>();
  __blocks = new Map<string, (source: string, el: FakeEl, ctx: any) => unknown>();
  __tab: any = null;

  constructor(app?: any) { this.app = app; }

  addRibbonIcon(icon: string, title: string, callback: (event?: any) => unknown): FakeEl {
    this.__ribbon.push({ icon, title, callback });
    return new FakeEl();
  }
  addCommand(command: { id: string; name: string; callback: () => unknown }): void { this.__commands.push(command); }
  registerView(type: string, factory: (leaf: any) => any): void { this.__views.set(type, factory); }
  addSettingTab(tab: any): void { this.__tab = tab; }
  registerEvent(): void {}
  registerMarkdownCodeBlockProcessor(language: string, handler: any): void { this.__blocks.set(language, handler); }
  async loadData(): Promise<unknown> { return null; }
  async saveData(): Promise<void> {}
}

export class ItemView {
  app: any;
  leaf: any;
  contentEl = new FakeEl();
  containerEl = new FakeEl();
  constructor(leaf: any) { this.leaf = leaf; this.app = leaf.app; }
  getViewType(): string { return "unknown"; }
  getDisplayText(): string { return "unknown"; }
  getIcon(): string { return "unknown"; }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class Modal {
  app: any;
  containerEl = new FakeEl();
  modalEl = new FakeEl();
  contentEl = new FakeEl();
  closed = false;
  constructor(app: any) { this.app = app; }
  open(): void {
    (globalThis as any).__modals.push(this);
    this.onOpen?.();
  }
  close(): void { this.closed = true; this.onClose?.(); }
  onOpen(): void {}
  onClose(): void {}
}

export class MarkdownRenderChild {
  constructor(public containerEl: FakeEl) {}
  onunload(): void {}
}

export class PluginSettingTab {
  containerEl = new FakeEl();
  constructor(public app: any, public plugin: any) {}
  display(): void {}
}

export class Setting {
  constructor(public containerEl: FakeEl) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  setHeading(): this { return this; }
  addText(cb: (c: any) => unknown): this { cb(component()); return this; }
  addTextArea(cb: (c: any) => unknown): this { cb(component()); return this; }
  addToggle(cb: (c: any) => unknown): this { cb(component()); return this; }
  addButton(cb: (c: any) => unknown): this { cb(component()); return this; }
  addDropdown(cb: (c: any) => unknown): this { cb(component()); return this; }
}

function component(): any {
  const c: any = {
    setValue: () => c,
    setPlaceholder: () => c,
    onChange: () => c,
    setButtonText: () => c,
    setCta: () => c,
    setTooltip: () => c,
    onClick: () => c,
    addOption: () => c,
    inputEl: new FakeEl("input"),
  };
  return c;
}
