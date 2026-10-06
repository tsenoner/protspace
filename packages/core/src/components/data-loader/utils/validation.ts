// Parquet magic bytes 'PAR1'
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export function assertValidParquetMagic(buffer: ArrayBuffer): void {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 12) {
    throw new Error('Invalid Parquet file: too small');
  }
  const head = u8.subarray(0, 4);
  const tail = u8.subarray(u8.length - 4);
  for (let i = 0; i < 4; i++) {
    if (head[i] !== PARQUET_MAGIC[i] || tail[i] !== PARQUET_MAGIC[i]) {
      throw new Error('Invalid Parquet file: magic bytes not found');
    }
  }
}

const ACCEPTED_EXTENSION = '.parquetbundle';

export function assertValidFileExtension(fileName: string): void {
  if (!fileName.endsWith(ACCEPTED_EXTENSION)) {
    throw new Error(`Unsupported file format. Please upload a ${ACCEPTED_EXTENSION} file.`);
  }
}

export function assertWithinFileSizeLimit(
  sizeBytes: number,
  maxSizeBytes = MAX_FILE_SIZE_BYTES,
): void {
  if (sizeBytes > maxSizeBytes) {
    const mb = (bytes: number, digits: number) => (bytes / (1024 * 1024)).toFixed(digits);
    throw new Error(
      `File too large: ${mb(sizeBytes, 2)} MB exceeds the ${mb(maxSizeBytes, 0)} MB limit`,
    );
  }
}
