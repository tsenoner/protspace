export interface OverlayNote {
  text: string;
  href?: string;
  linkText?: string;
}

interface LoadingOverlayController {
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

const CANCEL_BUTTON_ID = 'progressive-loading-cancel';
const CANCEL_DEFAULT_LABEL = 'Cancel';

export function createLoadingOverlayController(doc: Document = document): LoadingOverlayController {
  let overlayRemovalTimeout = 0;
  let cancelHandler: (() => void) | null = null;
  let cancelLabel = CANCEL_DEFAULT_LABEL;
  let currentNote: OverlayNote | null = null;

  const renderCancelButton = (overlay: HTMLElement) => {
    let button = overlay.querySelector<HTMLButtonElement>(`#${CANCEL_BUTTON_ID}`);

    if (!cancelHandler) {
      button?.remove();
      return;
    }

    if (!button) {
      button = doc.createElement('button');
      button.id = CANCEL_BUTTON_ID;
      button.type = 'button';
      button.style.cssText = `
        margin-top: 24px; padding: 8px 20px; font-size: 14px;
        background: rgba(255,255,255,0.08); color: white;
        border: 1px solid rgba(255,255,255,0.35); border-radius: 4px;
        cursor: pointer; font-family: inherit;
      `;
      button.addEventListener('click', () => cancelHandler?.());
      const inner = overlay.firstElementChild;
      (inner ?? overlay).appendChild(button);
    }

    button.textContent = cancelLabel;
  };

  const renderNote = (overlay: HTMLElement) => {
    overlay.querySelector('#loading-note')?.remove();
    if (!currentNote) return;
    const noteEl = doc.createElement('div');
    noteEl.id = 'loading-note';
    noteEl.style.cssText = 'font-size: 13px; opacity: 0.75; margin-top: 16px;';
    const textSpan = doc.createElement('span');
    textSpan.textContent = currentNote.text;
    noteEl.appendChild(textSpan);
    if (currentNote.href) {
      const anchor = doc.createElement('a');
      anchor.href = currentNote.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = currentNote.linkText || currentNote.href;
      anchor.style.cssText = 'color: #06b6d4; text-decoration: underline; margin-left: 4px;';
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
    let overlay = doc.getElementById('progressive-loading');

    if (!show) {
      currentNote = null;
      if (overlay) {
        if (overlayRemovalTimeout) {
          clearTimeout(overlayRemovalTimeout);
        }
        overlay.style.transition = 'opacity 0.5s ease';
        overlay.style.opacity = '0';
        overlayRemovalTimeout = window.setTimeout(() => {
          overlay?.remove();
          overlayRemovalTimeout = 0;
        }, 500);
      }
      return;
    }

    if (overlayRemovalTimeout) {
      clearTimeout(overlayRemovalTimeout);
      overlayRemovalTimeout = 0;
    }

    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'progressive-loading';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-atomic', 'true');
      overlay.setAttribute('aria-busy', 'true');
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: linear-gradient(135deg, rgba(0,0,0,0.9), rgba(20,20,40,0.9));
        color: white; z-index: 9999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      overlay.innerHTML = `
        <div style="text-align: center; max-width: 500px;">
          <div style="font-size: 24px; margin-bottom: 10px;">🚀 Loading ProtSpace</div>
          <div id="processing-text" style="font-size: 18px; margin-bottom: 20px;">
            ${subMessage}
          </div>
          <div style="width: 300px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 20px auto;">
            <div id="progress-bar" style="height: 100%; background: linear-gradient(90deg, #3b82f6, #06b6d4); border-radius: 2px; width: 0%; transition: width 0.3s ease;"></div>
          </div>
          <div id="progress-text" style="font-size: 14px; opacity: 0.8; margin-top: 10px;">
            ${message}
          </div>
        </div>
      `;
      doc.body.appendChild(overlay);
    } else {
      overlay.style.opacity = '1';
      overlay.style.transition = 'none';
    }

    overlay.setAttribute('aria-label', [subMessage, message].filter(Boolean).join('. '));

    const progressBar = overlay.querySelector<HTMLElement>('#progress-bar');
    const progressText = overlay.querySelector<HTMLElement>('#progress-text');
    const processingText = overlay.querySelector<HTMLElement>('#processing-text');

    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = message;
    if (processingText) processingText.textContent = subMessage;

    if (note !== undefined) {
      currentNote = note;
    }
    renderNote(overlay);
    renderCancelButton(overlay);
  };

  const setCancelHandler = (handler: (() => void) | null, label?: string) => {
    cancelHandler = handler;
    cancelLabel = label ?? CANCEL_DEFAULT_LABEL;
    const overlay = doc.getElementById('progressive-loading');
    if (overlay) renderCancelButton(overlay);
  };

  return {
    update,
    setCancelHandler,
    dispose() {
      if (overlayRemovalTimeout) {
        clearTimeout(overlayRemovalTimeout);
        overlayRemovalTimeout = 0;
      }
      cancelHandler = null;
      currentNote = null;
      doc.getElementById('progressive-loading')?.remove();
    },
  };
}
