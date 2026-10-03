import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';
import { resolveExampleUrl } from './example-url';

describe('resolveExampleUrl', () => {
  it('roots a ./ URL at the app base, not the current route', () => {
    expect(resolveExampleUrl('./data.parquetbundle', '/')).toBe('/data.parquetbundle');
    expect(resolveExampleUrl('./data/5K.parquetbundle', '/')).toBe('/data/5K.parquetbundle');
  });

  it('honours a non-root base, with or without its trailing slash', () => {
    expect(resolveExampleUrl('./data/5K.parquetbundle', '/protspace/')).toBe(
      '/protspace/data/5K.parquetbundle',
    );
    expect(resolveExampleUrl('data/5K.parquetbundle', '/protspace')).toBe(
      '/protspace/data/5K.parquetbundle',
    );
  });

  it('leaves absolute URLs and root paths alone', () => {
    expect(resolveExampleUrl('https://protspace.app/data.parquetbundle', '/protspace/')).toBe(
      'https://protspace.app/data.parquetbundle',
    );
    expect(resolveExampleUrl('/data.parquetbundle', '/protspace/')).toBe('/data.parquetbundle');
    expect(resolveExampleUrl('blob:http://localhost/abc', '/')).toBe('blob:http://localhost/abc');
  });

  it('defaults to import.meta.env.BASE_URL', () => {
    expect(resolveExampleUrl('./data.parquetbundle')).toBe(
      `${import.meta.env.BASE_URL}data.parquetbundle`,
    );
  });

  // Under `/explore/` a page-relative catalog URL resolves to
  // `/explore/data…`, which the SPA fallback serves as HTML.
  it('keeps every catalog entry out of the /explore/ route', () => {
    const page = 'https://protspace.app/explore/';
    for (const entry of EXAMPLE_DATASETS) {
      const resolved = new URL(resolveExampleUrl(entry.url, '/'), page);
      expect(resolved.pathname.startsWith('/explore/')).toBe(false);
      expect(resolved.pathname).toBe(`/${entry.url.replace(/^\.\//, '')}`);
    }
  });
});
