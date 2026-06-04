import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoadingOverlayController, type OverlayNote } from './loading-overlay';

// ---------------------------------------------------------------------------
// Minimal fake DOM — avoids needing jsdom/happy-dom as a dependency.
// The controller accepts a `doc` parameter so we pass this in instead of
// the global `document`.
// ---------------------------------------------------------------------------

interface FakeEl {
  _tag: string;
  id: string;
  textContent: string;
  href: string;
  target: string;
  rel: string;
  type: string;
  style: { cssText: string };
  children: FakeEl[];
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(child: FakeEl): FakeEl;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  insertAdjacentElement(pos: string, el: FakeEl): void;
  remove(): void;
  addEventListener(type: string, handler: () => void): void;
  readonly firstElementChild: FakeEl | null;
  innerHTML: string;
}

function makeDoc() {
  function findById(root: FakeEl, id: string): FakeEl | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }

  function findParent(root: FakeEl, target: FakeEl): FakeEl | null {
    if (root.children.includes(target)) return root;
    for (const child of root.children) {
      const found = findParent(child, target);
      if (found) return found;
    }
    return null;
  }

  function createElement(tag: string): FakeEl {
    const el: FakeEl = {
      _tag: tag,
      id: '',
      textContent: '',
      href: '',
      target: '',
      rel: '',
      type: '',
      style: { cssText: '' },
      children: [],
      _attrs: {},
      setAttribute(k, v) {
        this._attrs[k] = v;
      },
      getAttribute(k) {
        return this._attrs[k] ?? null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      querySelector(sel) {
        const id = sel.startsWith('#') ? sel.slice(1) : null;
        if (!id) return null;
        // Search within this element's subtree (excluding self)
        for (const child of this.children) {
          const found = findById(child, id);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll(_sel) {
        return [];
      },
      insertAdjacentElement(pos, inserted) {
        const parent = findParent(body, this);
        if (!parent) return;
        const idx = parent.children.indexOf(this);
        if (pos === 'afterend' && idx >= 0) {
          parent.children.splice(idx + 1, 0, inserted);
        }
      },
      remove() {
        const parent = findParent(body, this);
        if (parent) {
          const idx = parent.children.indexOf(this);
          if (idx >= 0) parent.children.splice(idx, 1);
        }
      },
      addEventListener(_type, _handler) {},
      get firstElementChild() {
        return this.children[0] ?? null;
      },
      get innerHTML() {
        return '';
      },
      set innerHTML(html: string) {
        // Seed child elements from id attributes in the HTML template.
        this.children = [];
        const idRe = /id="([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = idRe.exec(html)) !== null) {
          const child = createElement('div');
          child.id = m[1];
          this.children.push(child);
        }
      },
    };
    return el;
  }

  const body = createElement('body');

  return {
    body: body as unknown as HTMLElement,
    createElement: (tag: string) => createElement(tag) as unknown as HTMLElement,
    getElementById(id: string): HTMLElement | null {
      return findById(body, id) as unknown as HTMLElement | null;
    },
    // expose body as FakeEl for test introspection
    _body: body,
  };
}

type FakeDoc = ReturnType<typeof makeDoc>;

let doc: FakeDoc;

beforeEach(() => {
  doc = makeDoc();
});

afterEach(() => {
  // nothing to clean up — new doc per test
});

function getNote() {
  return doc.getElementById('loading-note');
}

function getNoteEl() {
  return doc._body.children.flatMap((c) => c.children).find((c) => c.id === 'loading-note') ?? null;
}

describe('loading-overlay note rendering', () => {
  it('renders no #loading-note when update is called without a note arg', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub');
    expect(getNote()).toBeNull();
    ctrl.dispose();
  });

  it('renders #loading-note with text and link when note is provided', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    const note: OverlayNote = {
      text: 'Got a larger dataset?',
      href: 'https://colab.example.com',
      linkText: 'Open in Colab',
    };
    ctrl.update(true, 10, 'msg', 'sub', note);
    const noteEl = getNoteEl();
    expect(noteEl).not.toBeNull();
    const span = noteEl!.children.find((c) => c._tag === 'span');
    expect(span?.textContent).toBe('Got a larger dataset?');
    const anchor = noteEl!.children.find((c) => c._tag === 'a');
    expect(anchor?.textContent).toBe('Open in Colab');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener noreferrer');
    ctrl.dispose();
  });

  it('leaves the note in the DOM when update is called again with undefined note', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: 'Persistent note' });
    ctrl.update(true, 20, 'msg2', 'sub2');
    expect(getNoteEl()).not.toBeNull();
    ctrl.dispose();
  });

  it('removes #loading-note when note is passed as null', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: 'Some note' });
    expect(getNoteEl()).not.toBeNull();
    ctrl.update(true, 20, 'msg2', 'sub2', null);
    expect(getNoteEl()).toBeNull();
    ctrl.dispose();
  });

  it('renders note text as text content — HTML is not interpreted', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: '<script>alert(1)</script>' });
    const noteEl = getNoteEl();
    expect(noteEl).not.toBeNull();
    const span = noteEl!.children.find((c) => c._tag === 'span');
    // textContent assignment — no script element is created
    expect(span?.textContent).toBe('<script>alert(1)</script>');
    const hasScript = (function walk(el: FakeEl): boolean {
      if (el._tag === 'script') return true;
      return el.children.some(walk);
    })(doc._body);
    expect(hasScript).toBe(false);
    ctrl.dispose();
  });

  it.skip('javascript: href — URL validation out of scope; current behavior is unvalidated', () => {
    // Intentionally skipped per spec §2.5: URL sanitization is out of scope.
  });

  it('does not render a note after hide+show when no note arg is passed on re-show', () => {
    vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {} });
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: 'Ephemeral note' });
    expect(getNoteEl()).not.toBeNull();
    // hide resets currentNote (triggers window.setTimeout for fade-out)
    ctrl.update(false);
    // Re-show without a note arg — overlay is recreated fresh, no note
    ctrl.update(true, 5, 'new msg', 'new sub');
    expect(getNoteEl()).toBeNull();
    ctrl.dispose();
    vi.unstubAllGlobals();
  });
});
