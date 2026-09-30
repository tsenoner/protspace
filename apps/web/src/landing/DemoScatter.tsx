import { useCallback, useState } from 'react';
import { loadDemoLabels, type Category, type DemoLabels } from './landing-data';

/** Fetch protein IDs and names the first time a point is hovered, not before. */
export function useHoverLabels() {
  const [labels, setLabels] = useState<DemoLabels | null>(null);
  const onHover = useCallback(
    (index: number | null) => {
      if (index !== null && !labels)
        loadDemoLabels()
          .then(setLabels)
          .catch(() => undefined);
    },
    [labels],
  );
  return { labels, onHover };
}

/** Tooltip body for one demo protein: accession, name, and its category for the shown annotation. */
export function ProteinTooltip({
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
