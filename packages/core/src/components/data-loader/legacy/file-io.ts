/**
 * Reads a file into one `ArrayBuffer`. `Blob.arrayBuffer()` reads off the main
 * thread and allocates the buffer once, so a large file needs neither chunking
 * nor yielding (reading it in slices and joining them cost a second full copy).
 */
export async function readFileOptimized(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
