// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import type { ProtspaceControlBar } from './control-bar';

type ControlBarDataSeam = ProtspaceControlBar & {
  _handleDataChange(event: Event): void;
  _scatterplotElement: (HTMLElement & { data?: unknown }) | null;
};

function setData(control: ProtspaceControlBar, annotationPredicted?: Array<unknown | null>): void {
  (control as ControlBarDataSeam)._handleDataChange(
    new CustomEvent('data-change', {
      detail: {
        data: {
          protein_ids: ['P1'],
          projections: [],
          annotations: {
            ec: { values: ['1.1.1.1'] },
            family: { values: ['PF1'] },
          },
          annotation_data: { ec: new Int32Array([0]), family: new Int32Array([0]) },
          ...(annotationPredicted ? { annotation_predicted: { ec: annotationPredicted } } : {}),
        },
      },
    }),
  );
}

describe('control-bar EAT controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('enables accessible controls only when transferred cells are available', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    setData(control, [{ value: '1.1.1.1', confidence: 0.7, source: 'REF' }]);
    await control.updateComplete;

    const group = control.shadowRoot!.querySelector<HTMLFieldSetElement>('.eat-controls')!;
    const checkbox = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-switch input')!;
    const range = control.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    const percent = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')!;
    expect(group.querySelector('legend')?.textContent).toBe('Embedding Annotation Transfer');
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(true);
    expect(group.textContent).toContain('Emphasize reliability ≥');
    expect(range.getAttribute('aria-label')).toBe('EAT reliability emphasis threshold');
    expect(range.value).toBe('0.5');
    expect(percent.value).toBe('50');
    const info = group.querySelector('protspace-info-popover') as HTMLElement & {
      description?: string;
    };
    expect(info.description).toContain('remain visible but are dimmed');
    expect(info.description).toContain('EC number — EAT confidence');

    const annotationGroup = control.shadowRoot!.querySelector('#annotation-select')!.parentElement!;
    expect(
      annotationGroup.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('omits the complete control group for a dataset without usable transfers', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    setData(control);
    await control.updateComplete;

    expect(control.shadowRoot!.querySelector('.eat-controls')).toBeNull();
    expect(control.shadowRoot!.querySelector('.eat-switch')).toBeNull();
    expect(control.shadowRoot!.querySelector('.eat-threshold')).toBeNull();
  });

  it('emits one synchronized contract for toggle and keyboard-capable range input', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    setData(control, [{ value: '1.1.1.1', confidence: 0.7, source: 'REF' }]);
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

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    const percent = control.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')!;
    percent.value = '73';
    percent.dispatchEvent(new Event('input'));
    await control.updateComplete;
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { enabled: true, confidenceThreshold: 0.73 } }),
    );
    expect(
      control.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold input[type="range"]')!
        .value,
    ).toBe('0.73');
  });

  it('gates controls by the selected annotation in a mixed-capability dataset', async () => {
    const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
    control.autoSync = false;
    document.body.append(control);
    setData(control, [{ value: '1.1.1.1', confidence: 0.7, source: 'REF' }]);
    await control.updateComplete;

    expect(control.shadowRoot!.querySelector('.eat-controls')).not.toBeNull();
    control.applyAnnotationSelection('family');
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector('.eat-controls')).toBeNull();
    control.applyAnnotationSelection('ec');
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector('.eat-controls')).not.toBeNull();
  });

  it.each(['filtering', 'isolation'])(
    'retains stable EAT capability when a %s slice has no predicted rows',
    async () => {
      const control = document.createElement('protspace-control-bar') as ProtspaceControlBar;
      control.autoSync = false;
      const stableData = {
        protein_ids: ['P1', 'P2'],
        projections: [],
        annotations: {
          ec: { values: ['1.1.1.1'] },
          family: { values: ['PF1'] },
        },
        annotation_data: {
          ec: new Int32Array([0, 0]),
          family: new Int32Array([0, 0]),
        },
        annotation_predicted: {
          ec: [null, { value: '1.1.1.1', confidence: 0.7, source: 'P1' }],
        },
      };
      const scatterplot = document.createElement('div') as HTMLElement & { data?: unknown };
      scatterplot.data = stableData;
      (control as ControlBarDataSeam)._scatterplotElement = scatterplot;
      document.body.append(control);

      setData(control, [null]);
      await control.updateComplete;

      expect(control.shadowRoot!.querySelector('.eat-controls')).not.toBeNull();
      const annotationSelect = control.shadowRoot!.querySelector(
        'protspace-annotation-select',
      ) as HTMLElement & { eatAnnotations?: string[] };
      expect(annotationSelect.eatAnnotations).toContain('ec');
    },
  );
});
