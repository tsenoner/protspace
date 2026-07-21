/**
 * Lossless percent-decoding for annotation value deserialization (bundle format v2).
 *
 * The matching encoder is `encodeAnnotationField` in `@protspace/utils`
 * (`packages/utils/src/parquet/annotation-codec.ts`): the write path lives in the
 * utils bundle-writer, this decode is the read path. Keeping a single encoder there
 * (utils cannot import core) avoids a second hand-written copy that could silently
 * diverge from this decoder. Both mirror the Python backend `encoding.py`. Reserved
 * set: `%` `;` `|` and all C0/DEL control chars; `,` `(` `)` are intentionally left
 * literal (positionally safe / display sugar) so names stay readable.
 */

const DECODE_RE = /%([0-9A-Fa-f]{2})/g;

export function decodeField(s: string): string {
  if (!s || s.indexOf('%') === -1) return s;
  return s.replace(DECODE_RE, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
