import { describe, expect, it } from 'vitest';
import { createDragDepth, isFileDrag } from './file-drop';

describe('isFileDrag', () => {
  it('is true only for a drag that carries files', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });

  it('reads a DOMStringList-like list', () => {
    const list = { 0: 'Files', length: 1, item: (i: number) => (i === 0 ? 'Files' : null) };
    expect(isFileDrag(list as unknown as DOMStringList)).toBe(true);
  });
});

describe('createDragDepth', () => {
  it('nested enter/leave stays active until depth 0', () => {
    const depth = createDragDepth();
    expect(depth.enter()).toBe(true);
    expect(depth.enter()).toBe(false);
    expect(depth.active).toBe(true);
    expect(depth.leave()).toBe(false);
    expect(depth.active).toBe(true);
    expect(depth.leave()).toBe(true);
    expect(depth.active).toBe(false);
  });

  it('a leave at 0 stays at 0', () => {
    const depth = createDragDepth();
    expect(depth.leave()).toBe(false);
    expect(depth.active).toBe(false);
    expect(depth.enter()).toBe(true);
  });

  it('reset clears it', () => {
    const depth = createDragDepth();
    depth.enter();
    depth.enter();
    depth.reset();
    expect(depth.active).toBe(false);
    expect(depth.enter()).toBe(true);
  });
});
