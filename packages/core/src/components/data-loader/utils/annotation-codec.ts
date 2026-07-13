/**
 * Lossless percent-encoding for annotation value serialization (bundle format v2).
 * Mirrors the Python backend `encoding.py`. Reserved set: `%` `;` `|` and all
 * C0/DEL control chars. `,` `(` `)` are intentionally left literal (positionally
 * safe / display sugar) so names stay readable.
 */

const ENCODE_RE = /[;|%\x00-\x1F\x7F]/g;
const DECODE_RE = /%([0-9A-Fa-f]{2})/g;

export function encodeField(s: string): string {
  if (!s) return s;
  return s.replace(
    ENCODE_RE,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
}

export function decodeField(s: string): string {
  if (!s || s.indexOf('%') === -1) return s;
  return s.replace(DECODE_RE, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
