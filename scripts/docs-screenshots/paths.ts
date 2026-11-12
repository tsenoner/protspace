import * as path from 'path';

/**
 * Where the docs pipeline reads and writes, shared by the Playwright captures and the video
 * encoder. The recorder writes into TEMP_VIDEOS_DIR and the encoder reads from it, so the two must
 * never disagree.
 */

/** Screenshots, and the videos and posters the encoder writes, as the docs site embeds them. */
export const IMAGES_DIR = path.join(__dirname, '../../docs/explore/images');

/** Recordings awaiting encoding, with their sidecars. */
export const TEMP_VIDEOS_DIR = path.join(__dirname, '../../temp-videos');
