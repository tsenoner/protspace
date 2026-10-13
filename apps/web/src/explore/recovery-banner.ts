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
  /** Mount target — defaults to the workbench's plot area, else document.body. */
  parent?: HTMLElement;
}

const BANNER_ID = 'protspace-recovery-banner';
const TITLE_ID = 'protspace-recovery-banner-title';

export function dismissRecoveryBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

function kitButton(
  label: string,
  variant: 'primary' | 'secondary' | 'danger',
  onClick: () => void,
): HTMLElement {
  const button = document.createElement('ps-button');
  button.setAttribute('variant', variant);
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * The banner shown when the stored import did not finish loading last time (design decision 15).
 * It sits in the plot area, under the tool strip's row, built from kit buttons with the DOM API
 * (no markup strings). It is an alert, announced once, and never takes focus: the page stays
 * usable through Import, so it is not a dialog. Try again is off after three failed attempts.
 */
export function showRecoveryBanner(params: ShowRecoveryBannerParams): void {
  dismissRecoveryBanner();

  const copy: RecoveryBannerCopy = getLoadRecoveryCopy(
    params.fileName,
    params.failedAttempts,
    params.lastError,
  );
  const blocking = params.failedAttempts >= 3;

  const root = document.createElement('div');
  root.id = BANNER_ID;
  root.className = 'wb-recovery';
  root.setAttribute('role', 'alert');
  root.setAttribute('aria-labelledby', TITLE_ID);

  const header = document.createElement('div');
  header.className = 'wb-recovery-header';
  const title = document.createElement('p');
  title.id = TITLE_ID;
  title.className = 'wb-recovery-title';
  title.textContent = copy.title;
  const dismiss = document.createElement('ps-icon-button');
  dismiss.setAttribute('icon', 'x');
  dismiss.setAttribute('label', 'Dismiss');
  dismiss.setAttribute('size', 'sm');
  dismiss.addEventListener('click', () => dismissRecoveryBanner());
  header.append(title, dismiss);

  const body = document.createElement('p');
  body.className = 'wb-recovery-body';
  body.textContent = copy.body;

  const actions = document.createElement('div');
  actions.className = 'wb-recovery-actions';
  const retry = kitButton(copy.retryLabel, 'primary', () => void params.handlers.onRetry());
  retry.toggleAttribute('disabled', blocking);
  actions.append(
    retry,
    kitButton(copy.loadDefaultLabel, 'secondary', () => void params.handlers.onLoadDefault()),
    kitButton(copy.clearLabel, 'danger', () => void params.handlers.onClear()),
  );

  root.append(header, body, actions);

  const parent =
    params.parent ??
    document.querySelector<HTMLElement>('[data-workbench="plot"]') ??
    document.body;
  parent.appendChild(root);
}
