/**
 * Lossless percent-decoding for annotation value deserialization (bundle format v2).
 *
 * The matching encoder is the Python backend's `encode_field`
 * (`apps/protspace/src/protspace/data/annotations/encoding.py`). The browser has no
 * encoder: the web exporter writes format v3, which stores labels decoded. Reserved
 * set: `%` `;` `|` and all C0/DEL control chars; `,` `(` `)` are intentionally left
 * literal (positionally safe / display sugar) so names stay readable.
 */

const DECODE_RE = /%([0-9A-Fa-f]{2})/g;

export function decodeField(s: string): string {
  if (!s || s.indexOf('%') === -1) return s;
  return s.replace(DECODE_RE, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
