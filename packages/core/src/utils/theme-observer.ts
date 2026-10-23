/**
 * Calls `onChange` when the page's theme may have changed: an attribute that themes `<html>`
 * (`data-theme`, `class`, `style`) changed, once per batch of mutations, or the OS colour scheme
 * flipped. The calls are raw, even for a `data-theme` re-set to the value it had or an OS flip
 * under an explicit theme: a consumer reads its tokens and compares them before it redraws
 * anything. Returns the function that stops watching.
 *
 * Attributes below `<html>` are not watched: the workbench's slide animates attributes on the
 * plot's ancestors, and nothing there sets the theme.
 */
export function observeTheme(onChange: () => void, doc: Document = document): () => void {
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => onChange());
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
  }
  const scheme =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => onChange();
  scheme?.addEventListener?.('change', onScheme);
  return () => {
    observer?.disconnect();
    scheme?.removeEventListener?.('change', onScheme);
  };
}
