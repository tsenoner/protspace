import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ScatterCanvas } from './ScatterCanvas';
import { Section, SectionHeading } from './Section';
import { loadVenomData, normalize, useLandingData } from './landing-data';

/** Faithfulness metrics stored per projection, mapped to the labels the explorer uses. */
const GROUPS = [
  {
    title: 'Local · neighborhood preservation',
    metrics: [
      ['knn_overlap', 'kNN Overlap'],
      ['trustworthiness', 'Trustworthiness'],
      ['continuity', 'Continuity'],
    ],
  },
  {
    title: 'Global · layout preservation',
    metrics: [
      ['random_triplet', 'Random Triplet'],
      ['spearman_distance', 'Spearman Distance'],
    ],
  },
] as const;

/** "ProtT5 · UMAP 2" to "UMAP 2", for the narrow table header. */
function shortName(name: string): string {
  return name.split('·').pop()?.trim() || name;
}

/**
 * Two projections of the same embedding, side by side, with one table of faithfulness scores
 * underneath. The point is that neither map wins on every metric.
 */
export function ProjectionEvaluationPreview() {
  const venom = useLandingData(loadVenomData);

  const plots = useMemo(
    () =>
      venom?.projections.map((projection) => ({
        name: projection.name,
        x: normalize(projection.x),
        y: normalize(projection.y),
      })) ?? [],
    [venom],
  );

  const palette = venom?.families.categories.map((category) => category.color) ?? [];
  const baseCategories =
    venom?.families.categories.flatMap((category, i) => (category.kind ? [i] : [])) ?? [];
  const k = venom?.projections[0]?.quality.knn_overlap?.k;
  const code = 'whitespace-nowrap font-mono text-[13px] text-foreground';

  return (
    <Section id="evaluation" tone="muted">
      <SectionHeading
        eyebrow="Projection quality"
        title="A clean-looking map is not evidence"
        lede="ProtSpace scores how faithfully a projection preserves the embedding it came from. Here UMAP keeps local neighborhoods better and PCA keeps the global layout better; neither is simply right."
      />

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:mt-12">
        {(plots.length ? plots : [null, null]).map((plot, i) => (
          <div
            key={plot?.name ?? i}
            className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/70 bg-white"
            aria-busy={venom === undefined}
          >
            {plot && venom ? (
              <>
                <ScatterCanvas
                  x={plot.x}
                  y={plot.y}
                  categories={venom.families.values}
                  palette={palette}
                  baseCategories={baseCategories}
                  pointRadius={2.4}
                  aria-label={`${plot.name} of ${venom.count.toLocaleString()} venom proteins colored by ${venom.families.label.toLowerCase()}`}
                />
                <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/70 bg-white/90 px-2 py-0.5 text-xs font-medium text-foreground">
                  {plot.name}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>

      {venom ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Both panels: the {venom.count.toLocaleString()}-protein venom example bundle and the same
          ProtT5 embedding, colored by {venom.families.label.toLowerCase()}.
        </p>
      ) : null}

      <div
        className="mt-8 rounded-2xl border border-border/70 bg-white p-5 sm:p-6"
        aria-busy={venom === undefined}
      >
        {venom ? (
          <>
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                Faithfulness metrics per projection, higher is better
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="w-[44%] pb-2 text-left text-xs font-medium text-muted-foreground sm:w-[26%]"
                  >
                    Metric
                  </th>
                  {plots.map((plot) => (
                    <th
                      key={plot.name}
                      scope="col"
                      className="pb-2 text-left text-xs font-medium text-foreground"
                    >
                      {shortName(plot.name)}
                      <span className="sr-only"> ({plot.name})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              {GROUPS.map((group) => (
                <tbody key={group.title} className="border-t border-border/70">
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={1 + plots.length}
                      className="pb-1.5 pt-4 text-left font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {group.title}
                    </th>
                  </tr>
                  {group.metrics.map(([key, label]) => {
                    const values = venom.projections.map(
                      (projection) => projection.quality[key]?.value ?? null,
                    );
                    const best = Math.max(...values.map((value) => value ?? -Infinity));
                    return (
                      <tr key={key}>
                        <th
                          scope="row"
                          className="py-1.5 pr-4 text-left font-normal text-foreground/90"
                        >
                          {label}
                        </th>
                        {values.map((value, i) => {
                          const leads = value !== null && value === best;
                          return (
                            <td key={plots[i]?.name ?? i} className="py-1.5 pr-4">
                              <div className="flex items-center gap-3">
                                <div
                                  aria-hidden="true"
                                  className="hidden h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted sm:block"
                                >
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      leads ? 'bg-foreground/80' : 'bg-foreground/30',
                                    )}
                                    style={{
                                      width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  className={cn(
                                    'w-8 shrink-0 text-right tabular-nums',
                                    leads ? 'font-medium text-foreground' : 'text-muted-foreground',
                                  )}
                                >
                                  {value === null ? 'n/a' : value.toFixed(2)}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
            <p className="mt-4 border-t border-border/70 pt-3 text-xs text-muted-foreground">
              {k === undefined ? null : <>k = {k} nearest neighbors · </>}higher is better for all
              five
            </p>
          </>
        ) : (
          <div className="min-h-[16rem]" />
        )}
      </div>

      <p className="mt-8 max-w-3xl text-base leading-relaxed text-muted-foreground">
        Separation scores (Silhouette, Davies–Bouldin, Calinski–Harabasz) test whether an annotation
        forms clusters, with its value in the embedding as the ceiling; ARI and NMI score how well a
        clustering recovers each annotation. Statistics are opt-in:{' '}
        <code className={code}>protspace prepare --stats</code>, or{' '}
        <code className={code}>protspace stats</code> later, and they ride inside the bundle.
      </p>
    </Section>
  );
}
