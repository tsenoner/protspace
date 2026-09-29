import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { TOXPROT_5181_FIXTURE } from './fixtures';

interface SeedOpfsParams {
  fileName: string;
  status: 'pending' | 'success' | 'error';
  failedAttempts: number;
  lastError?: string;
}

/**
 * Writes a stored import with the given load status into OPFS. Its bytes are
 * the 5,181-protein fixture's, read here and handed to the page, so the seed
 * depends on no file the app serves.
 */
export async function seedOpfsState(page: Page, params: SeedOpfsParams): Promise<void> {
  const bytesBase64 = readFileSync(TOXPROT_5181_FIXTURE).toString('base64');
  await page.evaluate(
    async ({ fileName, status, failedAttempts, lastError, bytesBase64 }) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('protspace-last-import', { create: true });

      const blob = new Blob([Uint8Array.from(atob(bytesBase64), (c) => c.charCodeAt(0))]);
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
      bytesBase64,
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
