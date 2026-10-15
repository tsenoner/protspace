/**
 * The GIF overlays: a dot that follows the pointer, a ripple where it clicks or starts a drag, a
 * key cap for each key press, and a caption. Page-side elements styled with the app's `--ps-*`
 * tokens only, so they follow the page's theme. Their root is a manual popover, raised on each use,
 * so it shows above open menus and dialogs in the top layer. Only `runner.ts` uses them, for GIFs:
 * screenshots never show them.
 */
import type { Page } from '@playwright/test';

interface Indicators {
  cursor(x: number, y: number): void;
  click(x: number, y: number): void;
  key(text: string): void;
  label(text: string): void;
}
type IndicatorWindow = Window & { __docsCaptureIndicators?: Indicators };

/** Installs the overlays in every document the page loads; call it before the first navigation. */
export async function installIndicators(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const css = `
      #docs-capture-indicators {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: visible;
        pointer-events: none;
      }
      #docs-capture-indicators * {
        box-sizing: border-box;
        pointer-events: none;
      }
      #docs-capture-indicators .cursor {
        position: fixed;
        left: 0;
        top: 0;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        border: 2px solid var(--ps-accent);
        border-radius: var(--ps-radius-full);
        background: color-mix(in srgb, var(--ps-accent) 30%, transparent);
        box-shadow: var(--ps-shadow-sm);
        display: none;
      }
      #docs-capture-indicators .ripple {
        position: fixed;
        width: 56px;
        height: 56px;
        margin: -28px 0 0 -28px;
        border: 3px solid var(--ps-accent);
        border-radius: var(--ps-radius-full);
        animation: docs-capture-ripple 600ms ease-out forwards;
      }
      @keyframes docs-capture-ripple {
        from { transform: scale(0.2); opacity: 1; }
        to { transform: scale(1); opacity: 0; }
      }
      #docs-capture-indicators .key,
      #docs-capture-indicators .label {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        font-family: var(--ps-font-sans);
        font-weight: var(--ps-weight-semibold);
        white-space: nowrap;
        display: none;
      }
      #docs-capture-indicators .key {
        bottom: 40px;
        padding: var(--ps-space-3) var(--ps-space-6);
        border-radius: var(--ps-radius-lg);
        background: var(--ps-tooltip-bg);
        color: var(--ps-tooltip-text);
        font-size: var(--ps-text-xl);
        box-shadow: var(--ps-shadow-lg);
      }
      #docs-capture-indicators .label {
        bottom: 112px;
        padding: var(--ps-space-2) var(--ps-space-5);
        border-radius: var(--ps-radius);
        background: var(--ps-accent);
        color: var(--ps-text-on-accent);
        font-size: var(--ps-text-lg);
        box-shadow: var(--ps-shadow-md);
      }
    `;
    let root: HTMLElement | null = null;
    const timers = new Map<string, number>();

    // `raise`: re-show the root so it sits above whatever entered the top layer since. A click, a
    // key or a label raises; a pointer move does not, or a 30-step drag would leave and re-enter
    // the top layer 30 times (60 toggle events) while a menu or a drag is live.
    const part = (name: string, raise = true): HTMLElement => {
      if (!root) {
        root = document.createElement('div');
        root.id = 'docs-capture-indicators';
        root.setAttribute('popover', 'manual');
        root.setAttribute('aria-hidden', 'true');
        const style = document.createElement('style');
        style.textContent = css;
        root.append(style);
        for (const kind of ['cursor', 'key', 'label']) {
          const element = document.createElement('div');
          element.className = kind;
          root.append(element);
        }
        document.body.append(root);
      }
      if (raise || !root.matches(':popover-open')) {
        if (root.matches(':popover-open')) root.hidePopover();
        root.showPopover();
      }
      return root.querySelector<HTMLElement>(`.${name}`) ?? root;
    };

    const flash = (name: string, text: string, ms: number) => {
      const element = part(name);
      element.textContent = text;
      element.style.display = 'block';
      window.clearTimeout(timers.get(name));
      timers.set(
        name,
        window.setTimeout(() => {
          element.style.display = 'none';
        }, ms),
      );
    };

    const indicators: Indicators = {
      cursor(x, y) {
        const cursor = part('cursor', false);
        cursor.style.transform = `translate(${x}px, ${y}px)`;
        cursor.style.display = 'block';
      },
      click(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        part('cursor').after(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
      },
      key(text) {
        flash('key', text, 900);
      },
      label(text) {
        flash('label', text, 1600);
      },
    };
    (window as IndicatorWindow).__docsCaptureIndicators = indicators;

    // The dot follows every pointer move Playwright makes, so a glide shows as one.
    window.addEventListener(
      'pointermove',
      (event) => {
        if (document.body) indicators.cursor(event.clientX, event.clientY);
      },
      { capture: true, passive: true },
    );
  });
}

/** Calls one overlay in the page; fails when `installIndicators` did not run before the load. */
async function call(
  page: Page,
  method: keyof Indicators,
  args: Array<string | number>,
): Promise<void> {
  await page.evaluate(
    ({ name, values }) => {
      const indicators = (window as IndicatorWindow).__docsCaptureIndicators;
      if (!indicators) {
        throw new Error('installIndicators(page) was not called before the page loaded');
      }
      (indicators[name] as (...input: Array<string | number>) => void)(...values);
    },
    { name: method, values: args },
  );
}

/** Shows the pointer dot at `at` (it also follows every pointer move by itself). */
export async function showCursor(page: Page, at: { x: number; y: number }): Promise<void> {
  await call(page, 'cursor', [at.x, at.y]);
}

/** A ripple at `at`, for a click or the press that starts a drag. */
export async function showClick(page: Page, at: { x: number; y: number }): Promise<void> {
  await call(page, 'click', [at.x, at.y]);
}

/** A key cap at the bottom centre, e.g. "Ctrl + Z", for 0.9 s. */
export async function showKey(page: Page, label: string): Promise<void> {
  await call(page, 'key', [label]);
}

/** A caption above the key cap, e.g. "Scroll to zoom", for 1.6 s. */
export async function showLabel(page: Page, text: string): Promise<void> {
  await call(page, 'label', [text]);
}
