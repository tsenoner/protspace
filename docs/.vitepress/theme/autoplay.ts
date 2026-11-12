/**
 * Whether a rejected `video.play()` means the browser refused to autoplay (a phone's power saving,
 * an autoplay policy): `NotAllowedError`. A play that a `pause()` or a new load interrupted, as
 * when a reader scrolls past before the video has loaded, rejects with `AbortError`, which is no
 * refusal: the next play can still start on its own.
 */
export function isAutoplayRefusal(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'NotAllowedError';
}
