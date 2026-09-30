import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  isSupported,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
  saveLastImportedFile,
} from './opfs-dataset-store';

class MockWritableFileStream {
  private chunks: BlobPart[] = [];
  private onClose: (blob: Blob) => void;

  constructor(onClose: (blob: Blob) => void) {
    this.onClose = onClose;
  }

  async write(data: BlobPart) {
    this.chunks.push(data);
  }

  async close() {
    this.onClose(new Blob(this.chunks));
  }
}

class MockFileHandle {
  private blob: Blob;
  private name: string;

  constructor(name: string, blob: Blob = new Blob()) {
    this.name = name;
    this.blob = blob;
  }

  async getFile() {
    return new File([this.blob], this.name);
  }

  async createWritable() {
    return new MockWritableFileStream((blob) => {
      this.blob = blob;
    });
  }
}

class MockDirectoryHandle {
  private directories = new Map<string, MockDirectoryHandle>();
  private files = new Map<string, MockFileHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }

    if (!options?.create) {
      throw new Error(`Directory not found: ${name}`);
    }

    const directory = new MockDirectoryHandle();
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }

    if (!options?.create) {
      throw new Error(`File not found: ${name}`);
    }

    const file = new MockFileHandle(name);
    this.files.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    if (this.directories.delete(name)) {
      return;
    }

    if (this.files.delete(name)) {
      return;
    }

    throw new Error(`Entry not found: ${name}`);
  }

  hasDirectory(name: string) {
    return this.directories.has(name);
  }

  async writeTextFile(name: string, content: string) {
    const file = await this.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

function stubNavigator(rootDirectory?: MockDirectoryHandle) {
  if (!rootDirectory) {
    vi.stubGlobal('navigator', {});
    return;
  }

  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: vi.fn(async () => rootDirectory),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opfs-dataset-store', () => {
  it('saves and loads an imported file round-trip', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['protein-data'], 'custom.parquetbundle', {
      type: 'application/octet-stream',
      lastModified: 123,
    });

    await saveLastImportedFile(file);
    const loaded = await loadLastImportedFile();

    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('custom.parquetbundle');
    expect(loaded?.type).toBe('application/octet-stream');
    expect(loaded?.lastModified).toBe(123);
    expect(await loaded?.text()).toBe('protein-data');
  });

  it('returns null and clears the store when the payload file is missing', async () => {
    const root = new MockDirectoryHandle();
    const store = await root.getDirectoryHandle('protspace-last-import', { create: true });
    await store.writeTextFile(
      'metadata.json',
      JSON.stringify({
        schemaVersion: 1,
        name: 'custom.parquetbundle',
        type: 'application/octet-stream',
        size: 10,
        lastModified: 123,
        storedAt: '2026-03-13T12:00:00.000Z',
      }),
    );
    stubNavigator(root);

    const loaded = await loadLastImportedFile();

    expect(loaded).toBeNull();
    expect(root.hasDirectory('protspace-last-import')).toBe(false);
  });

  it('clears the store and throws for corrupt metadata', async () => {
    const root = new MockDirectoryHandle();
    const store = await root.getDirectoryHandle('protspace-last-import', { create: true });
    await store.writeTextFile('metadata.json', '{not-json');
    stubNavigator(root);

    await expect(loadLastImportedFile()).rejects.toBeInstanceOf(StoredDatasetCorruptError);
    expect(root.hasDirectory('protspace-last-import')).toBe(false);
  });

  it('falls back cleanly when OPFS is unsupported', async () => {
    stubNavigator();

    expect(isSupported()).toBe(false);
    await expect(loadLastImportedFile()).resolves.toBeNull();
    await expect(clearLastImportedFile()).resolves.toBeUndefined();
    await expect(saveLastImportedFile(new File(['x'], 'custom.parquetbundle'))).rejects.toThrow(
      /not supported/i,
    );
  });
});

describe('lastLoadStatus APIs', () => {
  it('returns null when no metadata is present', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    expect(await readLastLoadStatus()).toBeNull();
  });

  it('writes pending after save and reads it back', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('pending');
    expect(await readLastLoadStatus()).toEqual({
      status: 'pending',
      lastError: undefined,
      failedAttempts: 1,
    });
  });

  it('increments failedAttempts on repeated pending without success', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('pending');
    await markLastLoadStatus('pending');
    await markLastLoadStatus('pending');
    expect((await readLastLoadStatus())?.failedAttempts).toBe(3);
  });

  it('resets failedAttempts to 0 on success', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('pending');
    await markLastLoadStatus('pending');
    await markLastLoadStatus('success');
    expect(await readLastLoadStatus()).toEqual({
      status: 'success',
      lastError: undefined,
      failedAttempts: 0,
    });
  });

  it('records lastError when status is error', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('error', { error: 'boom' });
    expect(await readLastLoadStatus()).toEqual({
      status: 'error',
      lastError: 'boom',
      failedAttempts: 1,
    });
  });

  it('migrates schemaVersion=1 metadata to success on read', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    const dir = await root.getDirectoryHandle('protspace-last-import');
    const handle = await dir.getFileHandle('metadata.json');
    const writable = await handle.createWritable();
    await writable.write(
      JSON.stringify({
        schemaVersion: 1,
        name: 'a.parquetbundle',
        type: '',
        size: 1,
        lastModified: 0,
        storedAt: '2025-01-01T00:00:00.000Z',
      }),
    );
    await writable.close();

    const status = await readLastLoadStatus();
    expect(status?.status).toBe('success');
    expect(status?.failedAttempts).toBe(0);
  });

  it('does not increment failedAttempts when transitioning success → pending (e.g., Try again)', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('success'); // failedAttempts = 0
    await markLastLoadStatus('pending'); // prev was success → counter stays 0
    expect((await readLastLoadStatus())?.failedAttempts).toBe(0);
  });

  it('is a no-op when no metadata is present', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    await markLastLoadStatus('pending');
    expect(await readLastLoadStatus()).toBeNull();
  });

  it('clears status when clearLastImportedFile is called', async () => {
    const root = new MockDirectoryHandle();
    stubNavigator(root);

    const file = new File(['x'], 'a.parquetbundle');
    await saveLastImportedFile(file);
    await markLastLoadStatus('pending');
    await clearLastImportedFile();
    expect(await readLastLoadStatus()).toBeNull();
  });
});
