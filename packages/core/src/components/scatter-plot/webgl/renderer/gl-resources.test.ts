import { describe, it, expect, vi } from 'vitest';
import { GLResources } from './gl-resources';
import type { FramebufferResources } from '../types';
import type { DensityResources } from './density-pass';

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

function makeDensity(): DensityResources {
  return {
    contourBlurProgram: { k: 'contourBlurProg' },
    categoryAccumProgram: { k: 'categoryAccumProg' },
    categoryCompositeProgram: { k: 'categoryCompositeProg' },
    quadVao: { k: 'quadVao' },
    accum: { framebuffer: { k: 'afb' }, texture: { k: 'atex' }, width: 4, height: 4 },
    ping: null,
    fields: [],
  } as unknown as DensityResources;
}

describe('GLResources', () => {
  it('createAll allocates all vertex buffers plus the quad, label and record textures', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    expect(gl.createBuffer).toHaveBeenCalledTimes(9); // 7 attrib + record id + quad
    expect(gl.createVertexArray).toHaveBeenCalledTimes(0); // VAO built in createPointVAO, not here
    expect(gl.createTexture).toHaveBeenCalledTimes(2); // label colours + record styles
    expect(res.dataPositionBuffer).not.toBeNull();
    expect(res.sizeBuffer).not.toBeNull();
    expect(res.colorBuffer).not.toBeNull();
    expect(res.depthBuffer).not.toBeNull();
    expect(res.labelCountBuffer).not.toBeNull();
    expect(res.shapeBuffer).not.toBeNull();
    expect(res.predictedBuffer).not.toBeNull();
    expect(res.quadBuffer).not.toBeNull();
    expect(res.recordBuffer).not.toBeNull();
    expect(res.labelColorTexture).not.toBeNull();
    expect(res.recordStyleTexture).not.toBeNull();
  });

  it('deleteAll frees every owned handle and tolerates nulls', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    res.gammaCorrectionProgram = { k: 'gamma' } as unknown as WebGLProgram;
    res.pointVao = { k: 'vao' } as unknown as WebGLVertexArrayObject;
    res.deleteAll(gl);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(9);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
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
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3); // label + record textures, framebuffer's
    expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(1);
    expect(res.linearFramebuffer).toBeNull();
  });

  it('deleteAll destroys the density resources and nulls the field', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.density = makeDensity();
    res.deleteAll(gl);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(res.density).toBeNull();
  });

  it('reset nulls every handle without touching gl', () => {
    const gl = makeGl();
    const res = new GLResources();
    res.createAll(gl);
    res.pointProgram = { k: 'prog' } as unknown as WebGLProgram;
    res.gammaCorrectionProgram = { k: 'gamma' } as unknown as WebGLProgram;
    res.pointVao = { k: 'vao' } as unknown as WebGLVertexArrayObject;
    res.linearFramebuffer = makeFramebuffer();
    res.density = makeDensity();
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
    expect(res.recordBuffer).toBeNull();
    expect(res.labelColorTexture).toBeNull();
    expect(res.recordStyleTexture).toBeNull();
    expect(res.linearFramebuffer).toBeNull();
    expect(res.density).toBeNull();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
    expect(gl.deleteFramebuffer).not.toHaveBeenCalled();
  });
});
