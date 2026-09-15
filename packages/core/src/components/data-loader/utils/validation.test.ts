import { describe, it, expect } from 'vitest';
import { validateRowsBasic } from './validation';

function makeRows(overrides: Record<string, unknown> = {}): Record<string, unknown>[] {
  return [{ id: '1', name: 'test', ...overrides }];
}

describe('validateRowsBasic', () => {
  it('passes for short cell values', () => {
    expect(() => validateRowsBasic(makeRows({ annotation: 'short value' }))).not.toThrow();
  });

  it('passes for semicolon-separated values where total exceeds limit but individual parts do not', () => {
    // Each part is ~30 chars, total > 256 chars but each part < 256
    const parts = Array.from(
      { length: 15 },
      (_, i) => `PF${String(i).padStart(5, '0')} (domain_${i})`,
    );
    const value = parts.join(';');
    expect(value.length).toBeGreaterThan(256);
    expect(() => validateRowsBasic(makeRows({ pfam: value }))).not.toThrow();
  });

  it('rejects a single value exceeding the limit', () => {
    const longValue = 'x'.repeat(300);
    expect(() => validateRowsBasic(makeRows({ col: longValue }))).toThrow(
      /Cell value too long in column 'col'/,
    );
  });

  it('error message includes column name and character count', () => {
    const longValue = 'y'.repeat(300);
    expect(() => validateRowsBasic(makeRows({ my_column: longValue }))).toThrow(
      /my_column.*300 characters.*limit: 256/,
    );
  });

  it('respects custom maxCellStringLength override', () => {
    const value = 'a'.repeat(100);
    // Should pass with default limit (256)
    expect(() => validateRowsBasic(makeRows({ col: value }))).not.toThrow();
    // Should fail with custom limit (50)
    expect(() => validateRowsBasic(makeRows({ col: value }), { maxCellStringLength: 50 })).toThrow(
      /Cell value too long/,
    );
  });

  it('passes when semicolon-separated parts are each under the limit', () => {
    const value = 'abc;def;ghi';
    expect(() => validateRowsBasic(makeRows({ col: value }))).not.toThrow();
  });

  it('rejects when one semicolon-separated part exceeds the limit', () => {
    const longPart = 'z'.repeat(300);
    const value = `short;${longPart};other`;
    expect(() => validateRowsBasic(makeRows({ col: value }))).toThrow(/Cell value too long/);
  });
});

describe('validateRowsBasic row limit message', () => {
  it('names the count, the limit, what it counts, and what to do', () => {
    // The old message was `Too many rows: 2400000 exceeds limit` — an
    // unexplained number, no limit, no remediation. It reached the user as a
    // toast whose only action was "Report this", inviting a bug report about
    // entirely intended behaviour (#456).
    const rows = Array.from({ length: 11 }, () => ({ a: 1 }));
    let message = '';
    try {
      validateRowsBasic(rows, { maxRows: 10 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('11');
    expect(message).toContain('10');
    expect(message).toMatch(/proteins x projections/);
    expect(message).toMatch(/separate bundles|subset/i);
  });
});
