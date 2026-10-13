export function isMacOrIos(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaData = (navigator as any).userAgentData;
  const platform = uaData?.platform;

  if (platform) {
    return platform === 'macOS' || platform === 'iOS';
  }

  const ua = navigator.userAgent || '';
  return /Macintosh;.*Mac OS X/.test(ua) || /iPhone|iPad|iPod/.test(ua);
}

/**
 * Whether a key event's composed path runs through a text field (an `INPUT`, `TEXTAREA`, `SELECT`
 * or a contentEditable element), where the key edits text. The whole path, so a field inside a
 * shadow root counts; duck-typed, so it reads plain objects too.
 */
export function isEditableEventPath(path: readonly unknown[]): boolean {
  for (const node of path) {
    if (!node || typeof node !== 'object') continue;
    const { tagName, isContentEditable } = node as {
      tagName?: unknown;
      isContentEditable?: unknown;
    };
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (isContentEditable === true) return true;
  }
  return false;
}
