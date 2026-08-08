import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureService } from './structure-service';

const prediction = {
  cifUrl: 'https://models.example/A0A0B4U9L8.cif',
  modelVersion: 'v6',
};

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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/prediction/')) {
        return Response.json([prediction]);
      }
      if (url.includes('/api/domains/')) {
        return Response.json({
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
        });
      }
      if (url === prediction.cifUrl) {
        return new Response('data_AFDB_model');
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/prediction/')) return Response.json([prediction]);
        if (url.includes('/api/domains/')) return domainResponse;
        if (url === prediction.cifUrl) return new Response('data_AFDB_model');
        return new Response(null, { status: 404 });
      }),
    );

    await expect(StructureService.loadStructure('A0A0B4U9L8')).resolves.toMatchObject({
      url: 'blob:structure',
      tedDomains: [],
    });
  });

  it('keeps the structure available when the TED request never settles', async () => {
    vi.useFakeTimers();
    let tedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/prediction/')) {
        return Promise.resolve(Response.json([prediction]));
      }
      if (url.includes('/api/domains/')) {
        tedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
        return new Promise<Response>(() => {});
      }
      if (url === prediction.cifUrl) {
        return Promise.resolve(new Response('data_AFDB_model'));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    let result: Awaited<ReturnType<typeof StructureService.loadStructure>> | undefined;
    void StructureService.loadStructure('A0A0B4U9L8').then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toMatchObject({ url: 'blob:structure', tedDomains: [] });
    expect(tedSignal?.aborted).toBe(true);
  });
});
