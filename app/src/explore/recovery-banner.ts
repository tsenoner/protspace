import { type RecoveryBannerCopy, getLoadRecoveryCopy } from './notifications';

interface RecoveryBannerHandlers {
  onRetry(): Promise<void> | void;
  onLoadDefault(): Promise<void> | void;
  onClear(): Promise<void> | void;
}

interface ShowRecoveryBannerParams {
  fileName: string;
  failedAttempts: number;
  lastError?: string;
  handlers: RecoveryBannerHandlers;
  /** Mount target — defaults to document.body. */
  parent?: HTMLElement;
}

const BANNER_ID = 'protspace-recovery-banner';

// SVG icon strings — inlined because the banner is constructed in vanilla DOM
// from a non-React/non-Lit runtime path. Sizes match lucide-react's defaults
// so they read consistently with the rest of the app's iconography.
const ALERT_TRIANGLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' +
  '<path d="M12 9v4"/><path d="M12 17h.01"/>' +
  '</svg>';

const X_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
  '</svg>';

export function dismissRecoveryBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

export function showRecoveryBanner(params: ShowRecoveryBannerParams): void {
  dismissRecoveryBanner();

  const copy: RecoveryBannerCopy = getLoadRecoveryCopy(
    params.fileName,
    params.failedAttempts,
    params.lastError,
  );
  const blocking = params.failedAttempts >= 3;

  // Token-driven surface — the same bg-card / border-border / shadow-card
  // that the rest of the app's panels use. Severity is carried entirely by
  // the warning-tinted icon and title, so the surface doesn't compete for
  // attention with the surrounding chrome.
  const root = document.createElement('div');
  root.id = BANNER_ID;
  root.className =
    'fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[90%] ' +
    'rounded-lg border border-border bg-card text-card-foreground shadow-card ' +
    'p-4 flex flex-col gap-3';
  root.setAttribute('role', 'alert');
  root.setAttribute('aria-live', 'polite');

  // Header: icon + title (left), close button (right).
  const header = document.createElement('div');
  header.className = 'flex items-start gap-2';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-2 flex-1 min-w-0 text-warning';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'shrink-0 mt-0.5';
  iconWrap.innerHTML = ALERT_TRIANGLE_SVG;

  const title = document.createElement('div');
  title.className = 'font-semibold text-sm';
  title.textContent = copy.title;

  titleWrap.append(iconWrap, title);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className =
    'shrink-0 inline-flex items-center justify-center rounded-md w-7 h-7 ' +
    'text-muted-foreground hover:text-foreground hover:bg-foreground/10 ' +
    'transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
  closeButton.setAttribute('aria-label', 'Dismiss');
  closeButton.innerHTML = X_SVG;
  closeButton.addEventListener('click', () => {
    dismissRecoveryBanner();
  });

  header.append(titleWrap, closeButton);

  const body = document.createElement('div');
  body.className = 'text-sm text-foreground/80';
  body.textContent = copy.body;

  const actions = document.createElement('div');
  actions.className = 'flex gap-2 justify-end pt-1';

  // All three actions share the same outline shape; intent is carried by
  // hue (primary blue / neutral / destructive red). Initial keyboard focus
  // still lands on retry, so the recommended path is discoverable without
  // the visual shouting of a saturated fill.
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className =
    'inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium ' +
    'transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ' +
    (blocking
      ? 'border border-primary/30 text-primary/50 cursor-not-allowed'
      : 'border border-primary/50 bg-background text-primary hover:bg-primary/10 hover:text-primary');
  retryButton.textContent = copy.retryLabel;
  retryButton.disabled = blocking;
  if (blocking) {
    retryButton.setAttribute('aria-label', `${copy.retryLabel} (disabled after repeated failures)`);
  }
  retryButton.addEventListener('click', () => {
    void params.handlers.onRetry();
  });

  // Neutral-outline: the alternative path between the recommended primary
  // (Try again) and the destructive (Clear stored data). Foreground-toned
  // border at the same /50 opacity as the primary and destructive variants
  // so all three button outlines read at uniform intensity.
  const defaultButton = document.createElement('button');
  defaultButton.type = 'button';
  defaultButton.className =
    'inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium ' +
    'border border-foreground/50 bg-background text-foreground ' +
    'hover:bg-foreground/10 ' +
    'transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
  defaultButton.textContent = copy.loadDefaultLabel;
  defaultButton.addEventListener('click', () => {
    void params.handlers.onLoadDefault();
  });

  // Destructive-outline: clear-stored-data is the only irreversible action
  // (permanent OPFS wipe). Red border + red text signals destruction while
  // keeping the same button shape as Load default for visual consistency,
  // and stays subordinate to the primary CTA's saturated fill.
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className =
    'inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium ' +
    'border border-destructive/50 bg-background text-destructive ' +
    'hover:bg-destructive/10 hover:text-destructive ' +
    'transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive';
  clearButton.textContent = copy.clearLabel;
  clearButton.addEventListener('click', () => {
    void params.handlers.onClear();
  });

  actions.append(retryButton, defaultButton, clearButton);
  root.append(header, body, actions);

  (params.parent ?? document.body).appendChild(root);

  // No programmatic focus — the visual focus ring at mount made Try again
  // read as visually heavier than Load default / Clear stored data, breaking
  // the uniform-outline hierarchy. Screen-reader users still hear the banner
  // via role="alert" + aria-live; keyboard users press Tab to enter it
  // (close → retry → default → clear, in sensible order).
}
