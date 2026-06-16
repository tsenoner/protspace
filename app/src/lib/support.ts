/**
 * Support contact helpers.
 *
 * Single source of truth for the support inbox and for constructing the links
 * that reach it: `mailto:` links, prefilled GitHub-issue links, and the
 * bug-report body shared by toasts, the crash fallback, and the 404 page.
 *
 * All builders are pure — callers inject runtime context (page URL, user
 * agent) via {@link clientContext} so the builders stay testable in a
 * non-browser environment.
 */

/** Support inbox reachable for contact, bug reports, and privacy requests. */
export const SUPPORT_EMAIL = 'hello@protspace.app';

/** Project repository, used to build prefilled bug-report issue links. */
export const GITHUB_REPO_URL = 'https://github.com/tsenoner/protspace_web';

/**
 * Upper bound on the error/stack text embedded in a bug report. Keeps the
 * resulting `mailto:`/issue URL within the practical ~2000-character limit
 * once the rest of the body, page URL, and user agent are added.
 */
export const MAX_ERROR_CHARS = 1200;

interface MailtoParams {
  subject?: string;
  body?: string;
}

interface IssueParams {
  title?: string;
  body?: string;
}

interface BugContextParams {
  /** Short label for the failing operation, e.g. "Export". */
  operation: string;
  /** The error to describe; may be an Error, string, or unknown value. */
  error: unknown;
  /** Page the report originates from (e.g. `window.location.href`). */
  page?: string;
  /** Reporter's browser string (e.g. `navigator.userAgent`). */
  userAgent?: string;
}

/**
 * Build an `application/x-www-form-urlencoded`-style query, omitting empty
 * values and encoding spaces as `%20` (mail clients treat `+` literally, so
 * `URLSearchParams` is unsafe for `mailto:`).
 */
function buildQuery(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join('&');
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error == null) {
    return 'Unknown error';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

/**
 * Runtime contact context for bug reports. Returns empty fields outside a
 * browser so the calling builders remain usable (and testable) in Node.
 */
export function clientContext(): { page?: string; userAgent?: string } {
  if (typeof window === 'undefined') {
    return {};
  }

  return { page: window.location.href, userAgent: window.navigator.userAgent };
}

/** Build a `mailto:` link to the support inbox, omitting empty parameters. */
export function buildMailto({ subject, body }: MailtoParams = {}): string {
  const query = buildQuery({ subject, body });
  return query ? `mailto:${SUPPORT_EMAIL}?${query}` : `mailto:${SUPPORT_EMAIL}`;
}

/**
 * Build a prefilled "new issue" link for the project repository, labelled
 * `bug` and omitting empty title/body parameters.
 */
export function buildIssueUrl({ title, body }: IssueParams = {}): string {
  const query = buildQuery({ title, body, labels: 'bug' });
  return `${GITHUB_REPO_URL}/issues/new?${query}`;
}

/**
 * Build a bug-report body: free-text prompts for the reporter followed by a
 * technical block. The error/stack is truncated to {@link MAX_ERROR_CHARS}.
 */
export function buildBugContext({ operation, error, page, userAgent }: BugContextParams): string {
  const errorText = truncate(describeError(error), MAX_ERROR_CHARS);

  return [
    'What happened:',
    '',
    '',
    'Steps to reproduce:',
    '',
    '',
    '--- technical details (please keep) ---',
    `Operation: ${operation}`,
    `Error: ${errorText}`,
    `Page: ${page ?? ''}`,
    `Browser: ${userAgent ?? ''}`,
  ].join('\n');
}
