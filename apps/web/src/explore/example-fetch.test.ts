import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExampleBundle } from './example-fetch';

const RELEASE_HOSTED = {
  url: './examples/swissprot_2026_03.parquetbundle',
  devFallbackUrl: 'https://protspace.app/examples/swissprot_2026_03.parquetbundle',
};
const REPO_HOSTED = { url: './data.parquetbundle' };

function response(status: number, contentType = 'application/octet-stream'): Response {
  return new Response('bytes', {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('fetchExampleBundle', () => {
  const fetchMock = vi.fn();
  const signal = new AbortController().signal;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never leaves the origin in a production build, even when the file is missing', async () => {
    const notFound = response(404, 'text/html');
    fetchMock.mockResolvedValueOnce(notFound);

    await expect(fetchExampleBundle(RELEASE_HOSTED, signal, false)).resolves.toBe(notFound);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Rooted at the app base so /explore/ (trailing slash) still finds it.
    expect(fetchMock).toHaveBeenCalledWith('/examples/swissprot_2026_03.parquetbundle', { signal });
  });

  it('uses the local file in development when it is there', async () => {
    const found = response(200);
    fetchMock.mockResolvedValueOnce(found);

    await expect(fetchExampleBundle(RELEASE_HOSTED, signal, true)).resolves.toBe(found);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 404', response(404)],
    ['the HTML page a dev server serves for an unknown path', response(200, 'text/html')],
  ])('falls back to protspace.app in development on %s', async (_case, missing) => {
    const remote = response(200);
    fetchMock.mockResolvedValueOnce(missing).mockResolvedValueOnce(remote);

    await expect(fetchExampleBundle(RELEASE_HOSTED, signal, true)).resolves.toBe(remote);

    expect(fetchMock).toHaveBeenLastCalledWith(RELEASE_HOSTED.devFallbackUrl, { signal });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('pnpm examples:fetch'));
  });

  it('fetches a repo-hosted bundle from the app base too', async () => {
    fetchMock.mockResolvedValueOnce(response(200));

    await fetchExampleBundle(REPO_HOSTED, signal, false);

    expect(fetchMock).toHaveBeenCalledWith('/data.parquetbundle', { signal });
  });

  it('has no fallback for a repo-hosted bundle', async () => {
    const notFound = response(404);
    fetchMock.mockResolvedValueOnce(notFound);

    await expect(fetchExampleBundle(REPO_HOSTED, signal, true)).resolves.toBe(notFound);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
