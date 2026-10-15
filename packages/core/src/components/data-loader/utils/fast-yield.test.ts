// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { BUNDLE_DELIMITER_BYTES, concatenateBuffers } from '@protspace/utils';
import { decodeParquetBundle } from './bundle';
import { fastYield } from './fast-yield';

// Counted, so the decode test can show it really went through many yields.
vi.mock('./fast-yield', async (importOriginal) => {
  const original = await importOriginal<{ fastYield: typeof fastYield }>();
  return { fastYield: vi.fn(original.fastYield) };
});

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/**
 * MessagePorts the process holds open. An open port keeps Node's event loop alive, so a
 * yield that left one behind kept any Node process that decoded a bundle from exiting.
 */
const openPorts = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;

const part = (columns: { name: string; data: unknown[] | Float32Array }[], kv = {}) =>
  parquetWriteBuffer({
    columnData: columns.map((column) => ({ ...column, nullable: false })) as never,
    statistics: false,
    kvMetadata: Object.entries(kv).map(([key, value]) => ({ key, value: String(value) })),
  });

/**
 * A v2 bundle past the legacy reader's 10 000-row threshold, so it takes the chunked
 * conversion, which yields after every chunk and twice per annotation column.
 */
function legacyBundle(proteins = 12_000, columns = 60): ArrayBuffer {
  const ids = Array.from({ length: proteins }, (_, i) => `P${i}`);
  const annotations = part(
    [
      { name: 'protein_id', data: ids },
      ...Array.from({ length: columns }, (_, c) => ({
        name: `annotation_${c}`,
        data: ids.map((_, i) => `value_${(i + c) % 7}`),
      })),
    ],
    { protspace_format_version: '2' },
  );
  const metadata = part([
    { name: 'projection_name', data: ['A'] },
    { name: 'dimensions', data: [2] },
    { name: 'info_json', data: ['{}'] },
  ]);
  const projections = part([
    { name: 'projection_name', data: ids.map(() => 'A') },
    { name: 'identifier', data: ids },
    { name: 'x', data: Float32Array.from(ids, (_, i) => i) },
    { name: 'y', data: Float32Array.from(ids, (_, i) => -i) },
  ]);
  return concatenateBuffers([annotations, metadata, projections], BUNDLE_DELIMITER_BYTES);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fastYield', () => {
  // Without setImmediate it takes the MessageChannel path browsers take.
  it.each([
    ['setImmediate', false],
    ['a MessageChannel', true],
  ])(
    'resolves through %s with a collection after every post, and leaves no port open',
    async (_path, withoutSetImmediate) => {
      if (withoutSetImmediate) vi.stubGlobal('setImmediate', undefined);
      const portsBefore = openPorts();
      for (let i = 0; i < 20; i++) {
        const yielded = fastYield();
        gc();
        await yielded;
      }
      vi.unstubAllGlobals();
      // A closed port leaves the active list once its close has been processed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(openPorts()).toBe(portsBefore);
    },
    20_000,
  );
});

describe('decodeParquetBundle in Node', () => {
  it('resolves a legacy bundle, which yields between chunks, and leaves no port open', async () => {
    const portsBefore = openPorts();
    vi.mocked(fastYield).mockClear();
    const decoded = await decodeParquetBundle(legacyBundle());
    expect(decoded.formatVersion).toBe(2);
    expect(decoded.data.protein_ids).toHaveLength(12_000);
    expect(vi.mocked(fastYield).mock.calls.length).toBeGreaterThanOrEqual(2 * 60);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openPorts()).toBe(portsBefore);
  }, 20_000);
});
