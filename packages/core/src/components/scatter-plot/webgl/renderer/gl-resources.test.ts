import { describe, it, expect, vi } from 'vitest';
import { GLResources } from './gl-resources';
import type { FramebufferResources } from '../types';

function makeGl() {
  return {
    createBuffer: vi.fn(() => ({ k: 'buffer' })),
    createVertexArray: vi.fn(() => ({ k: 'vao' })),
    createTexture: vi.fn(() => ({ k: 'tex' })),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteTexture: vi.fn(),
    deleteProgram: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
    isProgram: vi.fn(() => true),
    isVertexArray: vi.fn(() => true),
    isBuffer: vi.fn(() => true),
    isTexture: vi.fn(() => true),
    isFramebuffer: vi.fn(() => true),
    isRenderbuffer: vi.fn(() => true),
  } as unknown as WebGL2RenderingContext;
}

function makeFramebuffer(): FramebufferResources {
  return {
    framebuffer: { k: 'fb' } as unknown as WebGLFramebuffer,
    texture: { k: 'fbtex' } as unknown as WebGLTexture,
    depthBuffer: { k: 'rb' } as unknown as WebGLRenderbuffer,
    width: 4,
    height: 4,
  };
}

describe('GLResources', () => {
  it('createAll allocates all vertex buffers plus the quad and label texture', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    expect(gl.createBuffer).toHaveBeenCalledTimes(8); // 7 attrib + quad
    expect(gl.createVertexArray).toHaveBeenCalledTimes(0); // VAO built in createPointVAO, not here
    expect(gl.createTexture).toHaveBeenCalledTimes(1); // label color texture
    expect(res.dataPositionBuffer).not.toBeNull();
    expect(res.sizeBuffer).not.toBeNull();
    expect(res.colorBuffer).not.toBeNull();
    expect(res.depthBuffer).not.toBeNull();
    expect(res.labelCountBuffer).not.toBeNull();
    expect(res.shapeBuffer).not.toBeNull();
    expect(res.predictedBuffer).not.toBeNull();
    expect(res.quadBuffer).not.toBeNull();
    expect(res.labelColorTexture).not.toBeNull();
  });

  it('deleteAll frees every owned handle and tolerates nulls', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    res.gammaCorrectionProgram = { k: 'gamma' } as unknown as WebGLProgram;
    res.pointVao = { k: 'vao' } as unknown as WebGLVertexArrayObject;
    res.deleteAll(gl);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(8);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
  });

  it('deleteAll uses destroyFramebuffer to free the linear framebuffer and nulls it', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.linearFramebuffer = makeFramebuffer();
    res.deleteAll(gl);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2); // label texture + framebuffer color texture
    expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(1);
    expect(res.linearFramebuffer).toBeNull();
  });

  it('validate returns true when every present handle is live', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    expect(res.validate(gl)).toBe(true);
  });

  it('validate returns false when there is no point program', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    expect(res.validate(gl)).toBe(false);
  });

  it('validate returns false when a present buffer is not a live GL buffer', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    (gl.isBuffer as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    expect(res.validate(gl)).toBe(false);
  });

  // NOTE: validate() byte-faithfully mirrors the original isRendererStateValid,
  // which deliberately did NOT check quadBuffer or linearFramebuffer. Tests for
  // those checks were removed because asserting them would lock in a behavior
  // change (changing when ensureGL resets) that is out of scope for F-61.

  it('reset nulls every handle without touching gl', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    res.gammaCorrectionProgram = { k: 'gamma' } as unknown as WebGLProgram;
    res.pointVao = { k: 'vao' } as unknown as WebGLVertexArrayObject;
    res.linearFramebuffer = makeFramebuffer();
    res.reset();
    expect(res.pointProgram).toBeNull();
    expect(res.gammaCorrectionProgram).toBeNull();
    expect(res.pointVao).toBeNull();
    expect(res.dataPositionBuffer).toBeNull();
    expect(res.sizeBuffer).toBeNull();
    expect(res.colorBuffer).toBeNull();
    expect(res.depthBuffer).toBeNull();
    expect(res.labelCountBuffer).toBeNull();
    expect(res.shapeBuffer).toBeNull();
    expect(res.predictedBuffer).toBeNull();
    expect(res.quadBuffer).toBeNull();
    expect(res.labelColorTexture).toBeNull();
    expect(res.linearFramebuffer).toBeNull();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
    expect(gl.deleteFramebuffer).not.toHaveBeenCalled();
  });
});
