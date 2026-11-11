import { describe, expect, it } from 'vitest';
import { bindAnnotationChange } from './annotation-change';

function setup() {
  const root = new EventTarget();
  const calls: string[] = [];
  const dispose = bindAnnotationChange({
    root: root as unknown as Document,
    viewBar: { handleAnnotationChanged: () => calls.push('view bar') },
    filter: { setSelectedAnnotation: (annotation) => calls.push(`filter ${annotation}`) },
    eat: { handleAnnotationChange: () => calls.push('eat') },
  });
  const pick = (detail: unknown) =>
    root.dispatchEvent(new CustomEvent('annotation-change', { detail }));
  return { calls, dispose, pick };
}

describe('bindAnnotationChange', () => {
  it('calls the view bar, then the filter with the annotation, then the EAT panel', () => {
    const { calls, pick } = setup();
    pick({ annotation: 'ec' });
    expect(calls).toEqual(['view bar', 'filter ec', 'eat']);
    pick({ annotation: 'family' });
    expect(calls.slice(3)).toEqual(['view bar', 'filter family', 'eat']);
  });

  it('keeps that order whatever else listens on the document first', () => {
    const root = new EventTarget();
    const calls: string[] = [];
    // A listener registered earlier (the legend's) runs first; the three still run in turn.
    root.addEventListener('annotation-change', () => calls.push('legend'));
    bindAnnotationChange({
      root: root as unknown as Document,
      eat: { handleAnnotationChange: () => calls.push('eat') },
      filter: { setSelectedAnnotation: () => calls.push('filter') },
      viewBar: { handleAnnotationChanged: () => calls.push('view bar') },
    });
    root.dispatchEvent(new CustomEvent('annotation-change', { detail: { annotation: 'ec' } }));
    expect(calls).toEqual(['legend', 'view bar', 'filter', 'eat']);
  });

  it('leaves the filter alone for an event without an annotation', () => {
    const { calls, pick } = setup();
    pick(undefined);
    expect(calls).toEqual(['view bar', 'eat']);
  });

  it('stops listening once disposed', () => {
    const { calls, dispose, pick } = setup();
    dispose();
    pick({ annotation: 'ec' });
    expect(calls).toEqual([]);
  });
});
