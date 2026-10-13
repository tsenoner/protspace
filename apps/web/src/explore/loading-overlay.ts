import { countNoun } from '@protspace/utils';
import type { DatasetLoadKind } from './types';

export interface OverlayNote {
  text: string;
  href?: string;
  linkText?: string;
}

export interface LoadingOverlayController {
  update(
    show: boolean,
    progress?: number,
    message?: string,
    subMessage?: string,
    note?: OverlayNote | null,
  ): void;
  setCancelHandler(handler: (() => void) | null, label?: string): void;
  dispose(): void;
}

/**
 * The share of the loading bar, in percent, that an example's download fills
 * (persisted-dataset.ts). Decoding and rendering report progress on a 0–100
 * scale of their own, which `progressAfterExampleDownload` maps onto the rest,
 * so the bar never runs backwards.
 */
export const EXAMPLE_DOWNLOAD_SHARE = 40;

/** Maps a decode or render phase's 0–100 progress onto the bar left after an example's download. */
export function progressAfterExampleDownload(progress: number): number {
  const clamped = Math.min(100, Math.max(0, progress));
  return EXAMPLE_DOWNLOAD_SHARE + (clamped * (100 - EXAMPLE_DOWNLOAD_SHARE)) / 100;
}

/**
 * What the overlay says (design decision 15). It tells the truth about the data: a local file is
 * read in the browser, and only a FASTA file is sent to the server, for embedding.
 */
export const LOADING_COPY = {
  readingTitle: 'Reading your file in the browser',
  readingFile: (name: string) => `Reading ${name}…`,
  openingExample: (label: string) => `Opening ${label}`,
  reopeningStored: (name: string) => `Reopening ${name} from this browser`,
  saving: 'Saving a copy in this browser',
  drawing: (count: number) => `Drawing ${countNoun(count, 'protein', 'proteins')}`,
  fastaTitle: 'Preparing FASTA…',
  fastaUploading: 'Uploading to the embedding server…',
} as const;

/** The overlay's title and detail line while the data loader decodes, by where the data came from. */
export function loadingCopyFor(
  meta: { kind: DatasetLoadKind; example?: { entry: { label: string } }; fileName?: string } | null,
): { title: string; detail: string } {
  if (meta?.example) {
    // An example's label reads "name · proteins · size"; the name is enough, as in the app bar.
    return {
      title: LOADING_COPY.openingExample(meta.example.entry.label.split(' · ')[0]),
      detail: '',
    };
  }
  if (meta?.kind === 'opfs' && meta.fileName) {
    return { title: LOADING_COPY.reopeningStored(meta.fileName), detail: '' };
  }
  return {
    title: LOADING_COPY.readingTitle,
    detail: meta?.fileName ? LOADING_COPY.readingFile(meta.fileName) : '',
  };
}

const OVERLAY_ID = 'progressive-loading';
const CANCEL_BUTTON_ID = 'progressive-loading-cancel';
const CANCEL_DEFAULT_LABEL = 'Cancel';
const LIVE_ID = 'progressive-loading-status';

/**
 * The full-page loading overlay. It blocks the page while a load runs; the runtime also makes the
 * workbench inert meanwhile, so the keyboard cannot reach what the overlay covers. Built with
 * `createElement` and `textContent` only: a file name or a server message is never parsed as
 * markup. `workbench.css` styles its classes from the tokens. `subMessage` is the title,
 * `message` the line under the bar.
 */
export function createLoadingOverlayController(doc: Document = document): LoadingOverlayController {
  let cancelHandler: (() => void) | null = null;
  let cancelLabel = CANCEL_DEFAULT_LABEL;
  let currentNote: OverlayNote | null = null;

  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    id?: string,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = className;
    if (id) el.id = id;
    return el;
  };

  // One live region for the controller's lifetime, there before any text is put in it: a region
  // inserted together with its text is often not announced. It says the title only, so a progress
  // tick is not read out.
  const live = element('p', 'sr-only', LIVE_ID);
  live.setAttribute('role', 'status');
  doc.body.appendChild(live);
  const setText = (el: HTMLElement | null, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  const build = (): HTMLElement => {
    const overlay = element('div', 'ps-loading', OVERLAY_ID);
    const card = element('div', 'ps-loading__card');
    const bar = element('div', 'ps-loading__bar', 'progress-track');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Loading');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.appendChild(element('div', 'ps-loading__fill', 'progress-bar'));
    card.appendChild(element('p', 'ps-loading__title', 'processing-text'));
    card.appendChild(bar);
    card.appendChild(element('p', 'ps-loading__detail', 'progress-text'));
    overlay.appendChild(card);
    return overlay;
  };

  const renderCancelButton = (overlay: HTMLElement) => {
    let button = overlay.querySelector<HTMLButtonElement>(`#${CANCEL_BUTTON_ID}`);

    if (!cancelHandler) {
      button?.remove();
      return;
    }

    if (!button) {
      button = element('button', 'ps-loading__cancel', CANCEL_BUTTON_ID);
      button.type = 'button';
      button.addEventListener('click', () => cancelHandler?.());
      (overlay.firstElementChild ?? overlay).appendChild(button);
    }

    setText(button, cancelLabel);
  };

  const renderNote = (overlay: HTMLElement) => {
    overlay.querySelector('#loading-note')?.remove();
    if (!currentNote) return;
    const noteEl = element('div', 'ps-loading__note', 'loading-note');
    const textSpan = doc.createElement('span');
    textSpan.textContent = currentNote.text;
    noteEl.appendChild(textSpan);
    if (currentNote.href) {
      const anchor = doc.createElement('a');
      anchor.href = currentNote.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = currentNote.linkText || currentNote.href;
      noteEl.appendChild(anchor);
    }
    const progressText = overlay.querySelector('#progress-text');
    if (progressText) {
      progressText.insertAdjacentElement('afterend', noteEl);
    } else {
      (overlay.firstElementChild ?? overlay).appendChild(noteEl);
    }
  };

  const update = (
    show: boolean,
    progress: number = 0,
    message: string = '',
    subMessage: string = '',
    note?: OverlayNote | null,
  ) => {
    let overlay = doc.getElementById(OVERLAY_ID);

    if (!show) {
      currentNote = null;
      // Emptied, so the next load's title is announced even when it reads the same.
      setText(live, '');
      // Removed at once, with no fade: callers dismiss only when the load has settled,
      // and a fading overlay still covers (and blocks clicks on) the page meanwhile.
      overlay?.remove();
      return;
    }

    if (!overlay) {
      overlay = build();
      doc.body.appendChild(overlay);
    }

    const progressBar = overlay.querySelector<HTMLElement>('#progress-bar');
    if (progressBar) progressBar.style.width = `${progress}%`;
    overlay
      .querySelector('#progress-track')
      ?.setAttribute('aria-valuenow', String(Math.round(progress)));
    setText(overlay.querySelector<HTMLElement>('#progress-text'), message);
    setText(overlay.querySelector<HTMLElement>('#processing-text'), subMessage);
    setText(live, subMessage);

    // A progress tick leaves the note alone; only a call that passes one (or null) changes it.
    if (note !== undefined) {
      currentNote = note;
      renderNote(overlay);
    }
    renderCancelButton(overlay);
  };

  const setCancelHandler = (handler: (() => void) | null, label?: string) => {
    cancelHandler = handler;
    cancelLabel = label ?? CANCEL_DEFAULT_LABEL;
    const overlay = doc.getElementById(OVERLAY_ID);
    if (overlay) renderCancelButton(overlay);
  };

  return {
    update,
    setCancelHandler,
    dispose() {
      cancelHandler = null;
      currentNote = null;
      doc.getElementById(OVERLAY_ID)?.remove();
      live.remove();
    },
  };
}

/** The focused element, looking through open shadow roots. */
function deepActiveElement(doc: Document): HTMLElement | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el as HTMLElement | null;
}

interface LoadFocusReturn {
  /** Notes the focused element as a load begins (the workbench goes inert and drops focus). */
  remember(): void;
  /** Puts focus back once the load has ended, or on `fallback` when that element is gone. */
  restore(): void;
}

/**
 * Hands focus back after a load. The workbench is inert while the overlay shows, so focus falls
 * to `<body>`, and a keyboard user would start again from the top of the page after every dataset
 * switch. `restore` waits a frame, until React has lifted `inert`; it does nothing when focus was
 * on `<body>` before the load or has moved since.
 */
export function createLoadFocusReturn(
  fallback: () => HTMLElement | null,
  doc: Document = document,
  nextFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
): LoadFocusReturn {
  let remembered: HTMLElement | null = null;
  const focusLost = () => doc.activeElement === null || doc.activeElement === doc.body;
  // Focusing a removed, hidden or inert element does nothing: whether focus moved says so.
  const tryFocus = (el: HTMLElement | null) => {
    if (!el?.isConnected) return false;
    el.focus();
    return !focusLost();
  };
  return {
    remember() {
      const active = deepActiveElement(doc);
      remembered = active === doc.body ? null : active;
    },
    restore() {
      const target = remembered;
      remembered = null;
      if (!target) return;
      nextFrame(() => {
        if (!focusLost()) return;
        if (!tryFocus(target)) tryFocus(fallback());
      });
    },
  };
}
