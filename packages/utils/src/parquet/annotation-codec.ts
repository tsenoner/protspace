/** Structural characters reserved by the categorical annotation v2 wire format. */
const STRUCTURAL_CHARACTER_RE = /[;|%\x00-\x1F\x7F]/g;

/**
 * Losslessly encode one categorical annotation field for bundle format v2.
 *
 * Semicolon separates hits and pipe introduces evidence/score suffixes, so both
 * must be escaped when they occur literally inside a label or EAT companion.
 */
export function encodeAnnotationField(value: string): string {
  if (!value) return value;
  return value.replace(
    STRUCTURAL_CHARACTER_RE,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}
