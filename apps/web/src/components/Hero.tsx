import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DOCS_URL } from '@/config';
import { ScatterCanvas, toPercent } from '@/landing/ScatterCanvas';
import { ProteinTooltip, useHoverLabels } from '@/landing/ProteinTooltip';
import { loadDemoData, useLandingData } from '@/landing/landing-data';
import { prefersReducedMotion } from '@/landing/motion';
import { cn } from '@/lib/utils';
import { PUBLICATION_WEB, doiUrl } from '../../../../config/citations';

const HERO_ANNOTATION = 'protein_families';
const LABELED_FAMILIES = 6;
const REVEAL_MS = 1200;

interface MapLabel {
  label: string;
  color: string;
  nx: number;
  ny: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Place-names for the map: the largest families, each label snapped to the member protein
 * nearest the family's median position so it sits on a real cluster. Labels that would collide
 * with an earlier one are skipped.
 */
function familyLabels(
  x: Float32Array,
  y: Float32Array,
  index: Uint8Array,
  categories: { label: string; color: string; kind?: string }[],
): MapLabel[] {
  const out: MapLabel[] = [];
  categories.forEach((category, c) => {
    if (category.kind || out.length >= LABELED_FAMILIES) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < index.length; i++) {
      if (index[i] === c) {
        xs.push(x[i]);
        ys.push(y[i]);
      }
    }
    if (xs.length < 5) return;
    const mx = median(xs);
    const my = median(ys);
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < index.length; i++) {
      if (index[i] !== c) continue;
      const d = (x[i] - mx) ** 2 + (y[i] - my) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    const nx = x[best];
    const ny = y[best];
    if (out.some((placed) => Math.abs(placed.nx - nx) < 0.22 && Math.abs(placed.ny - ny) < 0.07))
      return;
    out.push({ label: category.label, color: category.color, nx, ny });
  });
  return out;
}

const Hero = () => {
  const demo = useLandingData(loadDemoData);
  const { labels, onHover } = useHoverLabels();
  const [lit, setLit] = useState(prefersReducedMotion);

  const annotation = demo?.annotations.find((entry) => entry.column === HERO_ANNOTATION);
  const palette = annotation?.categories.map((category) => category.color) ?? [];
  const baseCategories =
    annotation?.categories.flatMap((category, i) => (category.kind ? [i] : [])) ?? [];
  const mapLabels = useMemo(
    () =>
      demo && annotation
        ? familyLabels(demo.x, demo.y, annotation.index, annotation.categories)
        : [],
    [demo, annotation],
  );

  // The map appears in neutral grey and lights up once: the page's one entrance.
  useEffect(() => {
    if (!demo || lit) return;
    const timer = window.setTimeout(() => setLit(true), 300);
    return () => window.clearTimeout(timer);
  }, [demo, lit]);

  return (
    <section id="home" className="relative overflow-hidden pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 py-14 sm:py-20 lg:min-h-[640px] lg:max-h-[880px] lg:grid-cols-12 lg:py-16 lg:h-[calc(100vh-3rem)]">
          <div className="min-w-0 lg:col-span-6 xl:col-span-5">
            <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[2.75rem] lg:leading-[1.05] xl:text-[3.5rem] 2xl:text-[3.75rem]">
              <span className="block">Your Journey Through</span>
              <span className="block text-primary">Protein Universe</span>
            </h1>
            <p className="mt-6 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              Explore protein language model embeddings through their biological context. Prepare a
              dataset in Python, then explore it interactively in the browser.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" className="px-6" asChild>
                <Link to="/explore">Start exploring</Link>
              </Button>
              <Button size="lg" variant="outline" className="px-6" asChild>
                <a href={`${DOCS_URL}guide/data-preparation`}>Prepare data</a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              <a
                href={DOCS_URL}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Documentation
              </a>
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              <a
                href={doiUrl(PUBLICATION_WEB.doi)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Preprint on bioRxiv
              </a>
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              Open source, MIT license
            </p>
          </div>

          {/* The map: in the flow on small screens, bleeding to the viewport edge on large ones. */}
          <figure
            className="relative -mx-4 aspect-[4/3] sm:mx-0 lg:absolute lg:bottom-6 lg:left-[52%] lg:right-0 lg:top-16 lg:mx-0 lg:aspect-auto"
            aria-busy={demo === undefined}
          >
            {demo && annotation ? (
              <ScatterCanvas
                x={demo.x}
                y={demo.y}
                categories={annotation.index}
                palette={palette}
                baseCategories={baseCategories}
                pointRadius={3}
                neutral={!lit}
                transitionMs={REVEAL_MS}
                interactive
                onHover={onHover}
                renderTooltip={(index) => (
                  <ProteinTooltip
                    index={index}
                    labels={labels}
                    category={annotation.categories[annotation.index[index]]}
                  />
                )}
                aria-label={`${demo.projection.name} of ${demo.count.toLocaleString()} venom proteins, colored by ${annotation.label.toLowerCase()}`}
              />
            ) : null}

            {mapLabels.map((item) => (
              <span
                key={item.label}
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-border/60 bg-white/85 px-2 py-0.5 text-[11px] font-medium text-foreground/80 shadow-sm backdrop-blur-[2px] sm:flex',
                  item.nx < 0.25
                    ? '-translate-y-[calc(100%+9px)]'
                    : item.nx > 0.75
                      ? '-translate-x-full -translate-y-[calc(100%+9px)]'
                      : '-translate-x-1/2 -translate-y-[calc(100%+9px)]',
                )}
                style={{
                  ...toPercent(item.nx, item.ny),
                  opacity: lit ? 1 : 0,
                  transition: `opacity 500ms ease ${REVEAL_MS * 0.6}ms`,
                }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: item.color }}
                />
                {item.label}
              </span>
            ))}

            <figcaption className="pointer-events-none flex flex-wrap gap-1.5 px-4 pt-3 text-[11px] sm:px-0 lg:absolute lg:bottom-4 lg:left-3 lg:p-0">
              {[
                demo?.projection.name ?? 'ProtT5 · UMAP 2',
                `${(demo?.count ?? 7831).toLocaleString()} venom proteins`,
                'Swiss-Prot demo bundle',
              ].map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-border/70 bg-white/90 px-2 py-0.5 font-medium tracking-wide text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

export default Hero;
