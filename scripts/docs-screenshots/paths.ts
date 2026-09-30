import * as path from 'path';

/**
 * Where the docs pipeline reads and writes, shared by the Playwright captures and
 * the GIF converter. The recorder writes into TEMP_VIDEOS_DIR and the converter
 * reads from it, so the two must never disagree.
 */

/** Screenshots and converted GIFs, as the docs site embeds them. */
export const IMAGES_DIR = path.join(__dirname, '../../docs/explore/images');

/** Recorded .webm videos awaiting GIF conversion. */
export const TEMP_VIDEOS_DIR = path.join(__dirname, '../../temp-videos');
