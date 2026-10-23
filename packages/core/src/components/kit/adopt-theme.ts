import { theme } from '../../styles/theme';

const adopted = new WeakSet<Document>();

/**
 * Adds the token sheet to a document, once. It uses a constructable stylesheet where the browser
 * has them, and a <style data-ps-theme> element otherwise (jsdom, or a document with no window).
 * A constructed sheet adopts only into its own window's document, so the main document gets Lit's
 * sheet and any other document (an iframe) gets one built by its own window. The tokens sit in the
 * `ps-theme` cascade layer, so any unlayered page rule, even `:root { --ps-accent: … }`, overrides
 * a token in both themes; a rule inside another layer (Tailwind's `@layer base`) does not.
 */
export function adoptTheme(doc: Document = document): void {
  if (adopted.has(doc)) return;
  const Sheet = doc.defaultView?.CSSStyleSheet;
  if (Sheet && 'adoptedStyleSheets' in doc) {
    let sheet = doc === document ? theme.styleSheet : undefined;
    if (!sheet) {
      sheet = new Sheet();
      sheet.replaceSync(theme.cssText);
    }
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement('style');
    style.dataset.psTheme = '';
    style.textContent = theme.cssText;
    doc.head.append(style);
  }
  adopted.add(doc);
}
