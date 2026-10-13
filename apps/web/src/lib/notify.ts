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

const DEFAULT_DURATIONS_MS: Record<NotifyLevel, number> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  error: 10_000,
};

const DEDUPE_WINDOW_MS = 5_000;
const recentNotifications = new Map<string, number>();

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

function emitNotification(level: NotifyLevel, options: NotifyOptions): void {
  if (shouldSkipNotification(options.dedupeKey)) {
    return;
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

  toast[level](options.title, {
    description,
    duration,
    ...(action && { action: toSonnerAction(action) }),
    ...(secondaryAction && { cancel: toSonnerAction(secondaryAction) }),
  });
}

export const notify = {
  success(options: NotifyOptions): void {
    emitNotification('success', options);
  },
  info(options: NotifyOptions): void {
    emitNotification('info', options);
  },
  warning(options: NotifyOptions): void {
    emitNotification('warning', options);
  },
  error(options: NotifyOptions): void {
    emitNotification('error', options);
  },
};

export function resetNotifyStateForTests(): void {
  recentNotifications.clear();
}
