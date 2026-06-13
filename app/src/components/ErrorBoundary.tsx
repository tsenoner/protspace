import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { buildBugContext, buildIssueUrl, buildMailto } from '@/lib/support';

/**
 * Build the prefilled email and GitHub-issue links for a crash report. Pure so
 * it can be unit-tested without rendering; the component injects the page URL
 * and user agent at render time.
 */
export function buildCrashLinks(
  error: unknown,
  page?: string,
  userAgent?: string,
): { mailtoHref: string; issueHref: string } {
  const body = buildBugContext({ operation: 'app-crash', error, page, userAgent });

  return {
    mailtoHref: buildMailto({ subject: '[Bug] App crashed', body }),
    issueHref: buildIssueUrl({ title: '[Bug] App crashed', body }),
  };
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

/**
 * Top-level boundary that replaces a blank screen on a render-time crash with a
 * recovery fallback offering Reload, a prefilled support email, and a prefilled
 * GitHub issue.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('ProtSpace crashed:', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const page = typeof window !== 'undefined' ? window.location.href : undefined;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
    const { mailtoHref, issueHref } = buildCrashLinks(this.state.error, page, userAgent);

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="mb-3 text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mb-6 text-muted-foreground">
            ProtSpace hit an unexpected error. Reloading often helps. If it keeps happening, let us
            know — the report is prefilled with technical details.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={this.handleReload}>Reload</Button>
            <Button variant="outline" asChild>
              <a href={mailtoHref}>Email us</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={issueHref} target="_blank" rel="noopener noreferrer">
                Open a GitHub issue
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
