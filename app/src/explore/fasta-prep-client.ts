import { MAX_UPLOAD_LABEL } from './fasta-prep-limits';

const FASTA_EXT_PATTERN = /\.(fa|fasta|fna)$/i;

/**
 * Maximum number of consecutive EventSource auto-reconnect attempts before we
 * give up on a job. A transient blip resets the counter on the next frame, so
 * this only fires when the connection is genuinely lost.
 */
const MAX_RECONNECT_ATTEMPTS = 5;

export class FastaPrepError extends Error {
  readonly code?: string;
  /** Server-side job reference; quote this when reporting a failed preparation. */
  readonly jobId?: string;
  constructor(message: string, options?: { code?: string; jobId?: string }) {
    super(message);
    this.name = 'FastaPrepError';
    this.code = options?.code;
    this.jobId = options?.jobId;
  }
}

export function isFastaFile(file: File): boolean {
  return FASTA_EXT_PATTERN.test(file.name);
}

function formatRetryAfter(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    const diff = Math.max(0, dateMs - Date.now());
    return formatRetryAfter(String(Math.ceil(diff / 1000)));
  }
  return null;
}

async function describeSubmitFailure(response: Response): Promise<string> {
  let serverMessage: string | undefined;
  try {
    const body = await response.json();
    if (body?.error) serverMessage = String(body.error);
  } catch {
    /* non-JSON body (e.g. plain-text 429 from the rate limiter) */
  }

  switch (response.status) {
    case 429: {
      const wait = formatRetryAfter(response.headers.get('Retry-After'));
      const base = 'Too many upload attempts. The server is rate-limiting submissions';
      return wait
        ? `${base} — try again in ${wait}.`
        : `${base}; please wait a few minutes and try again.`;
    }
    case 413:
      return (
        serverMessage ?? `FASTA file is too large for the prep backend (max ${MAX_UPLOAD_LABEL}).`
      );
    case 503:
      return serverMessage ?? 'Prep backend is busy or unavailable. Please try again shortly.';
    case 504:
      return serverMessage ?? 'Prep backend timed out before responding. Please try again.';
    default:
      return serverMessage ?? `Upload failed (HTTP ${response.status}).`;
  }
}

function describeBundleFailure(status: number): string {
  switch (status) {
    case 410:
      return 'This result has expired or was already downloaded — please re-run the preparation.';
    case 409:
      return "The preparation isn't finished yet — please retry in a moment.";
    default:
      return `Bundle download failed (${status}).`;
  }
}

/** @public */
export type FastaPrepStage =
  | 'queued'
  | 'embedding'
  | 'projecting'
  | 'annotating'
  | 'bundling'
  | 'computing_statistics';

/** @public */
export interface FastaPrepOptions {
  baseUrl?: string;
  onProgress?: (stage: FastaPrepStage, payload: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

export async function prepareFastaBundle(
  file: File,
  options: FastaPrepOptions = {},
): Promise<File> {
  const baseUrl = options.baseUrl ?? '';
  const formData = new FormData();
  formData.append('file', file);

  const submitResponse = await fetch(`${baseUrl}/api/prepare`, {
    method: 'POST',
    body: formData,
    signal: options.signal,
  });

  if (!submitResponse.ok) {
    throw new FastaPrepError(await describeSubmitFailure(submitResponse));
  }

  const { job_id: jobId } = (await submitResponse.json()) as { job_id: string };

  const downloadUrl = await new Promise<string>((resolve, reject) => {
    const es = new EventSource(`${baseUrl}/api/prepare/${jobId}/events`);
    const cleanup = () => {
      es.close();
      options.signal?.removeEventListener('abort', abortHandler);
    };
    const abortHandler = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    options.signal?.addEventListener('abort', abortHandler);

    // Consecutive auto-reconnect attempts since the last successfully
    // received frame. Any parseable frame resets it to zero.
    let reconnectAttempts = 0;

    const handleProgress = (stage: FastaPrepStage, payload: Record<string, unknown>) => {
      try {
        options.onProgress?.(stage, payload);
      } catch (err) {
        console.error('fasta-prep onProgress threw:', err);
      }
    };

    // Shared guard for the progress-bearing frames: a malformed frame must not
    // throw inside dispatch (which would silently hang the job). Returns the
    // parsed object, or null when the frame is unusable (caller ignores it).
    const parseFrame = (ev: Event): Record<string, unknown> | null => {
      const data = (ev as MessageEvent).data;
      if (typeof data !== 'string' || !data) return null;
      try {
        return JSON.parse(data) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    es.addEventListener('queued', (ev) => {
      const payload = parseFrame(ev);
      if (!payload) return;
      reconnectAttempts = 0;
      handleProgress('queued', payload);
    });

    es.addEventListener('progress', (ev) => {
      const payload = parseFrame(ev);
      if (!payload) return;
      reconnectAttempts = 0;
      const stage = (payload.stage as FastaPrepStage) ?? 'embedding';
      handleProgress(stage, payload);
    });

    es.addEventListener('done', (ev) => {
      const payload = parseFrame(ev);
      const downloadUrl = payload?.download_url;
      if (typeof downloadUrl !== 'string' || !downloadUrl) {
        cleanup();
        reject(
          new FastaPrepError(
            'Prep backend reported completion without a download link (protocol error).',
            { jobId },
          ),
        );
        return;
      }
      cleanup();
      resolve(downloadUrl);
    });

    es.addEventListener('error', (ev) => {
      const data = (ev as MessageEvent).data;

      // Case 1: a server-sent terminal error frame carries a JSON payload.
      if (typeof data === 'string' && data) {
        let message = 'Bundle preparation failed.';
        let code: string | undefined;
        // Fall back to the job id we already hold so even a payload-less
        // connection error still carries a reportable reference.
        let errorJobId: string | undefined = jobId;
        try {
          const parsed = JSON.parse(data) as {
            message?: string;
            code?: string;
            job_id?: string;
          };
          if (parsed?.message) message = parsed.message;
          if (parsed?.code) code = parsed.code;
          if (parsed?.job_id) errorJobId = parsed.job_id;
        } catch {
          /* fall through to the connection-state handling below */
        }
        cleanup();
        reject(new FastaPrepError(message, { code, jobId: errorJobId }));
        return;
      }

      // Case 2: payload-less error. EventSource closed for good → permanent
      // failure; otherwise the browser is auto-reconnecting (CONNECTING) and we
      // let it, within a bounded budget so it can never hang forever.
      if (es.readyState === EventSource.CLOSED) {
        cleanup();
        reject(new FastaPrepError('Lost connection to the prep backend.', { jobId }));
        return;
      }

      reconnectAttempts += 1;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        cleanup();
        reject(
          new FastaPrepError(
            'Lost connection to the prep backend after repeated reconnect attempts.',
            { jobId },
          ),
        );
      }
      // else: still CONNECTING and within budget — let it reconnect.
    });
  });

  const bundleResponse = await fetch(`${baseUrl}${downloadUrl}`, { signal: options.signal });
  if (!bundleResponse.ok) {
    throw new FastaPrepError(describeBundleFailure(bundleResponse.status), { jobId });
  }
  const blob = await bundleResponse.blob();
  const stem = file.name.replace(FASTA_EXT_PATTERN, '');
  return new File([blob], `${stem}.parquetbundle`, { type: 'application/octet-stream' });
}
