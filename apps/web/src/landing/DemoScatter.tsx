import { useCallback, useRef, useState } from 'react';
import { ScatterCanvas, type ScatterCanvasProps } from './ScatterCanvas';
import {
  loadDemoLabels,
  type Category,
  type DemoAnnotation,
  type DemoLabels,
} from './landing-data';

type DemoScatterProps = Omit<
  ScatterCanvasProps,
  'index' | 'categories' | 'onHover' | 'renderTooltip'
> & {
  annotation: DemoAnnotation;
};

/** The demo map colored by one annotation, with protein tooltips on hover. */
export function DemoScatter({ annotation, ...props }: DemoScatterProps) {
  const { labels, onHover } = useHoverLabels();
  return (
    <ScatterCanvas
      {...props}
      index={annotation.index}
      categories={annotation.categories}
      onHover={onHover}
      renderTooltip={(index) => (
        <ProteinTooltip
          index={index}
          labels={labels}
          category={annotation.categories[annotation.index[index]]}
        />
      )}
    />
  );
}

/**
 * Fetch protein IDs and names the first time a point is hovered, not before. A failed fetch is
 * not retried on every further hover; a remount (reload) tries again.
 */
function useHoverLabels() {
  const [labels, setLabels] = useState<DemoLabels | null>(null);
  const failed = useRef(false);
  const onHover = useCallback(
    (index: number | null) => {
      if (index !== null && !labels && !failed.current)
        loadDemoLabels()
          .then(setLabels)
          .catch(() => {
            failed.current = true;
          });
    },
    [labels],
  );
  return { labels, onHover };
}

/** Tooltip body for one demo protein: accession, name, and its category for the shown annotation. */
function ProteinTooltip({
  index,
  labels,
  category,
}: {
  index: number;
  labels: DemoLabels | null;
  category: Category;
}) {
  return (
    <div className="space-y-1">
      <div className="font-semibold tracking-tight">{labels?.ids[index] ?? '…'}</div>
      {labels?.names[index] ? (
        <div className="text-muted-foreground">{labels.names[index]}</div>
      ) : null}
      <div className="flex items-center gap-1.5 pt-0.5">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: category.color }}
        />
        <span>
          {category.label}
          <span className="text-muted-foreground">
            {' '}
            · {category.count.toLocaleString()} proteins
          </span>
        </span>
      </div>
    </div>
  );
}
