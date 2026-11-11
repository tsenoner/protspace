/**
 * The site's one theme choice, shared by Home, Explore and the docs (same origin, one key). The
 * key is VitePress's own: its head script reads it before the docs paint, and it is hard-coded
 * there, so the app adopts it rather than the other way round. Its raw values are VueUse's
 * useDark ones: 'dark' or 'light' for an override, 'auto' (or nothing) to follow the system.
 */
export const THEME_STORAGE_KEY = 'vitepress-theme-appearance';

/** The explore page's earlier key, with JSON-encoded "system" | "light" | "dark": migrated once. */
export const LEGACY_THEME_STORAGE_KEY = 'protspace:theme';

/**
 * Sets <html data-theme> before first paint, on every page of the app (apps/web/index.html) and of
 * the docs (docs/.vitepress/config.mts): 'dark' or 'light' for an override, else 'system', which
 * the tokens' media query follows. It first moves a value under the legacy key to the shared one,
 * unless the shared one is already set. It cannot import anything, so the app's index.html holds a
 * copy; theme-boot.test.ts pins the two together.
 */
export const THEME_BOOT_SCRIPT = `(function () {
  var key = '${THEME_STORAGE_KEY}';
  var legacyKey = '${LEGACY_THEME_STORAGE_KEY}';
  var theme = 'system';
  try {
    var legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      var override = legacy === '"dark"' || legacy === '"light"';
      if (override && localStorage.getItem(key) === null) {
        localStorage.setItem(key, legacy.slice(1, -1));
      }
      localStorage.removeItem(legacyKey);
    }
    var stored = localStorage.getItem(key);
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch (error) {
    // No storage (private mode, blocked site data): follow the system.
  }
  document.documentElement.setAttribute('data-theme', theme);
})();`;
