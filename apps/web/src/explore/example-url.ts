const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/)/i;

/**
 * The URL to fetch an example bundle from.
 *
 * Catalog URLs are relative (`./data.parquetbundle`, `./examples/…`), and
 * `fetch` resolves a relative URL against the page, not the app: under
 * `/explore/` (trailing slash) `./data.parquetbundle` becomes
 * `/explore/data.parquetbundle`, which the SPA
 * fallback answers with the app's HTML, so the bundle never loads. A relative
 * URL is therefore rooted at the app base (`import.meta.env.BASE_URL`); an
 * absolute one (another origin, or a root path) is returned unchanged.
 */
export function resolveExampleUrl(url: string, base: string = import.meta.env.BASE_URL): string {
  if (ABSOLUTE_URL.test(url)) {
    return url;
  }
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${url.replace(/^\.\//, '')}`;
}
