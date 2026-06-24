import { NA_DISPLAY } from '@protspace/utils';

/**
 * Build the display rows for a projection's metadata tooltip.
 *
 * Behaviour:
 * - internal fields (`name`, `dimension(s)`) are skipped;
 * - JSON-string fields (`info`, `info_json`, `*json*`) are parsed and flattened
 *   one level into individual rows;
 * - the `quality` sub-object inside `info_json` (per-projection faithfulness from
 *   route-projection-statistics) is expanded into one row per metric — each
 *   showing its value plus compact provenance (distance metric, `k`) — instead of
 *   rendering as a single raw `JSON.stringify` blob.
 */
export function buildProjectionMetadataRows(
  metadata: Record<string, unknown> | null | undefined,
): Array<[string, string]> {
  if (!metadata) return [];

  const rows: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'dimension' || lowerKey === 'dimensions' || lowerKey === 'name') {
      continue;
    }

    if (isJsonField(lowerKey) && typeof value === 'string') {
      const parsed = tryParseJson(value);
      if (isPlainObject(parsed)) {
        for (const [innerKey, innerValue] of Object.entries(parsed)) {
          if (innerKey.toLowerCase() === 'quality' && isPlainObject(innerValue)) {
            rows.push(...expandQuality(innerValue));
          } else {
            rows.push([formatMetadataKey(innerKey), formatMetadataValue(innerValue, innerKey)]);
          }
        }
        continue;
      }
    }

    rows.push([formatMetadataKey(key), formatMetadataValue(value, key)]);
  }

  return rows;
}

/** Expand a faithfulness `quality` object into one display row per metric. */
function expandQuality(quality: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(quality).map(([metric, raw]) => [
    formatMetadataKey(metric),
    formatQualityValue(raw),
  ]);
}

/**
 * Format one faithfulness metric. Each is `{ value, k, metric, ... }` (engine
 * Phase 1A); a missing value (the skip case) renders as N/A with its marker, and
 * a bare scalar (older flat shape) is formatted directly.
 */
function formatQualityValue(raw: unknown): string {
  if (isPlainObject(raw) && 'value' in raw) {
    const value = raw.value;
    if (value == null) {
      const skipped = typeof raw.skipped === 'string' ? raw.skipped : null;
      return skipped ? `${NA_DISPLAY} (skipped: ${skipped})` : NA_DISPLAY;
    }
    const valueStr = formatSingleValue(value, false);
    const provenance: string[] = [];
    if (typeof raw.metric === 'string') provenance.push(raw.metric);
    if (raw.k != null) provenance.push(`k=${formatSingleValue(raw.k, false)}`);
    return provenance.length > 0 ? `${valueStr} (${provenance.join(', ')})` : valueStr;
  }
  if (isPlainObject(raw)) {
    return JSON.stringify(raw);
  }
  return formatSingleValue(raw, false);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonField(key: string): boolean {
  return key === 'info' || key === 'info_json' || key.includes('json');
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatMetadataKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatMetadataValue(value: unknown, key: string): string {
  if (value == null) return NA_DISPLAY;

  const lowerKey = key.toLowerCase();
  const isVarianceRatio =
    lowerKey.includes('explained_variance') || lowerKey.includes('variance_ratio');

  if (Array.isArray(value)) {
    return value.map((item) => formatSingleValue(item, isVarianceRatio)).join(', ');
  }

  return formatSingleValue(value, isVarianceRatio);
}

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
