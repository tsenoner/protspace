import { describe, it, expect, vi } from 'vitest';
import { createLinearFramebuffer, destroyFramebuffer } from './framebuffer';

function mockGL(complete = true) {
  const calls: string[] = [];
  const gl = {
    RGBA16F: 1,
    RGBA: 2,
    HALF_FLOAT: 3,
    TEXTURE_2D: 4,
    TEXTURE_MIN_FILTER: 5,
    TEXTURE_MAG_FILTER: 6,
    LINEAR: 7,
    TEXTURE_WRAP_S: 8,
    TEXTURE_WRAP_T: 9,
    CLAMP_TO_EDGE: 10,
    RENDERBUFFER: 11,
    DEPTH_COMPONENT16: 12,
    FRAMEBUFFER: 13,
    COLOR_ATTACHMENT0: 14,
    DEPTH_ATTACHMENT: 15,
    FRAMEBUFFER_COMPLETE: 99,
    createFramebuffer: () => ({ t: 'fb' }),
    createTexture: () => ({ t: 'tex' }),
    createRenderbuffer: () => ({ t: 'rb' }),
    bindTexture: () => {},
    texImage2D: (...a: unknown[]) => calls.push(`texImage2D:${a[2]}:${a[3]}:${a[4]}:${a[7]}`),
    texParameteri: () => {},
    bindRenderbuffer: () => {},
    renderbufferStorage: (..._a: unknown[]) => calls.push('rbStorage'),
    bindFramebuffer: () => {},
    framebufferTexture2D: () => calls.push('attachColor'),
    framebufferRenderbuffer: () => calls.push('attachDepth'),
    checkFramebufferStatus: () => (complete ? 99 : 0),
    deleteFramebuffer: vi.fn(),
    deleteTexture: vi.fn(),
    deleteRenderbuffer: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

describe('createLinearFramebuffer', () => {
  it('allocates RGBA16F/HALF_FLOAT color + DEPTH_COMPONENT16 and returns resources when complete', () => {
    const { gl, calls } = mockGL(true);
    const fb = createLinearFramebuffer(gl, 320, 240);
    expect(fb).not.toBeNull();
    expect(fb).toMatchObject({ width: 320, height: 240 });
    expect(calls).toContain('texImage2D:1:320:240:3'); // RGBA16F, w, h, HALF_FLOAT
    expect(calls).toEqual(expect.arrayContaining(['rbStorage', 'attachColor', 'attachDepth']));
  });

  it('returns null and deletes all three resources when framebuffer is incomplete', () => {
    const { gl } = mockGL(false);
    expect(createLinearFramebuffer(gl, 10, 10)).toBeNull();
    expect(gl.deleteFramebuffer as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(gl.deleteRenderbuffer as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});

describe('destroyFramebuffer', () => {
  it('deletes framebuffer, texture and depthBuffer', () => {
    const { gl } = mockGL(true);
    destroyFramebuffer(gl, {
      framebuffer: {} as WebGLFramebuffer,
      texture: {} as WebGLTexture,
      depthBuffer: {} as WebGLRenderbuffer,
      width: 1,
      height: 1,
    });
    expect(gl.deleteFramebuffer as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(gl.deleteRenderbuffer as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});
