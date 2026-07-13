import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareFastaBundle, isFastaFile, FastaPrepError } from './fasta-prep-client';

/** Drain all pending microtasks (works across multiple async hops). */
const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly handlers = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;
  readyState = MockEventSource.OPEN;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (ev: MessageEvent) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }
  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const h of this.handlers.get(type) ?? []) h(ev);
  }
  /** Emit a raw frame whose `.data` is set verbatim (e.g. malformed JSON). */
  emitRaw(type: string, data: string | undefined) {
    const ev = new MessageEvent(type, { data });
    for (const h of this.handlers.get(type) ?? []) h(ev);
  }
  /** Simulate a payload-less connection error at a given readyState. */
  emitConnectionError(readyState: number) {
    this.readyState = readyState;
    const ev = new MessageEvent('error', {});
    for (const h of this.handlers.get('error') ?? []) h(ev);
  }
  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('isFastaFile', () => {
  it('matches common FASTA extensions case-insensitively', () => {
    expect(isFastaFile(new File([], 'x.fasta'))).toBe(true);
    expect(isFastaFile(new File([], 'x.FA'))).toBe(true);
    expect(isFastaFile(new File([], 'x.fna'))).toBe(true);
    expect(isFastaFile(new File([], 'x.parquetbundle'))).toBe(false);
  });
});

describe('prepareFastaBundle', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads the file, streams progress, and resolves with the downloaded bundle', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      if (url.endsWith('/api/prepare/abc/bundle')) {
        return new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const stages: string[] = [];
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, {
      baseUrl: '',
      onProgress: (stage) => stages.push(stage),
    });

    await flushPromises();
    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();
    es.emit('queued', { job_id: 'abc' });
    es.emit('progress', { stage: 'embedding' });
    es.emit('progress', { stage: 'projecting' });
    es.emit('done', { download_url: '/api/prepare/abc/bundle' });

    const bundle = await promise;
    expect(bundle.name).toBe('seq.parquetbundle');
    expect(stages).toEqual(['queued', 'embedding', 'projecting']);
    expect(es.closed).toBe(true);
  });

  it('removes the abort listener after the SSE stream resolves', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      if (url.endsWith('/api/prepare/abc/bundle')) {
        return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '', signal: controller.signal });

    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emit('done', { download_url: '/api/prepare/abc/bundle' });
    await promise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects when the server emits an error event', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });
    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emit('error', { message: 'Biocentral 503' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/Biocentral 503/);
    expect((error as FastaPrepError).code).toBeUndefined();
    // Falls back to the job id we already hold when the payload omits it.
    expect((error as FastaPrepError).jobId).toBe('abc');
    expect(es.closed).toBe(true);
  });

  it('surfaces the job_id from the error payload as a reportable reference', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });
    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emit('error', { message: 'boom', job_id: 'job-from-payload' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).jobId).toBe('job-from-payload');
  });

  it('attaches the error code from the server payload to FastaPrepError', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });
    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emit('error', { message: 'down', code: 'BIOCENTRAL_UNAVAILABLE' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).code).toBe('BIOCENTRAL_UNAVAILABLE');
  });

  it('wraps submit failures in FastaPrepError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const error = await prepareFastaBundle(file, { baseUrl: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
  });

  it('surfaces a friendly message with Retry-After when the server returns 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': '90' },
          }),
      ),
    );
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    await expect(prepareFastaBundle(file, { baseUrl: '' })).rejects.toThrow(
      /Too many upload attempts.*try again in 2 minutes\./,
    );
  });

  it('falls back to a generic rate-limit message when Retry-After is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    await expect(prepareFastaBundle(file, { baseUrl: '' })).rejects.toThrow(
      /Too many upload attempts.*wait a few minutes/,
    );
  });

  it('rejects when POST returns a 400 with code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'too big', code: 'FILE_TOO_LARGE' }), {
            status: 400,
          }),
      ),
    );
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    await expect(prepareFastaBundle(file, { baseUrl: '' })).rejects.toThrow(/too big/);
  });

  // --- B1: transient SSE errors must not kill a still-running job ---

  it('does NOT reject on a transient connection drop while the browser reconnects', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      if (url.endsWith('/api/prepare/abc/bundle')) {
        return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    let settled = false;
    const promise = prepareFastaBundle(file, { baseUrl: '' }).then(
      (v) => {
        settled = true;
        return v;
      },
      (e) => {
        settled = true;
        throw e;
      },
    );

    await flushPromises();
    const es = MockEventSource.instances[0];

    // Transient drops: browser is auto-reconnecting (CONNECTING), no payload.
    es.emitConnectionError(MockEventSource.CONNECTING);
    es.emitConnectionError(MockEventSource.CONNECTING);
    await flushPromises();
    expect(settled).toBe(false);
    expect(es.closed).toBe(false);

    // Recovery: a real frame arrives and resets the budget, then completes.
    es.emit('progress', { stage: 'embedding' });
    es.emit('done', { download_url: '/api/prepare/abc/bundle' });

    const bundle = await promise;
    expect(bundle.name).toBe('seq.parquetbundle');
  });

  it('rejects once the reconnect budget is exhausted', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });

    await flushPromises();
    const es = MockEventSource.instances[0];

    // 5 attempts are tolerated; the 6th exhausts the budget.
    for (let i = 0; i < 6; i++) {
      es.emitConnectionError(MockEventSource.CONNECTING);
    }

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/lost connection/i);
    expect((error as FastaPrepError).jobId).toBe('abc');
    expect(es.closed).toBe(true);
  });

  it('rejects immediately when the connection closes permanently (no payload)', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });

    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emitConnectionError(MockEventSource.CLOSED);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/lost connection/i);
    expect((error as FastaPrepError).jobId).toBe('abc');
    expect(es.closed).toBe(true);
  });

  // --- B2: harden frame parsing ---

  it('ignores malformed progress/queued frames instead of hanging the job', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      if (url.endsWith('/api/prepare/abc/bundle')) {
        return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const stages: string[] = [];
    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '', onProgress: (s) => stages.push(s) });

    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emitRaw('queued', '{not json');
    es.emitRaw('progress', 'garbage');
    es.emit('progress', { stage: 'embedding' });
    es.emit('done', { download_url: '/api/prepare/abc/bundle' });

    const bundle = await promise;
    expect(bundle.name).toBe('seq.parquetbundle');
    // Only the well-formed frame produced a progress callback.
    expect(stages).toEqual(['embedding']);
  });

  it('rejects with a protocol error when done carries no download_url', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });

    await flushPromises();
    const es = MockEventSource.instances[0];
    es.emit('done', { download_url: '' });

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/protocol error/i);
    expect((error as FastaPrepError).jobId).toBe('abc');
    expect(es.closed).toBe(true);
  });

  // --- B3: bundle-download status code mapping ---

  it('maps a 410 bundle download to an expired/consumed message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      return new Response('gone', { status: 410 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });
    await flushPromises();
    MockEventSource.instances[0].emit('done', { download_url: '/api/prepare/abc/bundle' });

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/expired or was already downloaded/i);
    expect((error as FastaPrepError).jobId).toBe('abc');
  });

  it('maps a 409 bundle download to a not-finished-yet message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'POST' && url.endsWith('/api/prepare')) {
        return new Response(JSON.stringify({ job_id: 'abc' }), { status: 202 });
      }
      return new Response('not ready', { status: 409 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0])], 'seq.fasta');
    const promise = prepareFastaBundle(file, { baseUrl: '' });
    await flushPromises();
    MockEventSource.instances[0].emit('done', { download_url: '/api/prepare/abc/bundle' });

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FastaPrepError);
    expect((error as FastaPrepError).message).toMatch(/isn't finished yet/i);
    expect((error as FastaPrepError).jobId).toBe('abc');
  });
});
