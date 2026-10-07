import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructureErrorEventDetail } from '@protspace/core';
import { createInteractionController } from './interaction-controller';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({ notify: notifyMock }));

describe('interaction controller structure errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The structure viewer shows its own error inline; a toast on top would say it twice.
  it('logs a structure-viewer error without raising a toast', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createInteractionController({
      plotElement: {} as never,
      legendElement: {} as never,
      structureViewer: {} as never,
    });
    const detail: StructureErrorEventDetail = {
      message: 'No structure available for P12345',
      severity: 'error',
      source: 'structure-viewer',
      context: { proteinId: 'P12345' },
    };

    controller.handleStructureError(new CustomEvent('structure-error', { detail }));

    expect(warn).toHaveBeenCalledWith('Structure viewer error:', detail);
    for (const level of ['success', 'info', 'warning', 'error'] as const) {
      expect(notifyMock[level]).not.toHaveBeenCalled();
    }
  });
});
