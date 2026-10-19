import type { FileMetaData } from 'hyparquet';
import {
  V3_CONTAINER_VERSION,
  V3_CONTAINER_VERSION_KEY,
  type BundleSettings,
  type VisualizationData,
} from '@protspace/utils';
import { readV3Bundle } from './bundle-v3';
import { readFooterValue, readPart1Metadata, splitBundleParts } from './bundle-parts';
import { readLegacyBundle } from '../legacy';

/**
 * Reads the container version (`protspace_container_version`) from part 1's footer: `null`
 * when the key is absent, which is what a legacy bundle looks like. A value that is present
 * but is not the one container version this reader knows is an error, not a fallback to the
 * legacy reader, which would misread v3's integer codes as labels.
 */
function readContainerVersion(metadata: FileMetaData | null): number | null {
  const raw = metadata ? readFooterValue(metadata, V3_CONTAINER_VERSION_KEY) : undefined;
  if (raw === undefined) return null;
  const version = Number(raw);
  if (version !== V3_CONTAINER_VERSION) {
    throw new Error(
      `Parquetbundle declares container version "${raw}"; this reader supports ` +
        `${V3_CONTAINER_VERSION_KEY}=${V3_CONTAINER_VERSION}`,
    );
  }
  return version;
}

/** What {@link decodeParquetBundle} returns. */
export interface DecodedParquetBundle {
  data: VisualizationData;
  settings: BundleSettings | null;
  /**
   * Format version the bundle was read as: 3 for the columnar container (from
   * `protspace_container_version`), else the legacy format (1 or 2, from the cell-grammar key
   * `protspace_format_version`), whose support ends in protspace 5.0.0.
   */
  formatVersion: number;
  /**
   * Proteins the file holds that no projection places (annotation-only rows, or rows whose
   * every coordinate is missing). They are not in `data`, so an export of it leaves them
   * out, while `protspace convert` keeps them. 0 when every protein is placed.
   */
  unplacedProteinCount: number;
}

/**
 * Read a parquetbundle into visualization data, whichever format version it carries.
 *
 * The one entry point every bundle load goes through — the decode worker and the
 * main-thread paths of `bundle-decoder.ts` — so the version sniff lives in exactly one place.
 * A part 1 carrying `protspace_container_version` takes the columnar reader in
 * `bundle-v3.ts`; one without it takes the v1/v2 row-object reader in `legacy/`. The part
 * count has to agree: six parts without the container key is neither layout.
 */
export function decodeParquetBundle(arrayBuffer: ArrayBuffer): Promise<DecodedParquetBundle> {
  return decodeParquetBundleWithRowCap(arrayBuffer);
}

/**
 * {@link decodeParquetBundle} with the v1/v2 row cap, checked on part 3's footer, lowered to
 * `maxLegacyRows`, so tests reach it without encoding millions of rows. v3 has no row cap.
 */
export async function decodeParquetBundleWithRowCap(
  arrayBuffer: ArrayBuffer,
  maxLegacyRows?: number,
): Promise<DecodedParquetBundle> {
  const parts = splitBundleParts(arrayBuffer);
  const part1Metadata = readPart1Metadata(parts[0]);
  const containerVersion = readContainerVersion(part1Metadata);

  if (part1Metadata && containerVersion !== null) {
    return { ...(await readV3Bundle(parts, part1Metadata)), formatVersion: containerVersion };
  }
  if (parts.length === 6) {
    throw new Error(
      `Parquetbundle has 6 parts but part 1 carries no ${V3_CONTAINER_VERSION_KEY}; ` +
        `a format v3 container declares ${V3_CONTAINER_VERSION_KEY}=${V3_CONTAINER_VERSION}`,
    );
  }

  return readLegacyBundle(parts, part1Metadata, maxLegacyRows);
}
