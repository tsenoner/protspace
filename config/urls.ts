/**
 * Centralized configuration for ProtSpace web application
 *
 * Single source of truth for all URLs, ports, and deployment settings.
 */

// Development server ports.
// Single source of truth: the app's Vite proxy (app/vite.config.ts) forwards `/docs` here, and the
// VitePress dev server reads `docs` from this constant (docs/.vitepress/config.mts) with
// `strictPort` so it fails loudly instead of silently bumping to a port the proxy can't reach.
export const PORTS = {
  app: 8080,
  docs: 5174,
} as const;

// Production domain
const PRODUCTION_DOMAIN = 'https://protspace.app';

// URL configuration for each environment
export const URLS = {
  production: {
    base: PRODUCTION_DOMAIN,
    docs: '/docs/',
    explore: '/explore',
  },
  development: {
    base: `http://localhost:${PORTS.app}`,
    // Use relative path in dev too - the Vite proxy handles routing to the docs server
    docs: '/docs/',
    explore: '/explore',
  },
} as const;

export type Environment = keyof typeof URLS;

/**
 * Get URLs for the specified environment
 */
export const getUrls = (mode: Environment) => URLS[mode];

/**
 * Construct full URL from base + path
 */
export const buildUrl = (mode: Environment, path: keyof typeof URLS.production) => {
  const urls = URLS[mode];
  if (path === 'base') return urls.base;
  return `${urls.base}${urls[path]}`;
};
