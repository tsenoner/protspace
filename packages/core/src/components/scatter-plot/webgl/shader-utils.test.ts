import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  beginProgramFromSources,
  createProgramFromSources,
  discardProgram,
  finishProgram,
} from './shader-utils';

const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

/** A GL stub that records call order and lets a test fail a shader or the link. */
function makeGl(opts: { failShader?: 'vertex' | 'fragment' | 'both'; failLink?: boolean } = {}) {
  const calls: string[] = [];
  let shaderId = 0;
  const kinds = new Map<unknown, 'vertex' | 'fragment'>();
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS,
    LINK_STATUS,
    createShader: vi.fn((type: number) => {
      const shader = { id: ++shaderId };
      kinds.set(shader, type === 0x8b31 ? 'vertex' : 'fragment');
      calls.push(`createShader:${kinds.get(shader)}`);
      return shader;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn((s: unknown) => calls.push(`compile:${kinds.get(s)}`)),
    createProgram: vi.fn(() => ({ id: 'program' })),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn((_p: unknown, i: number, n: string) => calls.push(`bind:${n}=${i}`)),
    linkProgram: vi.fn(() => calls.push('link')),
    getShaderParameter: vi.fn((s: unknown) => {
      calls.push(`status:${kinds.get(s)}`);
      return !(opts.failShader === 'both' || opts.failShader === kinds.get(s));
    }),
    getProgramParameter: vi.fn(() => {
      calls.push('status:link');
      return !opts.failLink;
    }),
    getShaderInfoLog: vi.fn((s: unknown) => `${kinds.get(s)} log`),
    getProgramInfoLog: vi.fn(() => 'link log'),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, mock: gl, calls };
}

describe('shader-utils', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('beginProgramFromSources', () => {
    it('hands the driver everything and reads nothing back', () => {
      const { gl, calls } = makeGl();
      const pending = beginProgramFromSources(gl, 'vs', 'fs');

      expect(pending).not.toBeNull();
      expect(calls).toEqual([
        'createShader:vertex',
        'compile:vertex',
        'createShader:fragment',
        'compile:fragment',
        'link',
      ]);
    });

    it('binds attribute locations before the link', () => {
      const { gl, calls } = makeGl();
      beginProgramFromSources(gl, 'vs', 'fs', { a_position: 0, a_color: 1 });
      expect(calls.slice(-3)).toEqual(['bind:a_position=0', 'bind:a_color=1', 'link']);
    });

    it('returns null and releases what it made when a shader cannot be created', () => {
      const { gl, mock } = makeGl();
      mock.createShader.mockReturnValueOnce(null as never);
      expect(beginProgramFromSources(gl, 'vs', 'fs')).toBeNull();
      expect(mock.deleteShader).toHaveBeenCalledTimes(1);
      expect(mock.linkProgram).not.toHaveBeenCalled();
    });
  });

  describe('finishProgram', () => {
    it('returns the program and frees the shaders once linked', () => {
      const { gl, mock } = makeGl();
      const pending = beginProgramFromSources(gl, 'vs', 'fs')!;
      expect(finishProgram(gl, pending)).toBe(pending.program);
      expect(mock.deleteShader).toHaveBeenCalledTimes(2);
      expect(mock.deleteProgram).not.toHaveBeenCalled();
    });

    it('reports each shader that failed to compile, and no link error', () => {
      const { gl, mock } = makeGl({ failShader: 'both' });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pending = beginProgramFromSources(gl, 'vs', 'fs')!;

      expect(finishProgram(gl, pending)).toBeNull();
      expect(errors.mock.calls).toEqual([
        ['Shader compile error:', 'vertex log'],
        ['Shader compile error:', 'fragment log'],
      ]);
      expect(mock.getProgramParameter).not.toHaveBeenCalled();
      expect(mock.deleteProgram).toHaveBeenCalledWith(pending.program);
      expect(mock.deleteShader).toHaveBeenCalledTimes(2);
    });

    it('reports a link failure with the program log', () => {
      const { gl, mock } = makeGl({ failLink: true });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pending = beginProgramFromSources(gl, 'vs', 'fs')!;

      expect(finishProgram(gl, pending)).toBeNull();
      expect(errors.mock.calls).toEqual([['Program link error:', 'link log']]);
      expect(mock.deleteProgram).toHaveBeenCalledWith(pending.program);
    });
  });

  it('discardProgram releases the program and both shaders', () => {
    const { gl, mock } = makeGl();
    discardProgram(gl, beginProgramFromSources(gl, 'vs', 'fs')!);
    expect(mock.deleteShader).toHaveBeenCalledTimes(2);
    expect(mock.deleteProgram).toHaveBeenCalledTimes(1);
  });

  describe('createProgramFromSources', () => {
    it('builds a linked program in one call', () => {
      const { gl } = makeGl();
      expect(createProgramFromSources(gl, 'vs', 'fs')).toEqual({ id: 'program' });
    });

    it('surfaces the same errors as the two-step form', () => {
      const { gl } = makeGl({ failShader: 'fragment' });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(createProgramFromSources(gl, 'vs', 'fs')).toBeNull();
      expect(errors.mock.calls).toEqual([['Shader compile error:', 'fragment log']]);
    });
  });
});
