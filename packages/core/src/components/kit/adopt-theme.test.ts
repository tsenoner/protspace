/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { theme } from '../../styles/theme';
import { adoptTheme } from './adopt-theme';

function themeTextIn(doc: Document): string {
  const adopted = (doc.adoptedStyleSheets ?? []).flatMap((s) =>
    [...s.cssRules].map((r) => r.cssText),
  );
  const styles = [...doc.querySelectorAll('style[data-ps-theme]')].map((s) => s.textContent ?? '');
  return [...adopted, ...styles].join('\n');
}

describe('adoptTheme', () => {
  it('adds the token sheet to a document exactly once', () => {
    const doc = document.implementation.createHTMLDocument('probe');
    adoptTheme(doc);
    adoptTheme(doc);
    const copies =
      doc.querySelectorAll('style[data-ps-theme]').length + (doc.adoptedStyleSheets?.length ?? 0);
    expect(copies).toBe(1);
    expect(themeTextIn(doc)).toContain('--ps-surface');
  });
});

describe('theme', () => {
  it('puts light values on :root and dark values under data-theme="dark" and system', () => {
    const text = theme.cssText;
    expect(text).toMatch(/:root\s*\{[^}]*--ps-surface:\s*#ffffff/);
    expect(text).toMatch(/:root\[data-theme='dark'\]\s*\{[^}]*--ps-surface:\s*#0f172a/);
    expect(text).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme='system'\]/,
    );
  });
});
