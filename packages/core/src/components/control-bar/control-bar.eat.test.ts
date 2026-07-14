// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import type { ProtspaceControlBar } from './control-bar';

describe('control-bar EAT controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('enables accessible controls only when transferred cells are available', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    (
      control as unknown as {
        _handleDataChange(event: Event): void;
      }
    )._handleDataChange(
      new CustomEvent('data-change', {
        detail: {
          data: {
            protein_ids: ['P1'],
            projections: [],
            annotations: { ec: { values: ['1.1.1.1'] } },
            annotation_data: { ec: new Int32Array([0]) },
            annotation_predicted: {
              ec: [{ value: '1.1.1.1', confidence: 0.7, source: 'REF' }],
            },
          },
        },
      }),
    );
    await control.updateComplete;

    const checkbox = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-switch input')!;
    const range = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold input')!;
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(true);
    expect(range.getAttribute('aria-label')).toBe('Minimum EAT reliability index');
    expect(range.value).toBe('0.5');
  });

  it('emits one synchronized contract for toggle and keyboard-capable range input', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    const listener = vi.fn();
    control.addEventListener('eat-overlay-change', listener);
    await control.updateComplete;

    const checkbox = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-switch input')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: { enabled: false, confidenceThreshold: 0.5 },
      }),
    );
  });
});
