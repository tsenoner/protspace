import { describe, expect, it } from 'vitest';
import { ErrorBoundary, buildCrashLinks } from './ErrorBoundary';

// The project's Vitest harness runs in Node without a DOM, so this exercises
// the boundary's error-capture logic and its (pure) report-link builder rather
// than a full render.

describe('ErrorBoundary.getDerivedStateFromError', () => {
  it('flags the error state when a child throws', () => {
    const error = new Error('render boom');

    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({
      hasError: true,
      error,
    });
  });
});

describe('buildCrashLinks', () => {
  it('produces a prefilled mailto and GitHub-issue link carrying context', () => {
    const { mailtoHref, issueHref } = buildCrashLinks(
      new Error('render boom'),
      'https://protspace.app/explore',
      'TestAgent/1.0',
    );

    expect(mailtoHref).toMatch(/^mailto:hello@protspace\.app\?/);
    expect(mailtoHref).toContain('subject=%5BBug%5D%20App%20crashed');
    expect(mailtoHref).toContain('render%20boom');
    expect(mailtoHref).toContain(encodeURIComponent('https://protspace.app/explore'));

    expect(issueHref).toMatch(/\/issues\/new\?/);
    expect(issueHref).toContain('labels=bug');
    expect(issueHref).toContain('render%20boom');
  });
});
