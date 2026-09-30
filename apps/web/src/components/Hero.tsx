import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DOCS_URL } from '@/config';
import { DemoScatter } from '@/landing/DemoScatter';
import { PreviewUnavailable } from '@/landing/PreviewUnavailable';
import { toPercent } from '@/landing/ScatterCanvas';
import { loadDemoData, useLandingData } from '@/landing/landing-data';
import { prefersReducedMotion } from '@/landing/motion';
import { cn } from '@/lib/utils';
import { PUBLICATION_WEB, doiUrl } from '../../../../config/citations';

const HERO_ANNOTATION = 'protein_families';
/** Families named on the map: the three largest plus three the PR review asked for. */
const LABELED_FAMILIES: Record<string, LabelSide> = {
  'phospholipase A2 family': 'above',
  'three-finger toxin family': 'above',
  'long (4 C-C) scorpion toxin superfamily': 'right',
  'arthropod phospholipase D family': 'above',
  'venom Kunitz-type family': 'above',
  'snaclec family': 'below',
};
const REVEAL_MS = 1200;

type LabelSide = 'above' | 'below' | 'right';

interface MapLabel {
  label: string;
  side: LabelSide;
  color: string;
  nx: number;
  ny: number;
}

/** Rough label footprint in normalized plot units: 11px text above its anchor point. */
const labelWidth = (label: string) => 0.009 * label.length + 0.035;
const LABEL_HEIGHT = 0.07;

/**
 * Place-names for the map. Each label anchors on its family's densest member (the most
 * same-family neighbors nearby), so it sits on the cluster's core even when the family is
 * split. When that spot would overlap an earlier label, the next-densest member is tried.
 * A `below` or `right` label then moves to that edge of the cluster core so it clears the points.
 */
function familyLabels(
  x: Float32Array,
  y: Float32Array,
  index: Uint8Array,
  categories: { label: string; color: string }[],
): MapLabel[] {
  const out: (MapLabel & { width: number })[] = [];
  for (const [name, side] of Object.entries(LABELED_FAMILIES)) {
    const c = categories.findIndex((category) => category.label === name);
    const members: number[] = [];
    for (let i = 0; i < index.length; i++) if (index[i] === c) members.push(i);
    if (members.length < 5) continue;
    // ponytail: O(members²) neighbor count, fine for a few hundred points per family.
    const density = members.map((i) =>
      members.reduce(
        (n, j) => n + ((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2 < 0.06 ** 2 ? 1 : 0),
        0,
      ),
    );
    const width = labelWidth(name);
    const spot = members
      .map((i, k) => ({ i, d: density[k] }))
      .sort((p, q) => q.d - p.d)
      .find(({ i }) =>
        out.every(
          (placed) =>
            Math.abs(placed.nx - x[i]) > (placed.width + width) / 2 ||
            Math.abs(placed.ny - y[i]) > LABEL_HEIGHT,
        ),
      );
    if (!spot) continue;
    let nx = x[spot.i];
    let ny = y[spot.i];
    for (const j of members) {
      if ((x[j] - x[spot.i]) ** 2 + (y[j] - y[spot.i]) ** 2 > 0.1 ** 2) continue;
      if (side === 'below') ny = Math.min(ny, y[j]);
      if (side === 'right') nx = Math.max(nx, x[j]);
    }
    out.push({ label: name, side, color: categories[c].color, nx, ny, width });
  }
  return out;
}

const Hero = () => {
  const demo = useLandingData(loadDemoData);
  const [lit, setLit] = useState(prefersReducedMotion);

  /** The projection /explore opens by default. */
  const shown = demo?.projections[0];
  const annotation = demo?.annotations.find((entry) => entry.column === HERO_ANNOTATION);
  const mapLabels = useMemo(
    () =>
      shown && annotation
        ? familyLabels(shown.x, shown.y, annotation.index, annotation.categories)
        : [],
    [shown, annotation],
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
              Explore protein language model embeddings overlaid with biology, and see what sequence
              similarity can't. Prepare a dataset in Python, then explore it interactively in the
              browser.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" className="px-6" asChild>
                <Link to="/explore">Start exploring</Link>
              </Button>
              <Button size="lg" variant="outline" className="px-6" asChild>
                <a href={`${DOCS_URL}guide/data-preparation`}>Prepare data</a>
              </Button>
              <Button size="lg" variant="outline" className="px-6" asChild>
                <a href={DOCS_URL}>Documentation</a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              <a
                href={doiUrl(PUBLICATION_WEB.doi)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary hover:decoration-primary"
              >
                Preprint on bioRxiv
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              Open source, MIT license
            </p>
          </div>

          <figure
            className="relative -mx-4 aspect-[4/3] sm:mx-0 lg:col-span-6 lg:mx-0 lg:aspect-auto lg:h-[min(72vh,640px)] xl:col-span-7"
            aria-busy={demo === undefined}
          >
            {demo && shown && annotation ? (
              <DemoScatter
                x={shown.x}
                y={shown.y}
                annotation={annotation}
                pointRadius={3}
                neutral={!lit}
                transitionMs={REVEAL_MS}
                aria-label={`${shown.name} of ${demo.count.toLocaleString()} venom proteins, colored by ${annotation.label.toLowerCase()}`}
              />
            ) : demo === null ? (
              <PreviewUnavailable message="The preview map couldn't load." exploreLink />
            ) : null}

            {mapLabels.map((item) => (
              <span
                key={item.label}
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-border/60 bg-white/85 px-2 py-0.5 text-[11px] font-medium text-foreground/80 shadow-sm backdrop-blur-[2px] sm:flex',
                  item.side === 'below'
                    ? '-translate-x-1/2 translate-y-[9px]'
                    : item.side === 'right'
                      ? 'translate-x-[9px] -translate-y-1/2 whitespace-normal leading-tight'
                      : item.nx < 0.25
                        ? '-translate-y-[calc(100%+9px)]'
                        : item.nx > 0.75
                          ? '-translate-x-full -translate-y-[calc(100%+9px)]'
                          : '-translate-x-1/2 -translate-y-[calc(100%+9px)]',
                )}
                style={{
                  ...toPercent(item.nx, item.ny),
                  // A right-side label wraps rather than running past the plot's edge.
                  maxWidth:
                    item.side === 'right'
                      ? `min(10rem, calc(100% - ${toPercent(item.nx, item.ny).left} - 13px))`
                      : undefined,
                  opacity: lit ? 1 : 0,
                  transition: `opacity 500ms ease ${REVEAL_MS * 0.6}ms`,
                }}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: item.color }}
                />
                {item.label}
              </span>
            ))}
          </figure>
        </div>
      </div>
    </section>
  );
};

export default Hero;
