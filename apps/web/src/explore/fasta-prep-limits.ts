// Client-side mirror of the prep backend's hard limits (deploy config).
// The backend remains the source of truth; these enable fast, friendly
// pre-checks that avoid wasted uploads and rate-limit tokens.

/** Maximum accepted upload size in bytes (8 MiB). */
export const MAX_UPLOAD_BYTES = 8_388_608;

/** Minimum number of sequences the pipeline accepts. */
export const MIN_SEQUENCES = 20;

/** Maximum number of sequences the pipeline accepts. */
export const MAX_SEQUENCES = 1500;

/** Hard wall-clock timeout (seconds) the backend enforces on a prep job. */
export const PIPELINE_TIMEOUT_SECONDS = 420;

/** Human-readable rendering of {@link MAX_UPLOAD_BYTES} for UI messages. */
export const MAX_UPLOAD_LABEL = '8 MB';

/** Google Colab notebook that runs the same preparation pipeline in-browser. */
export const COLAB_NOTEBOOK_URL =
  'https://colab.research.google.com/github/tsenoner/protspace/blob/main/notebooks/ProtSpace_Preparation.ipynb';
