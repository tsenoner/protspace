import { useEffect, useState, type RefObject } from 'react';
import { createDragDepth, isFileDrag } from '../explore/file-drop';

/**
 * Drops anywhere on the workbench load the file (design decision 15): the shell owns drops, not
 * the plot. Only drags that carry files count, so text drags and the legend's row reordering
 * neither light the drop area nor lose their own drop. Listens in the capture phase, so a panel
 * underneath (Mol* in the structure viewer) never opens the file too. Returns whether a file drag
 * is over the workbench.
 */
export function useFileDrop(root: RefObject<HTMLElement | null>): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const depth = createDragDepth();
    const carriesFiles = (event: DragEvent) =>
      !!event.dataTransfer && isFileDrag(event.dataTransfer.types);
    const end = () => {
      depth.reset();
      setDragging(false);
    };

    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (depth.enter()) setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Allows the drop; a text drag keeps the browser's default (a drop into the search box).
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      if (depth.leave()) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      end();
      const file = event.dataTransfer!.files[0];
      if (!file) return;
      // The runtime listens on the data loader (runtime.ts) and loads it as a user import.
      document
        .getElementById('myDataLoader')
        ?.dispatchEvent(new CustomEvent('file-dropped', { detail: { file }, bubbles: true }));
    };

    // Outside the workbench (the loading overlay over an inert workbench, a dialog) a file drop
    // does nothing, rather than the browser opening the file in place of the app. A drag the
    // workbench already took is left alone.
    const onStrayOver = (event: DragEvent) => {
      if (!carriesFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'none';
    };
    const onStrayDrop = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };

    element.addEventListener('dragenter', onEnter, true);
    element.addEventListener('dragover', onOver, true);
    element.addEventListener('dragleave', onLeave, true);
    element.addEventListener('drop', onDrop, true);
    window.addEventListener('blur', end);
    window.addEventListener('dragend', end);
    window.addEventListener('dragover', onStrayOver);
    window.addEventListener('drop', onStrayDrop);
    return () => {
      element.removeEventListener('dragenter', onEnter, true);
      element.removeEventListener('dragover', onOver, true);
      element.removeEventListener('dragleave', onLeave, true);
      element.removeEventListener('drop', onDrop, true);
      window.removeEventListener('blur', end);
      window.removeEventListener('dragend', end);
      window.removeEventListener('dragover', onStrayOver);
      window.removeEventListener('drop', onStrayDrop);
    };
  }, [root]);

  return dragging;
}
