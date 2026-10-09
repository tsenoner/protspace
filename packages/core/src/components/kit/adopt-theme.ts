import { theme } from '../../styles/theme';

const adopted = new WeakSet<Document>();

/**
 * Adds the token sheet to a document, once. It uses a constructable stylesheet where the browser
 * has them, and a <style data-ps-theme> element otherwise (jsdom). Adopted sheets sort after the
 * page's own stylesheets, so a page overrides a token with a more specific selector, for example
 * `:root:root { --ps-accent: … }`.
 */
export function adoptTheme(doc: Document = document): void {
  if (adopted.has(doc)) return;
  adopted.add(doc);
  const sheet = theme.styleSheet;
  if (sheet && 'adoptedStyleSheets' in doc) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return;
  }
  const style = doc.createElement('style');
  style.dataset.psTheme = '';
  style.textContent = theme.cssText;
  doc.head.append(style);
}
