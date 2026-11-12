/**
 * The projection details card's pure metadata handling: splitting a projection's metadata into
 * reduction parameters and faithfulness metrics, and formatting keys and values for display. The
 * element (projection-metadata.ts) renders what these return.
 */
import type { ClusterAgreementEntry, Projection } from '@protspace/utils';
import { NA_DISPLAY, countNoun, formatStatValue, metricDisplay } from '@protspace/utils';

/** One rendered `<dt>/<dd>` pair. An empty `description` renders no ⓘ. */
export interface MetadataRow {
  label: string;
  value: string;
  description: string;
  /** Faithfulness scope ("local" / "global"), rendered as a group heading. Null groups first. */
  scope?: string | null;
}

/** A faithfulness metric before display: the raw key is kept so it can be looked up. */
interface QualityEntry {
  metric: string;
  scope: string | null;
  value: unknown;
  /** Proteins the comparison ran over. Shared by every faithfulness metric in a projection. */
  sampleSize: number | null;
  /** Whether that was a subsample rather than everything — a real caveat, previously hidden. */
  sampled: boolean;
}

/**
 * The coverage most annotations in a block share. Modal, not maximal: the interesting case is the
 * one annotation that covers far fewer proteins than the rest, and comparing against the majority
 * is what makes it stand out. Null when nothing carries coverage.
 */
export function modalCoverage(entries: readonly ClusterAgreementEntry[]): number | null {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (entry.scored === null) continue;
    counts.set(entry.scored, (counts.get(entry.scored) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reduction parameters and projection quality, kept apart. They answer different
 * questions: the parameters are what was asked for, the quality is what came out, and
 * a single flat list invites reading `n_neighbors` and `trustworthiness` as peers.
 */
export function splitMetadata(metadata: Projection['metadata'] | undefined): {
  parameters: MetadataRow[];
  quality: MetadataRow[];
  /** One line under the faithfulness heading saying what it was computed over. */
  qualityScope: string;
} {
  if (!metadata) return { parameters: [], quality: [], qualityScope: '' };

  const parameterEntries: Array<[string, unknown]> = [];
  const qualityEntryList: QualityEntry[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'dimension' || lowerKey === 'dimensions' || lowerKey === 'name') {
      continue;
    }

    if (isJsonField(lowerKey) && typeof value === 'string') {
      const parsed = tryParseJson(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [innerKey, innerValue] of Object.entries(parsed)) {
          if (
            innerKey.toLowerCase() === 'quality' &&
            !!innerValue &&
            typeof innerValue === 'object' &&
            !Array.isArray(innerValue)
          ) {
            qualityEntryList.push(...qualityEntries(innerValue as Record<string, unknown>));
          } else {
            parameterEntries.push([innerKey, innerValue]);
          }
        }
        continue;
      }
    }

    if (lowerKey === 'quality' && !!value && typeof value === 'object' && !Array.isArray(value)) {
      qualityEntryList.push(...qualityEntries(value as Record<string, unknown>));
      continue;
    }

    parameterEntries.push([key, value]);
  }

  const parameters: MetadataRow[] = parameterEntries.map(([key, value]) => ({
    label: formatMetadataKey(key),
    value: formatMetadataValue(value, key),
    // Reduction parameters are the reducer's own knobs, documented by the reducer; only
    // the metrics below have a registry entry to explain them.
    description: '',
  }));

  const quality: MetadataRow[] = qualityEntryList.map(({ metric, scope, value }) => {
    const display = metricDisplay(metric);
    // A description is exactly what "the registry knows this metric" means, so it also
    // decides whether the registry's spelling ("kNN Overlap") beats the prettified key.
    const known = display.description.length > 0;
    return {
      // The scope is a group heading now, not a suffix on every row. "(local)" / "(global)"
      // on each of five labels cost more width than the panel has — "Spearman Distance
      // (global) ⓘ" pushed its own value onto a second line.
      label: known ? display.label : formatMetadataKey(metric),
      // These are statistics, so they follow `formatStatValue` like every other score in
      // the app rather than the generic metadata formatter's own rounding — which is still
      // right for reduction parameters, and still handles the `value: null` a skipped
      // metric is written as.
      value:
        typeof value === 'number' && Number.isFinite(value)
          ? formatStatValue(value)
          : formatMetadataValue(value, metric),
      description: display.description,
      scope,
    };
  });

  return { parameters, quality, qualityScope: qualityScopeLine(qualityEntryList) };
}

/**
 * One entry per faithfulness metric, tagged with its scope ("local" neighbourhoods vs "global"
 * layout). The shared provenance each metric carries (k, seed, sampling, source embedding) is
 * dropped: it repeats per metric and would bury the five numbers worth reading.
 */
function qualityEntries(quality: Record<string, unknown>): QualityEntry[] {
  return Object.entries(quality).map(([metric, entry]): QualityEntry => {
    if (!entry || typeof entry !== 'object' || !('value' in entry)) {
      return { metric, scope: null, value: entry, sampleSize: null, sampled: false };
    }
    const {
      value,
      scope,
      sample_size: sampleSize,
      sampled,
    } = entry as {
      value: unknown;
      scope?: unknown;
      sample_size?: unknown;
      sampled?: unknown;
    };
    return {
      metric,
      scope: typeof scope === 'string' ? scope : null,
      value,
      sampleSize: typeof sampleSize === 'number' && Number.isFinite(sampleSize) ? sampleSize : null,
      sampled: sampled === true,
    };
  });
}

/**
 * What the faithfulness numbers were computed over, which the panel dropped entirely: the
 * provenance repeats identically on every metric, so it belongs once under the section
 * rather than on each row. `sampled` is the part that matters — above a threshold the
 * backend compares a subsample, and nothing said so.
 */
function qualityScopeLine(entries: QualityEntry[]): string {
  const withSize = entries.find((entry) => entry.sampleSize !== null);
  if (!withSize) return '';
  const proteins = `${countNoun(withSize.sampleSize!, 'protein', 'proteins')} compared`;
  return entries.some((entry) => entry.sampled) ? `${proteins} · subsampled` : proteins;
}

/**
 * Check if a key indicates a JSON field
 */
function isJsonField(key: string): boolean {
  return key === 'info' || key === 'info_json' || key.includes('json');
}

/**
 * Safely parse JSON string
 */
function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Format metadata key to Title Case
 */
export function formatMetadataKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format metadata value with appropriate precision
 */
export function formatMetadataValue(value: unknown, key: string): string {
  if (value == null) return NA_DISPLAY;

  const lowerKey = key.toLowerCase();
  const isVarianceRatio =
    lowerKey.includes('explained_variance') || lowerKey.includes('variance_ratio');

  if (Array.isArray(value)) {
    return value.map((item) => formatSingleValue(item, isVarianceRatio)).join(', ');
  }

  return formatSingleValue(value, isVarianceRatio);
}

/**
 * Format a single metadata value
 */
function formatSingleValue(value: unknown, isVarianceRatio: boolean): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(isVarianceRatio ? 2 : 3);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}
