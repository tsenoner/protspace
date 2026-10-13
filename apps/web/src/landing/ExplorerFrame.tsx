/**
 * The explorer's chrome, rebuilt in plain HTML so landing sections read as the same product as
 * /explore without loading it: off-white canvas, white toolbar, plot panel with a point-count
 * chip, and the legend panel on the right.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Category } from './landing-data';
import { NEUTRAL_COLOR } from './ScatterCanvas';

/** Surface tokens copied from packages/core/src/styles/tokens.ts. */
const UI = {
  page: '#f4f4f4',
  border: '#d9e2ec',
  row: '#f6f8fb',
  text: '#334155',
  muted: '#5b6b7a',
};

/** "12 of 294" when named categories were collapsed into Other, else the category count. */
function categorySummary(categories: Category[]): string {
  const named = categories.filter((category) => !category.kind).length;
  const other = categories.find((category) => category.kind === 'other');
  return other?.collapsed ? `${named} of ${named + other.collapsed}` : `${named}`;
}

interface ExplorerFrameProps {
  /** Toolbar content: the section's own controls. The toolbar is omitted when there is none. */
  toolbar?: ReactNode;
  /** The plot, usually a `ScatterCanvas`; it fills the plot panel. */
  children: ReactNode;
  legendTitle: string;
  categories: Category[];
  /** Show only the first N named rows; Other and N/A are always appended. */
  legendRows: number;
  /** Set false to drop the legend panel, e.g. when there is no data to describe. */
  showLegend?: boolean;
  /** Legend swatches stay neutral until the section has revealed its colors. */
  colored: boolean;
  count?: number;
  busy?: boolean;
  /** Sizes the plot panel, e.g. `aspect-[4/3] lg:aspect-auto lg:h-[600px]`. */
  plotClassName?: string;
}

export function ExplorerFrame({
  toolbar,
  children,
  legendTitle,
  categories,
  legendRows,
  showLegend = true,
  colored,
  count,
  busy,
  plotClassName,
}: ExplorerFrameProps) {
  const named = categories.filter((category) => !category.kind);
  const rows = [...named.slice(0, legendRows), ...categories.filter((category) => category.kind)];

  return (
    <div className="rounded-2xl border border-border/70 p-2 sm:p-3" style={{ background: UI.page }}>
      {toolbar ? (
        <div
          className="mb-2 flex flex-wrap items-center rounded-md border bg-white gap-x-5 gap-y-2 px-3 py-2"
          style={{ borderColor: UI.border }}
        >
          {toolbar}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 lg:flex-row">
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

        {showLegend ? (
          <div
            className="shrink-0 rounded-md border bg-white p-2 lg:w-64"
            style={{ borderColor: UI.border }}
          >
            <div className="flex items-baseline justify-between gap-2 px-2 pb-2 pt-1 text-sm">
              <span className="font-medium" style={{ color: UI.text }}>
                {legendTitle}
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: UI.muted }}>
                {categorySummary(categories)}
              </span>
            </div>
            <ul
              className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2 lg:grid-cols-1"
              aria-label={`Legend for ${legendTitle}`}
            >
              {rows.map((category) => (
                <li
                  key={category.label}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: UI.row, color: UI.text }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block shrink-0 rounded-full ring-1 ring-inset ring-black/25 h-3.5 w-3.5"
                    style={{
                      background: colored ? category.color : NEUTRAL_COLOR,
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
        ) : null}
      </div>
    </div>
  );
}
