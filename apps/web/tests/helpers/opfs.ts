import type { Page } from '@playwright/test';

/** A bundle the app serves, used as the stored import's bytes. */
const FIXTURE_PUBLIC_PATH = '/data/5K.parquetbundle';

interface SeedOpfsParams {
  fileName: string;
  status: 'pending' | 'success' | 'error';
  failedAttempts: number;
  lastError?: string;
}

/** Writes a stored import (the 5K bundle) with the given load status into OPFS. */
export async function seedOpfsState(page: Page, params: SeedOpfsParams): Promise<void> {
  await page.evaluate(
    async ({ fileName, status, failedAttempts, lastError, publicPath }) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('protspace-last-import', { create: true });

      const blob = await fetch(publicPath).then((r) => r.blob());
      const dataHandle = await dir.getFileHandle('dataset.bin', { create: true });
      const dataWritable = await dataHandle.createWritable();
      await dataWritable.write(blob);
      await dataWritable.close();

      const metaHandle = await dir.getFileHandle('metadata.json', { create: true });
      const metaWritable = await metaHandle.createWritable();
      await metaWritable.write(
        JSON.stringify({
          schemaVersion: 2,
          name: fileName,
          type: '',
          size: blob.size,
          lastModified: 0,
          storedAt: '2026-05-02T00:00:00.000Z',
          lastLoadStatus: status,
          failedAttempts,
          lastError,
        }),
      );
      await metaWritable.close();
    },
    {
      fileName: params.fileName,
      status: params.status,
      failedAttempts: params.failedAttempts,
      lastError: params.lastError,
      publicPath: FIXTURE_PUBLIC_PATH,
    },
  );
}

/** Removes the stored import from OPFS, if any. */
export async function clearOpfs(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('protspace-last-import', { recursive: true });
    } catch {
      // OPFS may not exist yet; that's fine.
    }
  });
}
