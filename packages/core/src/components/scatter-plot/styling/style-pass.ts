/**
 * The scatter plot's staging pass: one style record per category code of the
 * selected annotation, so staging looks a point's style up by its integer code
 * instead of running the per-point getters, which allocate a value array and
 * look colours up by string for every point.
 *
 * Records are built by applying the getters' own per-value functions to a
 * category's values, so a point has exactly the style its getters give it.
 *
 * Record ids: code `c` is record `c` for `c < values.length`; a code that is not
 * an index of `annotation.values` (which reads as N/A) is `values.length`; a
 * point with no value is `values.length + 1`. Each distinct list of several
 * codes gets the next free id the first time a pass meets it. With no usable
 * annotation every point has record 0.
 *
 * A pass also says which records the legend hides, so the renderer can apply
 * the hiding per record (see `PointStylePass.hiddenRecords`).
 */

import type {
  Annotation,
  AnnotationData,
  AnnotationPredictedData,
  PlotData,
  VisualizationData,
} from '@protspace/utils';
import {
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
  toInternalValue,
} from '@protspace/utils';
import type { PointStylePass, PointStyleRecords } from '../webgl/types';
import { composePaintDepth } from '../webgl/renderer/point-staging';
import type { VisibilityModel } from './visibility-model';

/** The style semantics `createStyleGetters` shares with its staging pass. */
interface CategoryStyleSource {
  data: VisualizationData | null;
  selectedAnnotation: string;
  pointSize: number;
  /** Visibility model `getDepth` reads base opacity from. */
  depthModel: VisibilityModel;
  /** `annotation_predicted` of the selected annotation while the EAT overlay is on. */
  predictedCells: AnnotationPredictedData[string] | null;
  /** Whether `getDepth` adds a legend z-order offset. */
  zOrderActive: boolean;
  colorsOfValues(values: readonly string[]): string[];
  shapeOfValues(values: readonly string[]): string;
  /** The z-order offset `getDepth` adds for these values while `zOrderActive`. */
  zOffsetOfValues(values: readonly string[]): number;
  /** `getDepth` from a base opacity and a z-order offset. */
  depthOf(baseOpacity: number, zOffset: number): number;
}

/**
 * The records of one set of style getters: built on first use, and extended
 * with every multi-valued code list a pass meets, so later passes reuse them.
 */
export class CategoryStyles {
  readonly colors: string[][] = [];
  readonly shapes: string[] = [];
  /** z-order offset per record. */
  readonly recordZ: number[] = [];
  /** The values `getProteinAnnotationValues` reads for a point with each record. */
  readonly recordValues: (readonly string[])[] = [];
  readonly records: PointStyleRecords;
  /** Storage of the selected annotation, or null when every point is record 0. */
  readonly rows: AnnotationData | null;
  /** `annotation.values.length`: the record of a code that names no value. */
  readonly naRecord: number;
  /** The record of a point with no value. */
  readonly emptyRecord: number;
  private readonly annotation: Annotation | null;
  /** Records of multi-valued code lists, by a hash of the codes. */
  private readonly listRecords = new Map<number, number[]>();
  /** The code list of each such record, indexed by record id. */
  private readonly listCodes: ArrayLike<number>[] = [];

  constructor(readonly source: CategoryStyleSource) {
    const { data, selectedAnnotation } = source;
    const annotation = data && selectedAnnotation ? data.annotations[selectedAnnotation] : null;
    const rows = data && selectedAnnotation ? data.annotation_data?.[selectedAnnotation] : null;
    // `getProteinAnnotationValues` gives every point [] without these.
    const usable = !!annotation && !!rows && Array.isArray(annotation.values);
    this.annotation = usable ? annotation : null;
    this.rows = usable ? rows : null;

    if (usable) {
      const values = annotation.values;
      for (let c = 0; c < values.length; c++) this.add([toInternalValue(values[c])]);
      this.naRecord = this.add([toInternalValue(undefined)]);
    } else {
      this.naRecord = 0;
    }
    this.emptyRecord = this.add([]);
    this.records = {
      colors: this.colors,
      shapes: this.shapes,
      pointSize: source.pointSize,
      codes: usable ? { values: annotation.values, rows, count: this.emptyRecord + 1 } : undefined,
    };
  }

  /** The record of a protein's code list, as `getProteinAnnotationIndices` returns it. */
  listRecord(codes: ArrayLike<number>): number {
    if (codes.length === 0) return this.emptyRecord;
    if (codes.length === 1) {
      const code = codes[0];
      return Number.isInteger(code) && code >= 0 && code < this.naRecord ? code : this.naRecord;
    }
    let hash = 0x811c9dc5;
    for (let k = 0; k < codes.length; k++) hash = Math.imul(hash ^ codes[k], 0x01000193);
    const sameHash = this.listRecords.get(hash);
    if (sameHash) {
      for (const r of sameHash) if (sameCodes(this.listCodes[r], codes)) return r;
    }
    // The values `getProteinAnnotationValues` reads for these codes.
    const values = Array.from(codes, (code) => toInternalValue(this.annotation!.values[code]));
    const r = this.add(values);
    this.listCodes[r] = codes;
    if (sameHash) sameHash.push(r);
    else this.listRecords.set(hash, [r]);
    return r;
  }

  private add(values: readonly string[]): number {
    const { source } = this;
    this.recordValues.push(values);
    this.colors.push(source.colorsOfValues(values));
    this.shapes.push(source.shapeOfValues(values));
    this.recordZ.push(source.zOrderActive ? source.zOffsetOfValues(values) : 0);
    return this.colors.length - 1;
  }
}

function sameCodes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/** Write each slot's record id. */
function writeRecordIds(styles: CategoryStyles, pd: PlotData, count: number, out: Int32Array) {
  const { rows, naRecord, emptyRecord } = styles;
  const oiArr = pd.originalIndices;
  if (!rows) {
    out.fill(emptyRecord, 0, count);
    return;
  }
  // A single code from compact storage, where a negative code means no value.
  const codeRecord = (code: number): number =>
    code < 0 ? emptyRecord : code < naRecord ? code : naRecord;

  if (rows instanceof Int32Array) {
    const len = rows.length;
    for (let i = 0; i < count; i++) {
      const oi = oiArr ? oiArr[i] : i;
      out[i] = oi >= 0 && oi < len ? codeRecord(rows[oi]) : emptyRecord;
    }
  } else if (isSparseMultiValueAnnotationData(rows)) {
    const { base, overrides } = rows;
    const len = base.length;
    for (let i = 0; i < count; i++) {
      const oi = oiArr ? oiArr[i] : i;
      const override = overrides.get(oi);
      if (override) out[i] = styles.listRecord(override);
      else out[i] = oi >= 0 && oi < len ? codeRecord(base[oi]) : emptyRecord;
    }
  } else if (isCsrAnnotationData(rows)) {
    const { offsets, codes, length: len } = rows;
    for (let i = 0; i < count; i++) {
      const oi = oiArr ? oiArr[i] : i;
      if (oi < 0 || oi >= len) {
        out[i] = emptyRecord;
        continue;
      }
      const start = offsets[oi];
      const stop = offsets[oi + 1];
      if (stop - start === 1) {
        // A single hit reads its code even when negative, as the accessor does.
        const code = codes[start];
        out[i] = code >= 0 && code < naRecord ? code : naRecord;
      } else {
        out[i] = start === stop ? emptyRecord : styles.listRecord(codes.subarray(start, stop));
      }
    }
  } else {
    const len = rows.length;
    for (let i = 0; i < count; i++) {
      const oi = oiArr ? oiArr[i] : i;
      out[i] = oi >= 0 && oi < len ? styles.listRecord(rows[oi]) : emptyRecord;
    }
  }
}

/**
 * A staging pass over `styles`. Every slot gets a record. `opacityModel` is the
 * model `getOpacity` reads, which the scatter plot resolves afresh for each pass.
 */
export function createCategoryStylePass(
  styles: CategoryStyles,
  opacityModel: VisibilityModel,
): PointStylePass {
  const { source, recordZ, recordValues } = styles;
  const { depthModel, predictedCells } = source;
  // The usual case: one model for both, so base opacity is looked up once.
  const oneModel = opacityModel === depthModel;
  // Hidden-ness is a property of a point's values, so of its record. Filled on
  // first read: only a renderer that applies it per record asks.
  const hiddenRecords: boolean[] = [];

  return {
    records: styles.records,
    get hiddenRecords() {
      for (let r = hiddenRecords.length; r < recordValues.length; r++) {
        hiddenRecords.push(opacityModel.hidesValues(recordValues[r]));
      }
      return hiddenRecords;
    },
    resolve(pd, count, out) {
      const { opacity, depth, record, predicted, base } = out;
      writeRecordIds(styles, pd, count, record);
      const oiArr = pd.originalIndices;
      const ids = pd.proteinIds;
      for (let i = 0; i < count; i++) {
        const oi = oiArr ? oiArr[i] : i;
        const id = ids[oi];
        const baseOpacity = depthModel.baseOpacityAt(oi, id);
        const slotBase = oneModel ? baseOpacity : opacityModel.baseOpacityAt(oi, id);
        const slotOpacity = oneModel
          ? depthModel.isHiddenAt(oi)
            ? 0
            : baseOpacity
          : opacityModel.opacityAt(oi, id);
        const isPredicted = !!predictedCells?.[oi];
        opacity[i] = slotOpacity;
        base[i] = slotBase;
        predicted[i] = isPredicted ? 1 : 0;
        depth[i] = composePaintDepth(
          source.depthOf(baseOpacity, recordZ[record[i]]),
          slotOpacity,
          isPredicted,
        );
      }
    },
  };
}
