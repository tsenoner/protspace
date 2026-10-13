import type { PsDialog } from '@protspace/core';

interface ConfirmOptions {
  heading: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button reads as destructive. */
  danger?: boolean;
  /** Where focus goes after the dialog closes, when the control that opened it is gone. */
  returnFocusTo?: HTMLElement | null;
}

/**
 * Asks a yes-or-no question in a small kit dialog (design decision 15: clearing stored data asks
 * first, because nothing can restore it). Resolves true only on the confirm button; Cancel,
 * Escape, the backdrop and the dialog's own close resolve false. The dialog removes itself. Cancel
 * takes focus first, so a reflexive Enter does not destroy anything.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const dialog = document.createElement('ps-dialog') as PsDialog;
  dialog.heading = options.heading;
  dialog.size = 'sm';

  const body = document.createElement('p');
  body.className = 'wb-confirm-body';
  body.textContent = options.body;

  const cancel = document.createElement('ps-button');
  cancel.slot = 'footer';
  cancel.setAttribute('variant', 'secondary');
  cancel.setAttribute('autofocus', '');
  cancel.textContent = options.cancelLabel ?? 'Cancel';

  const confirm = document.createElement('ps-button');
  confirm.slot = 'footer';
  confirm.setAttribute('variant', options.danger ? 'danger' : 'primary');
  confirm.textContent = options.confirmLabel;

  dialog.append(body, cancel, confirm);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('ps-close', onClose);
      // Closes it (a no-op when Escape or the backdrop already did) and returns focus.
      dialog.dismiss();
      dialog.remove();
      if (options.returnFocusTo?.isConnected) options.returnFocusTo.focus();
      resolve(confirmed);
    };
    const onClose = () => finish(false);
    dialog.addEventListener('ps-close', onClose);
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    document.body.append(dialog);
    dialog.open = true;
  });
}
