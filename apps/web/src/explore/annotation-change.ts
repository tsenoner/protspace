/**
 * The app's one listener for Color by's `annotation-change`, so the controllers that follow Color
 * by run in a fixed order, not in the order they happened to be created:
 *
 * 1. the view bar clears the provenance connectors and the plot's hidden values, re-syncs the
 *    legend, and tells the view controller;
 * 2. the filter moves to the new annotation and mirrors that annotation's reliability filter into
 *    the EAT panel;
 * 3. the EAT panel follows Color by, reading the filter's context and the other annotations'
 *    reliability filters, which step 2 has just updated.
 *
 * Two listeners stay apart. The view bar's own listener on the picker has already set the plot's
 * annotation: it runs at the target, before any listener on the document. The legend keeps its own
 * document listener, since it is a core component that works outside the app; it registers when it
 * connects, before the runtime starts, so it runs before this one.
 */
export function bindAnnotationChange({
  root,
  viewBar,
  filter,
  eat,
}: {
  /** Where the bubbling, composed event is heard: the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  viewBar: { handleAnnotationChanged(): void };
  filter: { setSelectedAnnotation(annotation: string): void };
  eat: { handleAnnotationChange(): void };
}): () => void {
  const onAnnotationChange = (event: Event) => {
    const annotation = (event as CustomEvent<{ annotation?: unknown }>).detail?.annotation;
    viewBar.handleAnnotationChanged();
    if (typeof annotation === 'string') filter.setSelectedAnnotation(annotation);
    eat.handleAnnotationChange();
  };
  root.addEventListener('annotation-change', onAnnotationChange);
  return () => root.removeEventListener('annotation-change', onAnnotationChange);
}
