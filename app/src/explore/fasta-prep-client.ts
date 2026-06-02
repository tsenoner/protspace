const FASTA_EXT_PATTERN = /\.(fa|fasta|fna)$/i;

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
      return serverMessage ?? 'FASTA file is too large for the prep backend (max 8 MB).';
    case 503:
      return serverMessage ?? 'Prep backend is busy or unavailable. Please try again shortly.';
    case 504:
      return serverMessage ?? 'Prep backend timed out before responding. Please try again.';
    default:
      return serverMessage ?? `Upload failed (HTTP ${response.status}).`;
  }
}

/** @public */
export type FastaPrepStage = 'queued' | 'embedding' | 'projecting' | 'annotating' | 'bundling';

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

    const handleProgress = (stage: FastaPrepStage, payload: Record<string, unknown>) => {
      try {
        options.onProgress?.(stage, payload);
      } catch (err) {
        console.error('fasta-prep onProgress threw:', err);
      }
    };

    es.addEventListener('queued', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
      handleProgress('queued', payload);
    });

    es.addEventListener('progress', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
      const stage = (payload.stage as FastaPrepStage) ?? 'embedding';
      handleProgress(stage, payload);
    });

    es.addEventListener('done', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as { download_url: string };
      cleanup();
      resolve(payload.download_url);
    });

    es.addEventListener('error', (ev) => {
      let message = 'Bundle preparation failed.';
      let code: string | undefined;
      // Fall back to the job id we already hold so even a payload-less
      // connection error still carries a reportable reference.
      let errorJobId: string | undefined = jobId;
      const data = (ev as MessageEvent).data;
      if (typeof data === 'string' && data) {
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
          /* connection error, no payload */
        }
      }
      cleanup();
      reject(new FastaPrepError(message, { code, jobId: errorJobId }));
    });
  });

  const bundleResponse = await fetch(`${baseUrl}${downloadUrl}`, { signal: options.signal });
  if (!bundleResponse.ok) {
    throw new FastaPrepError(`Bundle download failed (${bundleResponse.status}).`, {
      jobId,
    });
  }
  const blob = await bundleResponse.blob();
  const stem = file.name.replace(FASTA_EXT_PATTERN, '');
  return new File([blob], `${stem}.parquetbundle`, { type: 'application/octet-stream' });
}
