import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureService, getBaseAccession } from './structure-service';

const prediction = {
  cifUrl: 'https://models.example/A0A0B4U9L8.cif',
  modelVersion: 'v6',
};

/** Stubs AlphaFold with an available structure; only the TED domains response varies. */
function stubFetch(domainsResponse: (init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/prediction/')) return Response.json([prediction]);
    if (url.includes('/api/domains/')) return domainsResponse(init);
    if (url === prediction.cifUrl) return new Response('data_AFDB_model');
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('StructureService TED domains', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:structure'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads valid TED domains and preserves discontinuous residue segments', async () => {
    const fetchMock = stubFetch(() =>
      Response.json({
        total: 2,
        annotations: [
          {
            ted_domain_no: 1,
            cath_label: '-',
            segments: [
              { af_start: 33, af_end: 42, segment_id: 1 },
              { af_start: 54, af_end: 76, segment_id: 2 },
              { af_start: 107, af_end: 160, segment_id: 3 },
            ],
          },
          {
            ted_domain_no: 2,
            cath_label: '3.40.390.10',
            segments: [{ af_start: 194, af_end: 396, segment_id: 1 }],
          },
        ],
      }),
    );

    const result = await StructureService.loadStructure('A0A0B4U9L8.1');

    expect(result.tedDomains).toEqual([
      {
        domainNumber: 1,
        segments: [
          { start: 33, end: 42 },
          { start: 54, end: 76 },
          { start: 107, end: 160 },
        ],
      },
      { domainNumber: 2, segments: [{ start: 194, end: 396 }] },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://alphafold.ebi.ac.uk/api/domains/A0A0B4U9L8', {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ['an unavailable response', new Response(null, { status: 503 })],
    [
      'malformed segments',
      Response.json({
        total: 1,
        annotations: [
          {
            ted_domain_no: 1,
            segments: [
              { af_start: 'not-a-number', af_end: 10 },
              { af_start: 90, af_end: 20 },
            ],
          },
        ],
      }),
    ],
  ])('keeps the structure available with no domains for %s', async (_label, domainResponse) => {
    stubFetch(() => domainResponse);

    await expect(StructureService.loadStructure('A0A0B4U9L8')).resolves.toMatchObject({
      url: 'blob:structure',
      tedDomains: [],
    });
  });

  it('does not request TED domains when there is no AlphaFold model', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(StructureService.loadStructure('Q8WZ42')).rejects.toThrow(
      'AlphaFold structure not available',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/prediction/');
  });

  it('aborts the TED request when the structure file download fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let tedSignal: AbortSignal | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/prediction/')) return Response.json([prediction]);
        if (url.includes('/api/domains/')) {
          tedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
          return new Promise<Response>(() => {});
        }
        return new Response(null, { status: 500 });
      }),
    );

    await expect(StructureService.loadStructure('A0A0B4U9L8')).rejects.toThrow(
      'AlphaFold structure not available',
    );
    expect(tedSignal?.aborted).toBe(true);
  });

  it('cancels every request when the caller aborts the load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const signals: (AbortSignal | undefined)[] = [];
    const caller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        if (String(input).includes('/api/prediction/')) return Response.json([prediction]);
        // Like real fetch: the domains and structure requests settle only when aborted
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );

    const load = StructureService.loadStructure('A0A0B4U9L8', caller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(3));
    caller.abort();

    await expect(load).rejects.toThrow('AlphaFold structure not available');
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the structure available when the TED request never settles', async () => {
    vi.useFakeTimers();
    let tedSignal: AbortSignal | null = null;
    stubFetch((init) => {
      tedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
      // Like real fetch: settles only when aborted
      return new Promise<Response>((_resolve, reject) => {
        tedSignal?.addEventListener('abort', () => reject(tedSignal?.reason));
      });
    });

    let result: Awaited<ReturnType<typeof StructureService.loadStructure>> | undefined;
    void StructureService.loadStructure('A0A0B4U9L8').then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toMatchObject({ url: 'blob:structure', tedDomains: [] });
    expect(tedSignal?.aborted).toBe(true);
  });
});

describe('getBaseAccession', () => {
  it('returns the ID unchanged when there is no dot', () => {
    expect(getBaseAccession('P0DQE9')).toBe('P0DQE9');
  });

  it('strips the version suffix after the first dot', () => {
    expect(getBaseAccession('P0DQE9.2')).toBe('P0DQE9');
  });

  it('handles multiple dots by splitting on the first one', () => {
    expect(getBaseAccession('A0A.1.2')).toBe('A0A');
  });

  it('handles an empty string', () => {
    expect(getBaseAccession('')).toBe('');
  });
});
