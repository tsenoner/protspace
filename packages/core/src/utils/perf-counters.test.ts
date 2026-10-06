import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerfCounters } from './perf-counters';

type Exposed = { __protspacePerfCounters?: Record<string, number> };

async function loadWithUrl(search: string | null) {
  vi.resetModules();
  if (search !== null) {
    vi.stubGlobal('window', {} as Exposed);
    vi.stubGlobal('location', { search });
  }
  return (await import('./perf-counters')).perfCounters;
}

describe('perfCounters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null outside a browser', async () => {
    expect(await loadWithUrl(null)).toBeNull();
  });

  it('is null without the URL flag, and exposes nothing', async () => {
    expect(await loadWithUrl('?annotation=ec')).toBeNull();
    expect((window as unknown as Exposed).__protspacePerfCounters).toBeUndefined();
  });

  it('starts at zero with the flag and is the object the page exposes', async () => {
    const counters = await loadWithUrl('?perfCounters=1');
    expect(counters).not.toBeNull();
    expect(Object.values(counters!).every((v) => v === 0)).toBe(true);
    counters!.restage++;
    counters!.restage++;
    expect((window as unknown as Exposed).__protspacePerfCounters?.restage).toBe(2);
  });
});

describe('createPerfCounters', () => {
  it('returns a new zeroed set on every call', () => {
    createPerfCounters().restage++;
    expect(Object.values(createPerfCounters()).every((v) => v === 0)).toBe(true);
  });
});
