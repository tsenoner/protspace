import { toast } from '../components/ui/sonner';

/** A toast button: it opens a link, or runs a callback. Either way it dismisses the toast. */
type NotifyAction =
  | {
      /** Button label shown on the toast. */
      label: string;
      /** Link the action opens — a `mailto:` or an `http(s)` URL. */
      href: string;
    }
  | {
      /** Button label shown on the toast. */
      label: string;
      onClick: () => void;
    };

export interface NotifyOptions {
  title: string;
  description?: string;
  durationMs?: number;
  dedupeKey?: string;
  /** Optional primary action button (e.g. "Retry", or a "Report this" bug-report link). */
  action?: NotifyAction;
  /** Optional second, muted button beside the primary one (sonner's `cancel`). */
  secondaryAction?: NotifyAction;
}

type NotifyLevel = 'success' | 'info' | 'warning' | 'error';
/** A shown toast; undefined when a repeat inside the dedupe window was skipped. */
type ToastId = string | number;

const DEFAULT_DURATIONS_MS: Record<NotifyLevel, number> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  error: 10_000,
};

/** How long an Undo stays offered (design decision 15). */
const UNDO_DURATION_MS = 8_000;

const DEDUPE_WINDOW_MS = 5_000;
const recentNotifications = new Map<string, number>();

/** The toaster every toast goes to while set: the workbench's own, on /explore. */
let notifyTarget: string | null = null;

/**
 * Routes every toast to the `<Toaster id={toasterId}>` (the workbench's, at the plot's bottom
 * edge); null returns them to the app's toaster. The workbench sets it while it is mounted.
 */
export function setNotifyTarget(toasterId: string | null): void {
  notifyTarget = toasterId;
}

function pruneExpiredDedupes(now: number): void {
  for (const [key, timestamp] of recentNotifications.entries()) {
    if (now - timestamp >= DEDUPE_WINDOW_MS) {
      recentNotifications.delete(key);
    }
  }
}

function shouldSkipNotification(dedupeKey?: string): boolean {
  if (!dedupeKey) {
    return false;
  }

  const now = Date.now();
  pruneExpiredDedupes(now);

  const previousTimestamp = recentNotifications.get(dedupeKey);
  if (previousTimestamp && now - previousTimestamp < DEDUPE_WINDOW_MS) {
    return true;
  }

  recentNotifications.set(dedupeKey, now);
  return false;
}

function openHref(href: string): void {
  // A `mailto:` should hand off to the mail client in place; web links open
  // in a new tab so the user keeps their ProtSpace session.
  if (href.startsWith('mailto:')) {
    window.location.href = href;
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

function emitNotification(
  level: NotifyLevel,
  options: NotifyOptions,
  /** Runs when the toast goes: dismissed (its ✕ or code) or timed out. */
  onClose?: () => void,
): ToastId | undefined {
  if (shouldSkipNotification(options.dedupeKey)) {
    return undefined;
  }

  const description = options.description?.trim();
  const duration = options.durationMs ?? DEFAULT_DURATIONS_MS[level];
  const { action, secondaryAction, dedupeKey } = options;

  const toSonnerAction = (notifyAction: NotifyAction) => ({
    label: notifyAction.label,
    onClick: () => {
      // Acting on a toast dismisses it, so the same message may show again
      // right away: a Retry that fails again must be able to say so.
      if (dedupeKey) {
        recentNotifications.delete(dedupeKey);
      }
      if ('href' in notifyAction) {
        openHref(notifyAction.href);
      } else {
        notifyAction.onClick();
      }
    },
  });

  return toast[level](options.title, {
    description,
    duration,
    ...(notifyTarget ? { toasterId: notifyTarget } : {}),
    ...(action && { action: toSonnerAction(action) }),
    ...(secondaryAction && { cancel: toSonnerAction(secondaryAction) }),
    ...(onClose && { onDismiss: onClose, onAutoClose: onClose }),
  });
}

export const notify = {
  success(options: NotifyOptions): ToastId | undefined {
    return emitNotification('success', options);
  },
  info(options: NotifyOptions): ToastId | undefined {
    return emitNotification('info', options);
  },
  warning(options: NotifyOptions): ToastId | undefined {
    return emitNotification('warning', options);
  },
  error(options: NotifyOptions): ToastId | undefined {
    return emitNotification('error', options);
  },
  dismiss(id: ToastId): void {
    toast.dismiss(id);
  },
  /**
   * An info toast with an Undo button, offered for 8 s (design decision 13). `onUndo` runs at
   * most once; the handle dismisses the toast early, when the step it would undo is gone.
   */
  undoable({
    title,
    description,
    onUndo,
    onClose,
    durationMs = UNDO_DURATION_MS,
  }: {
    title: string;
    description?: string;
    onUndo(): void;
    /** The toast went (dismissed or timed out): the caller drops what it kept for it. */
    onClose?(): void;
    durationMs?: number;
  }): { dismiss(): void } {
    let used = false;
    const id = emitNotification(
      'info',
      {
        title,
        description,
        durationMs,
        action: {
          label: 'Undo',
          onClick: () => {
            if (used) return;
            used = true;
            onUndo();
          },
        },
      },
      onClose,
    );
    return {
      dismiss() {
        if (id !== undefined) toast.dismiss(id);
      },
    };
  },
};

export function resetNotifyStateForTests(): void {
  recentNotifications.clear();
  notifyTarget = null;
}
