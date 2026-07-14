const STORE_DIRECTORY_NAME = 'protspace-last-import';
const DATA_FILENAME = 'dataset.bin';
const METADATA_FILENAME = 'metadata.json';
const SCHEMA_VERSION = 2;

/** @public */
export type LastLoadStatus = 'pending' | 'success' | 'error';

interface StoredDatasetMetadata {
  schemaVersion: number;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  storedAt: string;
  lastLoadStatus: LastLoadStatus;
  lastError?: string;
  failedAttempts: number;
}

export class StoredDatasetCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredDatasetCorruptError';
  }
}

function hasStorageDirectoryApi(storage: StorageManager | undefined): storage is StorageManager & {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
} {
  return typeof storage?.getDirectory === 'function';
}

async function getRootDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !hasStorageDirectoryApi(navigator.storage)) {
    return null;
  }

  return navigator.storage.getDirectory();
}

async function getStoreDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await getRootDirectory();
  if (!root) {
    return null;
  }

  try {
    return await root.getDirectoryHandle(STORE_DIRECTORY_NAME, { create });
  } catch {
    return null;
  }
}

function isValidMetadata(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (typeof m.name !== 'string') return false;
  if (typeof m.type !== 'string') return false;
  if (typeof m.size !== 'number') return false;
  if (typeof m.lastModified !== 'number') return false;
  if (typeof m.storedAt !== 'string') return false;
  if (m.schemaVersion !== 1 && m.schemaVersion !== 2) return false;
  return true;
}

function migrateMetadata(raw: Record<string, unknown>): StoredDatasetMetadata {
  if (raw.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      name: String(raw.name),
      type: String(raw.type),
      size: Number(raw.size),
      lastModified: Number(raw.lastModified),
      storedAt: String(raw.storedAt),
      lastLoadStatus:
        raw.lastLoadStatus === 'pending' ||
        raw.lastLoadStatus === 'success' ||
        raw.lastLoadStatus === 'error'
          ? raw.lastLoadStatus
          : 'success',
      lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
      failedAttempts:
        typeof raw.failedAttempts === 'number' && raw.failedAttempts >= 0 ? raw.failedAttempts : 0,
    };
  }
  // v1 had no failure tracking, so anyone with v1 metadata necessarily
  // loaded successfully under prior versions — default to 'success'.
  return {
    schemaVersion: 2,
    name: String(raw.name),
    type: String(raw.type),
    size: Number(raw.size),
    lastModified: Number(raw.lastModified),
    storedAt: String(raw.storedAt),
    lastLoadStatus: 'success',
    failedAttempts: 0,
  };
}

async function readMetadata(): Promise<StoredDatasetMetadata | null> {
  const directory = await getStoreDirectory(false);
  if (!directory) return null;

  let metadataText: string;
  try {
    const handle = await directory.getFileHandle(METADATA_FILENAME);
    metadataText = await (await handle.getFile()).text();
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataText);
  } catch {
    await clearStoreDirectory();
    throw new StoredDatasetCorruptError('Stored dataset metadata could not be parsed.');
  }

  if (!isValidMetadata(parsed)) {
    await clearStoreDirectory();
    throw new StoredDatasetCorruptError('Stored dataset metadata is invalid.');
  }

  return migrateMetadata(parsed);
}

async function writeMetadata(
  directory: FileSystemDirectoryHandle,
  metadata: StoredDatasetMetadata,
): Promise<void> {
  await writeTextFile(directory, METADATA_FILENAME, JSON.stringify(metadata));
}

async function writeTextFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  content: string,
): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBlobFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  content: Blob,
): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function clearStoreDirectory(): Promise<void> {
  const root = await getRootDirectory();
  if (!root) {
    return;
  }

  try {
    await root.removeEntry(STORE_DIRECTORY_NAME, { recursive: true });
  } catch {
    // Directory may not exist yet.
  }
}

function buildSupportError(): Error {
  return new Error('Origin Private File System is not supported in this browser.');
}

export function isSupported(): boolean {
  return typeof navigator !== 'undefined' && hasStorageDirectoryApi(navigator.storage);
}

export async function saveLastImportedFile(file: File): Promise<void> {
  if (!isSupported()) {
    throw buildSupportError();
  }

  const directory = await getStoreDirectory(true);
  if (!directory) {
    throw new Error('Unable to access the Origin Private File System.');
  }

  const metadata: StoredDatasetMetadata = {
    schemaVersion: SCHEMA_VERSION,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    storedAt: new Date().toISOString(),
    lastLoadStatus: 'pending',
    failedAttempts: 0,
  };

  try {
    await writeBlobFile(directory, DATA_FILENAME, file);
    await writeMetadata(directory, metadata);
  } catch (error) {
    await clearStoreDirectory();
    throw error instanceof Error ? error : new Error('Failed to save imported dataset.');
  }
}

export async function loadLastImportedFile(): Promise<File | null> {
  if (!isSupported()) {
    return null;
  }

  const directory = await getStoreDirectory(false);
  if (!directory) {
    return null;
  }

  let metadata: StoredDatasetMetadata | null;
  try {
    metadata = await readMetadata();
  } catch (error) {
    if (error instanceof StoredDatasetCorruptError) {
      throw error;
    }
    return null;
  }

  if (!metadata) {
    await clearStoreDirectory();
    return null;
  }

  try {
    const dataHandle = await directory.getFileHandle(DATA_FILENAME);
    const storedFile = await dataHandle.getFile();
    return new File([storedFile], metadata.name, {
      type: metadata.type,
      lastModified: metadata.lastModified,
    });
  } catch {
    await clearStoreDirectory();
    return null;
  }
}

/**
 * Update the persisted load status. Single-tab assumption: this is a non-atomic
 * read-modify-write; concurrent writers from multiple tabs could race and lose a
 * counter increment. Acceptable today because the dataset-controller dispatches
 * load lifecycle events sequentially within one tab.
 */
export async function markLastLoadStatus(
  status: LastLoadStatus,
  options?: { error?: string },
): Promise<void> {
  const directory = await getStoreDirectory(false);
  if (!directory) return;

  let current: StoredDatasetMetadata | null = null;
  try {
    current = await readMetadata();
  } catch {
    return;
  }
  if (!current) return;

  // failedAttempts tracks consecutive unfinalized loads (a streak counter):
  // - success: reset to 0
  // - pending: increment only if the previous status was already pending
  //   (i.e., a prior load was never finalized); a success→pending transition
  //   means the user is retrying a healthy dataset and must not inflate the count
  // - error: increment unconditionally (every error extends the failure streak)
  let failedAttempts: number;
  if (status === 'success') {
    failedAttempts = 0;
  } else if (status === 'pending') {
    failedAttempts =
      current.lastLoadStatus === 'pending' ? current.failedAttempts + 1 : current.failedAttempts;
  } else {
    // error
    failedAttempts = current.failedAttempts + 1;
  }

  const next: StoredDatasetMetadata = {
    ...current,
    lastLoadStatus: status,
    lastError: status === 'error' ? options?.error : undefined,
    failedAttempts,
  };

  await writeMetadata(directory, next);
}

export async function readLastLoadStatus(): Promise<{
  status: LastLoadStatus;
  lastError?: string;
  failedAttempts: number;
} | null> {
  const metadata = await readMetadata();
  if (!metadata) return null;
  return {
    status: metadata.lastLoadStatus,
    lastError: metadata.lastError,
    failedAttempts: metadata.failedAttempts,
  };
}

export async function clearLastImportedFile(): Promise<void> {
  await clearStoreDirectory();
}
