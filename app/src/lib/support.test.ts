import { describe, expect, it } from 'vitest';
import {
  GITHUB_REPO_URL,
  MAX_ERROR_CHARS,
  SUPPORT_EMAIL,
  buildBugContext,
  buildIssueUrl,
  buildMailto,
} from './support';

describe('buildMailto', () => {
  it('targets the support inbox and encodes subject and body', () => {
    const href = buildMailto({ subject: 'A subject', body: 'line one\nline two' });

    expect(href).toBe(`mailto:${SUPPORT_EMAIL}?subject=A%20subject&body=line%20one%0Aline%20two`);
  });

  it('encodes spaces as %20 rather than +', () => {
    expect(buildMailto({ subject: 'two words' })).toContain('subject=two%20words');
  });

  it('omits empty parameters and works with no arguments', () => {
    expect(buildMailto({ subject: 'Hello', body: '' })).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=Hello`,
    );
    expect(buildMailto()).toBe(`mailto:${SUPPORT_EMAIL}`);
  });
});

describe('buildIssueUrl', () => {
  it('targets the repository issue endpoint with a bug label', () => {
    const href = buildIssueUrl({ title: 'Crash', body: 'details' });

    expect(href).toBe(`${GITHUB_REPO_URL}/issues/new?title=Crash&body=details&labels=bug`);
  });

  it('omits empty title/body but keeps the label', () => {
    expect(buildIssueUrl()).toBe(`${GITHUB_REPO_URL}/issues/new?labels=bug`);
  });
});

describe('buildBugContext', () => {
  it('includes the operation, error, page, and browser in a technical block', () => {
    const body = buildBugContext({
      operation: 'Export',
      error: new Error('boom'),
      page: 'https://protspace.app/explore',
      userAgent: 'TestAgent/1.0',
    });

    expect(body).toContain('What happened:');
    expect(body).toContain('Steps to reproduce:');
    expect(body).toContain('Operation: Export');
    expect(body).toContain('boom');
    expect(body).toContain('Page: https://protspace.app/explore');
    expect(body).toContain('Browser: TestAgent/1.0');
  });

  it('truncates long error text below the cap', () => {
    const error = new Error('x'.repeat(5_000));
    const body = buildBugContext({ operation: 'Crash', error });

    const errorLine = body.split('\n').find((line) => line.startsWith('Error: '));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('(truncated)');
    // Error payload (after the "Error: " prefix) stays within the cap + marker.
    expect((errorLine as string).length).toBeLessThan(MAX_ERROR_CHARS + 40);
  });

  it('tolerates non-Error values without throwing', () => {
    expect(() => buildBugContext({ operation: 'Export', error: 'plain string' })).not.toThrow();
    expect(buildBugContext({ operation: 'Export', error: 'plain string' })).toContain(
      'Error: plain string',
    );
    expect(buildBugContext({ operation: 'Export', error: undefined })).toContain(
      'Error: Unknown error',
    );
  });
});
