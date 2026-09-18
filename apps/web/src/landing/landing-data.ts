/**
 * Loaders for the static landing-page data extracted from the example bundles by
 * `scripts/landing-data/build-landing-data.mts`. Everything is fetched lazily and cached
 * per page load so the hero and the sections below share one download.
 */
import { useEffect, useState } from 'react';

export interface Category {
  label: string;
  count: number;
  color: string;
  kind?: 'other' | 'na';
  /** Number of named categories folded into the "Other" bucket. */
  collapsed?: number;
}

interface DemoAnnotation {
  column: string;
  label: string;
  categories: Category[];
  /** Per-point category index into `categories`. */
  index: Uint8Array;
}

interface DemoData {
  count: number;
  projection: { name: string };
  /** Normalized coordinates in [0, 1], y grows upward. */
  x: Float32Array;
  y: Float32Array;
  annotations: DemoAnnotation[];
}

export interface DemoLabels {
  ids: string[];
  names: string[];
}

interface QualityMetric {
  value: number;
  scope: 'local' | 'global';
  k: number;
}

export interface VenomProjection {
  name: string;
  x: number[];
  y: number[];
  quality: Record<string, QualityMetric>;
}

export interface VenomTransfer {
  point: number;
  category: number;
  confidence: number;
  source: number;
}

export interface VenomData {
  count: number;
  ids: string[];
  names: string[];
  projections: VenomProjection[];
  families: { column: string; label: string; categories: Category[]; values: number[] };
  eat: {
    column: string;
    label: string;
    categories: Category[];
    /** Per-point curated category index, -1 when the curated value is missing. */
    curated: number[];
    transferred: VenomTransfer[];
  };
}

interface DemoManifest {
  count: number;
  projection: { name: string; xMin: number; xMax: number; yMin: number; yMax: number };
  bin: {
    file: string;
    layout: { field: string; type: 'Uint16' | 'Uint8'; offset: number; length: number }[];
  };
  labels: { file: string };
  annotations: { column: string; label: string; categories: Category[] }[];
}

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/landing/`;

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(BASE + file);
  if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
  return response.json() as Promise<T>;
}

/** Bundles name projections "ProtT5 — UMAP 2"; the landing page shows no em-dashes. */
function displayName(name: string): string {
  return name.replace(/\s*—\s*/g, ' · ');
}

/** Rescale values to [0, 1]. */
export function normalize(values: ArrayLike<number>): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const span = max - min || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - min) / span;
  return out;
}

/** Run `factory` once per page load, but forget a rejected attempt so a remount can retry. */
function once<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () =>
    (promise ??= factory().catch((error: unknown) => {
      promise = null;
      throw error;
    }));
}

export const loadDemoData = once(async (): Promise<DemoData> => {
  const manifest = await fetchJson<DemoManifest>('demo.json');
  const response = await fetch(BASE + manifest.bin.file);
  if (!response.ok) throw new Error(`Failed to load ${manifest.bin.file}`);
  const buffer = await response.arrayBuffer();
  const n = manifest.count;
  const expectedBytes = n * 4 + manifest.annotations.length * n;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(`${manifest.bin.file} is truncated: ${buffer.byteLength} < ${expectedBytes}`);
  }
  const xy = new Uint16Array(buffer, 0, n * 2);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = xy[i * 2] / 65535;
    y[i] = xy[i * 2 + 1] / 65535;
  }
  const annotations = manifest.annotations.map((annotation) => {
    const slot = manifest.bin.layout.find((entry) => entry.field === annotation.column);
    if (!slot) throw new Error(`Missing binary layout for ${annotation.column}`);
    return { ...annotation, index: new Uint8Array(buffer, slot.offset, slot.length) };
  });
  return {
    count: n,
    projection: { name: displayName(manifest.projection.name) },
    x,
    y,
    annotations,
  };
});

export const loadDemoLabels = once(() => fetchJson<DemoLabels>('demo-labels.json'));

export const loadVenomData = once(async () => {
  const venom = await fetchJson<VenomData>('venom.json');
  for (const projection of venom.projections) projection.name = displayName(projection.name);
  return venom;
});

/** Resolve a cached loader into state: `undefined` while loading, `null` when loading failed. */
export function useLandingData<T>(loader: () => Promise<T>): T | null | undefined {
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    loader()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error: unknown) => {
        console.error('Landing data failed to load', error);
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, [loader]);
  return data;
}
