import { describe, it, expect } from 'vitest';
import { assertWithinFileSizeLimit } from './validation';

describe('assertWithinFileSizeLimit', () => {
  it('admits a 2 GB file and names the limit when refusing a larger one', () => {
    const limit = 2 * 1024 ** 3;
    expect(() => assertWithinFileSizeLimit(limit)).not.toThrow();
    expect(() => assertWithinFileSizeLimit(limit + 1024 ** 2)).toThrow(
      'File too large: 2049.00 MB exceeds the 2048 MB limit',
    );
  });
});
