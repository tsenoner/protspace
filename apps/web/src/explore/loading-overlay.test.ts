import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXAMPLE_DOWNLOAD_SHARE,
  LOADING_COPY,
  createLoadingOverlayController,
  loadingCopyFor,
  progressAfterExampleDownload,
  type OverlayNote,
} from './loading-overlay';

describe('progressAfterExampleDownload', () => {
  it("maps a decode or render phase's 0–100 onto the bar left after the download", () => {
    expect(EXAMPLE_DOWNLOAD_SHARE).toBeGreaterThan(0);
    expect(EXAMPLE_DOWNLOAD_SHARE).toBeLessThan(100);
    expect(progressAfterExampleDownload(0)).toBe(EXAMPLE_DOWNLOAD_SHARE);
    expect(progressAfterExampleDownload(50)).toBe(
      EXAMPLE_DOWNLOAD_SHARE + (100 - EXAMPLE_DOWNLOAD_SHARE) / 2,
    );
    expect(progressAfterExampleDownload(100)).toBe(100);
  });

  it('clamps out-of-range progress', () => {
    expect(progressAfterExampleDownload(150)).toBe(100);
    expect(progressAfterExampleDownload(-5)).toBe(EXAMPLE_DOWNLOAD_SHARE);
  });
});

describe('loading copy', () => {
  it('the copy picks the source kind', () => {
    expect(loadingCopyFor({ kind: 'user', fileName: 'mine.parquetbundle' })).toEqual({
      title: 'Reading your file in the browser',
      detail: 'Reading mine.parquetbundle…',
    });
    expect(
      loadingCopyFor({
        kind: 'default',
        example: { entry: { label: 'Swiss-Prot · 573K · 45 MB' } },
      }),
    ).toEqual({ title: 'Opening Swiss-Prot', detail: '' });
    expect(loadingCopyFor({ kind: 'opfs', fileName: 'mine.parquetbundle' })).toEqual({
      title: 'Reopening mine.parquetbundle from this browser',
      detail: '',
    });
    // A load the app starts with no example and no name (the perf suite's) still says "browser".
    expect(loadingCopyFor(null)).toEqual({ title: 'Reading your file in the browser', detail: '' });
    for (const copy of [
      loadingCopyFor({ kind: 'user', fileName: 'x' }),
      loadingCopyFor({ kind: 'opfs', fileName: 'x' }),
    ]) {
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/upload/i);
    }
  });

  it('counts the proteins it draws', () => {
    expect(LOADING_COPY.drawing(1)).toBe('Drawing 1 protein');
    expect(LOADING_COPY.drawing(1500)).toBe('Drawing 1,500 proteins');
    expect(LOADING_COPY.saving).toBe('Saving a copy in this browser');
    expect(LOADING_COPY.fastaTitle).toBe('Preparing FASTA…');
    expect(LOADING_COPY.fastaUploading).toBe('Uploading to the embedding server…');
  });
});

// ---------------------------------------------------------------------------
// Minimal fake DOM — avoids needing jsdom/happy-dom as a dependency.
// The controller accepts a `doc` parameter so we pass this in instead of
// the global `document`.
// ---------------------------------------------------------------------------

interface FakeEl {
  _tag: string;
  id: string;
  className: string;
  textContent: string;
  href: string;
  target: string;
  rel: string;
  type: string;
  style: { cssText: string; width?: string };
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
  let innerHtmlWrites = 0;

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
      className: '',
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
      set innerHTML(_html: string) {
        // The overlay must never parse a string as markup: count every attempt.
        innerHtmlWrites++;
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
    _byId: (id: string) => findById(body, id),
    innerHtmlWrites: () => innerHtmlWrites,
  };
}

type FakeDoc = ReturnType<typeof makeDoc>;

let doc: FakeDoc;

beforeEach(() => {
  doc = makeDoc();
});

const getNoteEl = () => doc._byId('loading-note');

function hasTag(root: FakeEl, tag: string): boolean {
  return root._tag === tag || root.children.some((child) => hasTag(child, tag));
}

describe('loading-overlay rendering', () => {
  it('builds the card from classes, with the ids the e2e reads', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 30, 'Reading mine.parquetbundle…', 'Reading your file in the browser');

    const overlay = doc._byId('progressive-loading')!;
    expect(overlay.className).toBe('ps-loading');
    expect(overlay.getAttribute('role')).toBe('status');
    expect(overlay.getAttribute('aria-live')).toBe('polite');
    expect(overlay.getAttribute('aria-busy')).toBe('true');
    expect(overlay.getAttribute('aria-label')).toBe(
      'Reading your file in the browser. Reading mine.parquetbundle…',
    );
    // No inline styling: workbench.css styles the classes from tokens.
    expect(overlay.style.cssText).toBe('');
    const card = overlay.firstElementChild!;
    expect(card.className).toBe('ps-loading__card');
    expect(doc._byId('processing-text')!.className).toBe('ps-loading__title');
    expect(doc._byId('processing-text')!.textContent).toBe('Reading your file in the browser');
    expect(doc._byId('progress-text')!.className).toBe('ps-loading__detail');
    expect(doc._byId('progress-text')!.textContent).toBe('Reading mine.parquetbundle…');
    expect(doc._byId('progress-bar')!.className).toBe('ps-loading__fill');
    expect(doc._byId('progress-bar')!.style.width).toBe('30%');
    ctrl.dispose();
  });

  it('never sets innerHTML', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: 'A note', href: 'https://example.com' });
    ctrl.setCancelHandler(() => {}, 'Cancel download');
    ctrl.update(true, 20, 'msg2', 'sub2');
    expect(doc.innerHtmlWrites()).toBe(0);
    ctrl.dispose();
  });

  it('a message with <img> stays text', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, '<img src=x onerror=alert(1)>', '<b>sub</b>');
    expect(doc._byId('progress-text')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(doc._byId('processing-text')!.textContent).toBe('<b>sub</b>');
    expect(hasTag(doc._body, 'img')).toBe(false);
    expect(hasTag(doc._body, 'b')).toBe(false);
    ctrl.dispose();
  });

  it('Cancel keeps its id and label', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub');
    ctrl.setCancelHandler(() => {}, 'Cancel download');
    const button = doc._byId('progressive-loading-cancel')!;
    expect(button._tag).toBe('button');
    expect(button.type).toBe('button');
    expect(button.className).toBe('ps-loading__cancel');
    expect(button.textContent).toBe('Cancel download');
    expect(button.style.cssText).toBe('');
    ctrl.setCancelHandler(null);
    expect(doc._byId('progressive-loading-cancel')).toBeNull();
    ctrl.dispose();
  });
});

describe('loading-overlay note rendering', () => {
  it('renders no #loading-note when update is called without a note arg', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub');
    expect(getNoteEl()).toBeNull();
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
    expect(noteEl!.className).toBe('ps-loading__note');
    const span = noteEl!.children.find((c) => c._tag === 'span');
    expect(span?.textContent).toBe('Got a larger dataset?');
    const anchor = noteEl!.children.find((c) => c._tag === 'a');
    expect(anchor?.textContent).toBe('Open in Colab');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener noreferrer');
    expect(anchor?.style.cssText).toBe('');
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
    expect(hasTag(doc._body, 'script')).toBe(false);
    ctrl.dispose();
  });

  it.skip('javascript: href — URL validation out of scope; current behavior is unvalidated', () => {
    // Intentionally skipped per spec §2.5: URL sanitization is out of scope.
  });

  it('does not render a note after hide+show when no note arg is passed on re-show', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 10, 'msg', 'sub', { text: 'Ephemeral note' });
    expect(getNoteEl()).not.toBeNull();
    // hide resets currentNote and removes the overlay
    ctrl.update(false);
    // Re-show without a note arg — overlay is recreated fresh, no note
    ctrl.update(true, 5, 'new msg', 'new sub');
    expect(getNoteEl()).toBeNull();
    ctrl.dispose();
  });
});

describe('loading-overlay dismissal', () => {
  it('removes the overlay synchronously, with no fade and no timer', () => {
    // No `window` stub: a removal timer would throw here, and a fade would leave
    // the element in the document after update(false) returns.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    ctrl.update(true, 50, 'msg', 'sub');
    expect(doc.getElementById('progressive-loading')).not.toBeNull();

    ctrl.update(false);

    expect(doc.getElementById('progressive-loading')).toBeNull();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    ctrl.dispose();
  });

  it('is a no-op when no overlay is shown', () => {
    const ctrl = createLoadingOverlayController(doc as unknown as Document);
    expect(() => ctrl.update(false)).not.toThrow();
    expect(doc.getElementById('progressive-loading')).toBeNull();
  });
});
