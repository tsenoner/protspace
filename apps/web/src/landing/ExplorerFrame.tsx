/**
 * The explorer's chrome, rebuilt in plain HTML so landing sections read as the same product as
 * /explore without loading it: off-white canvas, white toolbar, plot panel with a point-count
 * chip, and the legend panel on the right.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Category } from './landing-data';

/** Surface tokens copied from packages/core/src/styles/tokens.ts. */
const UI = {
  page: '#f4f4f4',
  border: '#d9e2ec',
  row: '#f6f8fb',
  text: '#334155',
  muted: '#5b6b7a',
};
const NEUTRAL_SWATCH = '#c4cad3';

export function ToolbarChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span style={{ color: UI.muted }}>{label}</span>
      <span
        className="rounded-[4px] border bg-white px-1.5 py-0.5 font-medium"
        style={{ borderColor: UI.border, color: UI.text }}
      >
        {children}
      </span>
    </span>
  );
}

/** "12 of 294" when named categories were collapsed into Other, else the category count. */
function categorySummary(categories: Category[]): string {
  const named = categories.filter((category) => !category.kind).length;
  const other = categories.find((category) => category.kind === 'other');
  return other?.collapsed ? `${named} of ${named + other.collapsed}` : `${named}`;
}

interface ExplorerFrameProps {
  /** Toolbar content, normally `ToolbarChip`s and the section's own control. */
  toolbar: ReactNode;
  /** The plot, usually a `ScatterCanvas`; it fills the plot panel. */
  children: ReactNode;
  legendTitle: string;
  categories: Category[];
  /** Show only the first N named rows; Other and N/A are always appended. */
  legendRows?: number;
  /** Legend swatches stay neutral until the section has revealed its colors. */
  colored?: boolean;
  count?: number;
  busy?: boolean;
  /** Smaller type and tighter rows for a miniature. */
  compact?: boolean;
  className?: string;
  /** Sizes the plot panel, e.g. `aspect-[4/3] lg:aspect-auto lg:h-[600px]`. */
  plotClassName?: string;
}

export function ExplorerFrame({
  toolbar,
  children,
  legendTitle,
  categories,
  legendRows,
  colored = true,
  count,
  busy,
  compact,
  className,
  plotClassName,
}: ExplorerFrameProps) {
  const named = categories.filter((category) => !category.kind);
  const rows = [
    ...(legendRows === undefined ? named : named.slice(0, legendRows)),
    ...categories.filter((category) => category.kind),
  ];

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70',
        compact ? 'p-1.5' : 'p-2 sm:p-3',
        className,
      )}
      style={{ background: UI.page }}
    >
      <div
        className={cn(
          'flex flex-wrap items-center rounded-md border bg-white',
          compact ? 'gap-x-3 gap-y-1 px-2 py-1.5' : 'gap-x-5 gap-y-2 px-3 py-2',
        )}
        style={{ borderColor: UI.border }}
      >
        {toolbar}
      </div>

      <div
        className={cn(
          'flex flex-col',
          compact ? 'mt-1.5 gap-1.5 sm:flex-row' : 'mt-2 gap-2 lg:flex-row',
        )}
      >
        <div
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden rounded-md border bg-white',
            plotClassName,
          )}
          style={{ borderColor: UI.border }}
          aria-busy={busy}
        >
          {children}
          {count ? (
            <span
              className="pointer-events-none absolute bottom-2 left-2 rounded-[4px] border bg-white/90 px-1.5 py-0.5 text-[11px] tabular-nums"
              style={{ borderColor: UI.border, color: UI.text }}
            >
              {count.toLocaleString()} points
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            'shrink-0 rounded-md border bg-white',
            compact ? 'p-1.5 sm:w-48' : 'p-2 lg:w-64',
          )}
          style={{ borderColor: UI.border }}
        >
          <div
            className={cn(
              'flex items-baseline justify-between gap-2 px-2',
              compact ? 'pb-1 text-[11px]' : 'pb-2 pt-1 text-sm',
            )}
          >
            <span className="font-medium" style={{ color: UI.text }}>
              {legendTitle}
            </span>
            <span className="text-[11px] tabular-nums" style={{ color: UI.muted }}>
              {categorySummary(categories)}
            </span>
          </div>
          <ul
            className={cn(
              'grid grid-cols-1 gap-1',
              compact ? 'text-[11px]' : 'text-[13px] sm:grid-cols-2 lg:grid-cols-1',
            )}
            aria-label={`Legend for ${legendTitle}`}
          >
            {rows.map((category) => (
              <li
                key={category.label}
                className={cn(
                  'flex items-center gap-2 rounded-lg',
                  compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1.5',
                )}
                style={{ background: UI.row, color: UI.text }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block shrink-0 rounded-full ring-1 ring-inset ring-black/25',
                    compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
                  )}
                  style={{
                    background: colored ? category.color : NEUTRAL_SWATCH,
                    transition: 'background 550ms ease',
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                <span className="tabular-nums" style={{ color: UI.muted }}>
                  {category.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
