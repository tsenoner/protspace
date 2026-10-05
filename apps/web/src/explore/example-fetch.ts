import type { ExampleDataset } from './example-datasets';
import { resolveExampleUrl } from './example-url';

/**
 * A response that holds the bundle: OK, and not the HTML page a dev or
 * preview server answers with for a path it has no file for.
 */
function holdsBundle(response: Response): boolean {
  return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
}

/**
 * Starts the download of an example's bundle, always from the app's own
 * origin (`entry.url`, rooted at the app base by `resolveExampleUrl` so a
 * trailing-slash `/explore/` route cannot turn it into a request for the
 * route's own HTML).
 *
 * A development build is the one exception. Release-hosted bundles are not in
 * the repository, and the dev server only has them after `pnpm
 * examples:fetch`, so when the same-origin file is missing a development
 * build fetches it from protspace.app instead (`entry.devFallbackUrl`, which
 * sends `access-control-allow-origin: *`). A production build never leaves
 * its origin.
 */
export async function fetchExampleBundle(
  entry: Pick<ExampleDataset, 'url' | 'devFallbackUrl'>,
  signal: AbortSignal,
  development: boolean = import.meta.env.DEV,
): Promise<Response> {
  const url = resolveExampleUrl(entry.url);
  const response = await fetch(url, { signal });
  if (!development || !entry.devFallbackUrl || holdsBundle(response)) {
    return response;
  }
  void response.body?.cancel().catch(() => {});
  const fallbackUrl = resolveExampleUrl(entry.devFallbackUrl);
  console.warn(
    `${url} is not served locally (run \`pnpm examples:fetch\`); fetching ${fallbackUrl} instead.`,
  );
  return fetch(fallbackUrl, { signal });
}
