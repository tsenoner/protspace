/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStorageKey,
  generateDatasetHash,
  generateLegacyDatasetHash,
  rememberDatasetHash,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { decodeParquetBundle } from '../data-loader/utils/bundle';
import {
  mountLegendWithScatterplot,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

type HashedLegend = ProtspaceLegend & {
  shapeSize: number;
  _persistenceController: {
    _datasetHash: string;
    updateDatasetHash: (data: VisualizationData) => boolean;
  };
};

function makeData(prefix = 'p', withPredictions = true): VisualizationData {
  const categorical = (values: string[]) => ({
    kind: 'categorical' as const,
    values,
    colors: values.map(() => '#111'),
    shapes: values.map(() => 'circle'),
  });
  return {
    protein_ids: [`${prefix}1`, `${prefix}2`, `${prefix}3`],
    projections: [{ name: 'pca', dimension: 2, data: new Float32Array(6) }],
    annotations: { ec: categorical(['observed', '__NA__']), family: categorical(['f']) },
    annotation_data: { ec: new Int32Array([0, 1, 1]), family: new Int32Array([0, 0, 0]) },
    ...(withPredictions && {
      annotation_predicted: {
        ec: [null, { value: 'observed', confidence: 0.8, source: `${prefix}1` }, null],
      },
    }),
  };
}

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(data: VisualizationData) {
  const { legend, plot } = await mountLegendWithScatterplot(data, 'ec');
  await settle(legend);
  return { legend: legend as HashedLegend, plot };
}

const legendKey = (hash: string, annotation: string) => buildStorageKey('legend', hash, annotation);
const sizeKey = (hash: string) => buildStorageKey('shape-size', hash);
const read = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const record = (maxVisibleValues: number) => ({
  maxVisibleValues,
  shapeSize: 10,
  hiddenValues: [],
  categories: {},
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('legend dataset hash', () => {
  it("keys an EAT fixture's storage by the decode worker's hash", async () => {
    const fixture = '../../../../../apps/web/tests/fixtures/phosphatase_eat.parquetbundle';
    const decode = async () => {
      const bytes = readFileSync(new URL(fixture, import.meta.url));
      return (await decodeParquetBundle(new Uint8Array(bytes).buffer)).data;
    };
    // The worker hashes its own decode; the legend sees another, so no memo is shared.
    const workerHash = generateDatasetHash(await decode());
    const data = await decode();
    const annotation = Object.keys(data.annotation_predicted ?? {})[0];
    expect(generateLegacyDatasetHash(data)).not.toBe(workerHash);

    const { legend } = await mountLegendWithScatterplot(data, annotation);
    await settle(legend);

    expect((legend as HashedLegend)._persistenceController._datasetHash).toBe(workerHash);
  });

  it('takes both hashes from the memo the decode worker seeds', async () => {
    const data = makeData();
    rememberDatasetHash(data, 'feedface00000001', 'feedface00000002');
    write(legendKey('feedface00000002', 'ec'), record(3));

    const { legend } = await mount(data);

    expect(legend._persistenceController._datasetHash).toBe('feedface00000001');
    expect(read(legendKey('feedface00000001', 'ec'))).toMatchObject({ maxVisibleValues: 3 });
    expect(localStorage.getItem(legendKey('feedface00000002', 'ec'))).toBeNull();
  });
});

describe('legend state under the hash without predictions', () => {
  const data = makeData();
  const hash = generateDatasetHash(data);
  const legacy = generateLegacyDatasetHash(data);

  it('moves to the full hash once', async () => {
    write(legendKey(legacy, 'ec'), record(3));
    write(sizeKey(legacy), 7);

    const { legend } = await mount(data);

    expect(read(legendKey(hash, 'ec'))).toEqual(record(3));
    expect(read(sizeKey(hash))).toBe(7);
    expect(legend.shapeSize).toBe(7);
    expect(localStorage.getItem(legendKey(legacy, 'ec'))).toBeNull();
    expect(localStorage.getItem(sizeKey(legacy))).toBeNull();
  });

  it("wins over a bundle's settings under the full hash, which stay where it has none", async () => {
    write(legendKey(legacy, 'ec'), record(3));
    write(sizeKey(legacy), 7);
    write(legendKey(hash, 'ec'), record(20));
    write(legendKey(hash, 'family'), record(15));
    write(sizeKey(hash), 12);

    await mount(data);

    expect(read(legendKey(hash, 'ec'))).toEqual(record(3));
    expect(read(legendKey(hash, 'family'))).toEqual(record(15));
    expect(read(sizeKey(hash))).toBe(7);
    expect(localStorage.getItem(legendKey(legacy, 'ec'))).toBeNull();
  });

  it('leaves state already under the full hash alone', async () => {
    write(legendKey(hash, 'ec'), record(3));
    write(sizeKey(hash), 7);

    const { legend } = await mount(data);

    expect(read(legendKey(hash, 'ec'))).toEqual(record(3));
    expect(legend.shapeSize).toBe(7);
    expect(localStorage.getItem(legendKey(legacy, 'ec'))).toBeNull();
  });

  it('is dropped by a clearing load', async () => {
    const { legend, plot } = await mount(makeData('q'));
    write(legendKey(legacy, 'ec'), record(3));
    write(sizeKey(legacy), 7);

    legend.clearForNewDataset(hash, true);
    showData(plot, data);
    await settle(legend);

    expect(legend._persistenceController._datasetHash).toBe(hash);
    expect(localStorage.getItem(legendKey(legacy, 'ec'))).toBeNull();
    expect(localStorage.getItem(sizeKey(legacy))).toBeNull();
    expect(read(legendKey(hash, 'ec'))).not.toMatchObject({ maxVisibleValues: 3 });
    expect(localStorage.getItem(sizeKey(hash))).toBeNull();
  });

  it('is never looked for without predictions, where both hashes are equal', () => {
    const plain = makeData('n', false);
    const plainHash = generateDatasetHash(plain);
    expect(generateLegacyDatasetHash(plain)).toBe(plainHash);
    write(legendKey(plainHash, 'ec'), record(3));
    write(sizeKey(plainHash), 7);
    const legend = document.createElement('protspace-legend') as HashedLegend;
    const getItem = vi.spyOn(localStorage, 'getItem');
    const setItem = vi.spyOn(localStorage, 'setItem');
    const removeItem = vi.spyOn(localStorage, 'removeItem');

    legend._persistenceController.updateDatasetHash(plain);

    // Only the legacy shape size check, which every dataset runs.
    expect(getItem.mock.calls).toEqual([[buildStorageKey('point-size', plainHash)]]);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(read(legendKey(plainHash, 'ec'))).toEqual(record(3));
    expect(read(sizeKey(plainHash))).toBe(7);
  });
});

function showData(plot: MockScatterplot, data: VisualizationData): void {
  plot.data = data;
  plot.getCurrentData = () => data;
  plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
}
