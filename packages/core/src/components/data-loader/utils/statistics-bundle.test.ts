import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  BUNDLE_DELIMITER_BYTES,
  annotationStatSummary,
  clusterAgreement,
  concatenateBuffers,
  createParquetBundle,
} from '@protspace/utils';
import { extractRowsFromParquetBundle } from './bundle';
import {
  convertParquetToVisualizationData,
  convertParquetToVisualizationDataOptimized,
} from './conversion';

/**
 * Statistics part (5th) of a `.parquetbundle`, produced by the backend's `--stats` flag.
 *
 * The fixtures are REAL backend output — the `statistics.parquet` and `settings.parquet` parts
 * of a 1,428-protein 3FTx/ProtT5 run (`--stats --cluster-selection both --stats-annotation
 * auto`). They are glued onto the existing tiny `v2-sample` core here rather than committing
 * that run's whole 148 KB bundle: the core parts are irrelevant to this path, and the parts
 * that matter are byte-for-byte what the backend writes.
 */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, '__fixtures__', name)));

const STATISTICS = fixture('stats-sample-statistics.parquet');
const SETTINGS = fixture('stats-sample-settings.parquet');
/** A real 3-part (2-delimiter) bundle: annotations, projections metadata, projections. */
const CORE = fixture('v2-sample.parquetbundle');

/** Join parts with the writer's own framing. An empty part yields a zero-byte slot. */
const joinParts = (parts: Uint8Array[]): ArrayBuffer =>
  concatenateBuffers(
    parts.map((part) => part.slice().buffer),
    BUNDLE_DELIMITER_BYTES,
  );

/** `[core, core, core]` + whatever trailing parts a case needs. */
const bundleWith = (...trailing: Uint8Array[]): ArrayBuffer => joinParts([CORE, ...trailing]);

describe('statistics part of a parquetbundle', () => {
  // Inline mockRestore() can be skipped by a throwing assertion and leak into later tests.
  afterEach(() => vi.restoreAllMocks());

  it('loads a 5-part bundle (core + settings + statistics)', async () => {
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));

    expect(extraction.settings).not.toBeNull();
    // Both representations: the bytes an export re-emits, and the rows the UI renders.
    expect(new Uint8Array(extraction.statistics!)).toEqual(STATISTICS);
    expect(extraction.statisticsRows!.length).toBeGreaterThan(0);
  });

  it('reads the statistics part when the settings slot is empty', async () => {
    const extraction = await extractRowsFromParquetBundle(
      bundleWith(new Uint8Array(0), STATISTICS),
    );

    expect(extraction.settings).toBeNull();
    expect(extraction.statisticsRows!.length).toBeGreaterThan(0);
  });

  it('keeps 3- and 4-part bundles working, with no statistics', async () => {
    expect((await extractRowsFromParquetBundle(joinParts([CORE]))).statistics).toBeNull();
    expect((await extractRowsFromParquetBundle(bundleWith(SETTINGS))).statistics).toBeNull();
  });

  it('ignores a statistics part that is not a parquet file, but still carries it', async () => {
    const notParquet = new TextEncoder().encode('definitely not parquet');
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, notParquet));

    // Supplementary data must never fail the load: the rows are dropped...
    expect(extraction.statisticsRows).toBeNull();
    expect(extraction.projections.length).toBeGreaterThan(0);
    // ...but the bytes are not. Parsing is a render concern; carriage is not conditional on it.
    expect(new Uint8Array(extraction.statistics!)).toEqual(notParquet);
  });

  it('preserves the tidy row schema the UI keys off', async () => {
    const { statisticsRows } = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));

    expect(Object.keys(statisticsRows![0]).sort()).toEqual([
      'annotation',
      'extra_json',
      'label_kind',
      'metric',
      'metric_kind',
      'space_kind',
      'space_name',
      'stat_family',
      'value',
    ]);
  });

  it('carries both statistics representations through conversion onto VisualizationData', async () => {
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));
    const data = await convertParquetToVisualizationDataOptimized(extraction);

    expect(data.statistics).toBe(extraction.statistics);
    expect(data.statisticsRows).toBe(extraction.statisticsRows);
  });

  it('summarises a real annotation against the projection it was scored in', async () => {
    const { statisticsRows } = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));
    const summary = annotationStatSummary(statisticsRows!, 'major_group', 'ProtT5 — UMAP 2');

    // Values from the fixture run: UMAP separates `major_group` better than the raw ProtT5
    // embedding does (0.326 vs 0.095), and the auto-clusters partly recover it.
    expect(summary!.validity.map((metric) => metric.metric)).toEqual([
      'silhouette',
      'davies_bouldin',
      'calinski_harabasz',
    ]);
    expect(summary!.validity[0].value).toBeCloseTo(0.326, 3);
    expect(summary!.validity[0].embedding).toBeCloseTo(0.095, 3);
  });

  it('pins clusterAgreement to what the real fixture actually wrote', async () => {
    const { statisticsRows } = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));

    // Same run as the summary test above, read through the other door: every annotation the
    // elbow-K clustering on ProtT5 — UMAP 2 was compared against. A backend rename of the
    // cluster columns or a `label_kind` drift would silently empty this out with nothing else
    // in the suite to catch it. Sorted by ARI now, not parquet row order, so this asserts the
    // set rather than the arrival sequence.
    const recovered = clusterAgreement(statisticsRows!, 'cluster_elbow_ProtT5 — UMAP 2');
    expect(recovered.entries.map((e) => e.annotation).sort()).toEqual([
      'group',
      'major_group',
      'membran_prediction',
      'seq_start',
    ]);
    // Best-recovered first: whatever the order, ARI must be non-increasing down the list.
    const aris = recovered.entries.map(
      (e) => e.metrics.find((m) => m.metric === 'adjusted_rand')?.value ?? Number.NEGATIVE_INFINITY,
    );
    expect([...aris].sort((a, b) => b - a)).toEqual(aris);
  });

  it('reports no statistics for an annotation the run did not score', async () => {
    const { statisticsRows } = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));

    expect(annotationStatSummary(statisticsRows!, 'not_scored', 'ProtT5 — UMAP 2')).toBeNull();
  });

  it('ignores a statistics part whose kind columns were renamed', async () => {
    // A drifted schema that keeps the five value columns but renames `space_kind`: every
    // consumer branches on it, so the rows are unusable — and silently produce zero ⓘ icons.
    const drifted = new Uint8Array(
      parquetWriteBuffer({
        columnData: [
          { name: 'space_type', data: ['projection'], type: 'STRING' },
          { name: 'space_name', data: ['UMAP 2'], type: 'STRING' },
          { name: 'annotation', data: ['major_group'], type: 'STRING' },
          { name: 'stat_family', data: ['annotation_validity'], type: 'STRING' },
          { name: 'label_kind', data: ['annotation'], type: 'STRING' },
          { name: 'metric', data: ['silhouette'], type: 'STRING' },
          { name: 'metric_kind', data: ['validity'], type: 'STRING' },
          { name: 'value', data: [0.326], type: 'DOUBLE' },
        ],
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, drifted));

    expect(extraction.statisticsRows).toBeNull();
    expect(warn).toHaveBeenCalledWith('Statistics parquet has an unexpected schema, ignoring it');
    // Unrenderable is not the same as unwanted: the drifted part still exports intact, so a
    // rename in the producer costs the ⓘ icons and nothing on disk.
    expect(new Uint8Array(extraction.statistics!)).toEqual(drifted);
  });

  it('coerces an INT64 value column to numbers', async () => {
    // pyarrow types an all-integer column int64 by default; hyparquet reads that as BigInt,
    // which `formatStatValue` would render as '—' for every metric.
    const int64Stats = new Uint8Array(
      parquetWriteBuffer({
        columnData: [
          { name: 'space_kind', data: ['projection'], type: 'STRING' },
          { name: 'space_name', data: ['UMAP 2'], type: 'STRING' },
          { name: 'annotation', data: ['major_group'], type: 'STRING' },
          { name: 'stat_family', data: ['annotation_validity'], type: 'STRING' },
          { name: 'label_kind', data: ['annotation'], type: 'STRING' },
          { name: 'metric', data: ['silhouette'], type: 'STRING' },
          { name: 'metric_kind', data: ['validity'], type: 'STRING' },
          { name: 'value', data: [7n], type: 'INT64' },
          { name: 'extra_json', data: [''], type: 'STRING' },
        ],
      }),
    );

    const { statisticsRows } = await extractRowsFromParquetBundle(bundleWith(SETTINGS, int64Stats));

    expect(statisticsRows![0].value).toBe(7);
    expect(typeof statisticsRows![0].value).toBe('number');
  });

  it('re-exports the statistics part byte for byte', async () => {
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));
    const data = convertParquetToVisualizationData(extraction);

    const exported = await extractRowsFromParquetBundle(createParquetBundle(data));

    // Byte equality, not row equality. Row equality is what the deleted re-serializer used to
    // assert, and it passed while silently dropping every column the matcher didn't name.
    expect(new Uint8Array(exported.statistics!)).toEqual(STATISTICS);
  });

  it('re-exports a column the reader does not model', async () => {
    // The forward-compatibility case, and the reason the part is carried rather than rebuilt:
    // `protspace stats` gains columns over time (per-category scores are next). A reader that
    // re-serialized from its own typed rows would drop this one with no error anywhere.
    const withFutureColumn = new Uint8Array(
      parquetWriteBuffer({
        columnData: [
          { name: 'space_kind', data: ['projection'], type: 'STRING' },
          { name: 'space_name', data: ['UMAP 2'], type: 'STRING' },
          { name: 'annotation', data: ['major_group'], type: 'STRING' },
          { name: 'stat_family', data: ['annotation_validity'], type: 'STRING' },
          { name: 'label_kind', data: ['annotation'], type: 'STRING' },
          { name: 'metric', data: ['silhouette'], type: 'STRING' },
          { name: 'metric_kind', data: ['validity'], type: 'STRING' },
          { name: 'value', data: [0.5], type: 'DOUBLE' },
          { name: 'extra_json', data: [null], type: 'STRING' },
          { name: 'not_a_column_this_reader_knows', data: ['snake toxins'], type: 'STRING' },
        ],
      }),
    );
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, withFutureColumn));
    // The subset schema guard must admit it rather than reject the whole part.
    expect(extraction.statisticsRows).toHaveLength(1);

    const data = convertParquetToVisualizationData(extraction);
    const exported = await extractRowsFromParquetBundle(createParquetBundle(data));

    expect(new Uint8Array(exported.statistics!)).toEqual(withFutureColumn);
    expect(exported.statisticsRows![0]).toHaveProperty(
      'not_a_column_this_reader_knows',
      'snake toxins',
    );
  });

  it('round-trips settings alongside statistics (full 5-part bundle)', async () => {
    const extraction = await extractRowsFromParquetBundle(bundleWith(SETTINGS, STATISTICS));
    const data = convertParquetToVisualizationData(extraction);
    const settings = { legendSettings: {}, exportOptions: {}, eatConfidenceThreshold: 0.75 };

    const exported = await extractRowsFromParquetBundle(
      createParquetBundle(data, { includeSettings: true, settings }),
    );

    expect(exported.settings).not.toBeNull();
    expect(exported.settings!.eatConfidenceThreshold).toBe(0.75);
    expect(new Uint8Array(exported.statistics!)).toEqual(STATISTICS);
  });

  it('does not misparse the settings slot from a 3-part bundle (partAt range guard)', async () => {
    // Regression coverage for the `partAt` out-of-range guard in `bundle.ts`: on a plain 3-part
    // bundle, slots 3 and 4 (settings, statistics) must resolve to `null`, not a mis-sliced view
    // of the whole buffer. The statistics path fails silent on a mis-slice (0 rows → `return
    // null`), so it can't catch a deleted guard; the settings path warns on every outcome
    // (0 rows, rows without a string `settings_json`, or a parse throw), so it can.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const extraction = await extractRowsFromParquetBundle(joinParts([CORE]));

    expect(extraction.settings).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
