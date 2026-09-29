import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DOCS_URL } from '@/config';
import { cn } from '@/lib/utils';
import { ExplorerFrame } from './ExplorerFrame';
import { ProteinTooltip, useHoverLabels } from './ProteinTooltip';
import { ScatterCanvas } from './ScatterCanvas';
import { Section, SectionHeading } from './Section';
import { loadDemoData, loadVenomData, useLandingData, type VenomData } from './landing-data';
import { prefersReducedMotion } from './motion';

const DEFAULT_ANNOTATION = 'protein_families';
/** Auto-cycle cadence until the visitor picks a projection or an annotation themselves. */
const CYCLE_MS = 2600;
const LEGEND_ROWS = 7;

/** The transfer the EAT tile draws; falls back to the highest-confidence transfer in the bundle. */
const QUERY_ID = 'P0DQE3';
const SOURCE_ID = 'P20005';

/**
 * The AlphaFold2 model of A4FS04 (acidic phospholipase A2 natratoxin, a demo-bundle protein) as
 * the explorer's structure viewer renders it, colored by pLDDT. A still image: the viewer itself
 * would pull the explorer bundle onto the landing page.
 */
const STRUCTURE = { id: 'A4FS04', src: 'structure-A4FS04.webp' };

const linkClass =
  'text-sm font-medium text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:decoration-primary';

/**
 * What the explorer does, on one map: a live explorer frame where the projection and the
 * annotation can be switched (points move or recolor, never swap), beside three tiles for
 * annotation transfer, cluster statistics and 3D structures, each with one real visual.
 */
export function FeatureShowcase() {
  const demo = useLandingData(loadDemoData);
  const venom = useLandingData(loadVenomData);
  const [projection, setProjection] = useState(0);
  const [column, setColumn] = useState(DEFAULT_ANNOTATION);
  const [inView, setInView] = useState(false);
  /** A click on any chip stops the auto-cycle; a reload starts it again. */
  const [pinned, setPinned] = useState(false);
  const { labels, onHover } = useHoverLabels();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = frameRef.current;
    if (!element || inView) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  // Alternate a new projection and a new annotation so visitors see both controls at work.
  useEffect(() => {
    if (!demo || !inView || pinned || prefersReducedMotion()) return;
    const columns = demo.annotations.map((entry) => entry.column);
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (step % 2) setProjection((current) => (current + 1) % demo.projections.length);
      else setColumn((current) => columns[(columns.indexOf(current) + 1) % columns.length]);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [demo, inView, pinned]);

  const shown = demo?.projections[projection];
  const annotation =
    demo?.annotations.find((entry) => entry.column === column) ?? demo?.annotations[0];
  const palette = annotation?.categories.map((category) => category.color) ?? [];
  const baseCategories =
    annotation?.categories.flatMap((category, i) => (category.kind ? [i] : [])) ?? [];

  return (
    <Section id="features">
      <div className="grid gap-5 lg:grid-cols-2 lg:items-end lg:gap-12">
        <SectionHeading eyebrow="In the explorer" title="One map, many questions" />
        <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
          Recolor, re-project, transfer labels, score clusters and open structures, all on the same{' '}
          {(demo?.count ?? 7831).toLocaleString()} venom proteins.
        </p>
      </div>

      <div className="mt-10 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div ref={frameRef} className="min-w-0">
          <ExplorerFrame
            toolbar={
              <>
                <ChipGroup
                  label="Projection"
                  items={demo?.projections.map((entry) => entry.name) ?? []}
                  active={projection}
                  onSelect={(i) => {
                    setPinned(true);
                    setProjection(i);
                  }}
                />
                <ChipGroup
                  label="Annotation"
                  items={demo?.annotations.map((entry) => entry.label) ?? []}
                  active={demo?.annotations.findIndex((entry) => entry.column === column) ?? 0}
                  onSelect={(i) => {
                    setPinned(true);
                    if (demo) setColumn(demo.annotations[i].column);
                  }}
                />
              </>
            }
            legendTitle={annotation?.label ?? 'Annotation'}
            categories={annotation?.categories ?? []}
            legendRows={LEGEND_ROWS}
            colored={inView}
            count={demo?.count}
            busy={demo === undefined}
            plotClassName="aspect-[4/3] sm:aspect-auto sm:h-[400px] xl:h-[452px]"
          >
            {demo && shown && annotation ? (
              <ScatterCanvas
                x={shown.x}
                y={shown.y}
                categories={annotation.index}
                palette={palette}
                baseCategories={baseCategories}
                pointRadius={2.4}
                neutral={!inView}
                interactive
                onHover={onHover}
                renderTooltip={(index) => (
                  <ProteinTooltip
                    index={index}
                    labels={labels}
                    category={annotation.categories[annotation.index[index]]}
                  />
                )}
                aria-label={`${shown.name} of ${demo.count.toLocaleString()} venom proteins colored by ${annotation.label.toLowerCase()}`}
              />
            ) : null}
          </ExplorerFrame>
          <p className="mt-3 text-sm text-muted-foreground">
            Switch the projection or the annotation. Every point keeps its identity, so a cluster
            can be followed between views.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1 xl:grid-rows-3">
          <Tile
            title="Annotation transfer"
            href={`${DOCS_URL}explore/eat`}
            link="How EAT works"
            visual={venom ? <TransferSketch venom={venom} /> : null}
          >
            Missing labels come from the nearest annotated neighbor in the embedding, with a
            reliability index.
          </Tile>
          <Tile
            title="Projection statistics"
            href={`${DOCS_URL}explore/separation-scores`}
            link="How the scores work"
            visual={venom ? <SeparationSketch venom={venom} /> : null}
          >
            Score every category in the 2D map and in the embedding, and check how faithful the map
            is, so projection artifacts stand out.
          </Tile>
          <Tile
            title="3D structure"
            href={`${DOCS_URL}explore/structures`}
            link="Viewing structures"
            visual={
              <figure className="relative h-full w-full">
                <img
                  src={`${import.meta.env.BASE_URL}landing/${STRUCTURE.src}`}
                  alt={`AlphaFold2 model of ${STRUCTURE.id}, a phospholipase A2 from the demo bundle, colored by pLDDT confidence`}
                  width={459}
                  height={357}
                  loading="lazy"
                  className="absolute inset-x-2 bottom-5 top-2 h-[calc(100%-1.75rem)] w-[calc(100%-1rem)] object-contain"
                />
                <figcaption className="absolute bottom-1 left-2 text-[10.5px] text-[#5b6b7a]">
                  {STRUCTURE.id} · AlphaFold2 · pLDDT
                </figcaption>
              </figure>
            }
          >
            Click any protein to open its AlphaFold model, colored by pLDDT confidence.
          </Tile>
        </div>
      </div>
    </Section>
  );
}

function ChipGroup({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: string[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${label} shown on the map`}
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      <span className="mr-0.5 text-[#5b6b7a]">{label}</span>
      {items.map((item, i) => (
        <button
          key={item}
          type="button"
          aria-pressed={i === active}
          onClick={() => onSelect(i)}
          className={cn(
            'rounded-[4px] border px-2 py-0.5 font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            i === active
              ? 'border-[#334155] bg-[#334155] text-white'
              : 'border-[#d9e2ec] bg-white text-[#334155] hover:border-[#5b6b7a]',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

/** One supporting feature: a small real visual above its text, or beside it on wide screens. */
function Tile({
  title,
  href,
  link,
  visual,
  children,
}: {
  title: string;
  href: string;
  link: string;
  visual: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="grid min-w-0 gap-4 rounded-2xl border border-border/70 bg-white p-3 xl:grid-cols-[12rem_minmax(0,1fr)] xl:items-center xl:pr-4">
      <div
        className="h-32 overflow-hidden rounded-[10px] border border-[#d9e2ec] bg-white"
        aria-busy={visual === null}
      >
        {visual}
      </div>
      <div className="min-w-0 space-y-1 px-1 pb-1 xl:p-0">
        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
        <a href={href} className={linkClass}>
          {link}
        </a>
      </div>
    </article>
  );
}

/** A query protein with no curated EC number taking the value of its nearest annotated reference. */
function TransferSketch({ venom }: { venom: VenomData }) {
  const example = useMemo(() => {
    const { eat, ids } = venom;
    if (eat.transferred.length === 0) return null;
    const transfer =
      eat.transferred.find(
        (entry) => ids[entry.point] === QUERY_ID && ids[entry.source] === SOURCE_ID,
      ) ??
      eat.transferred.reduce((best, entry) => (entry.confidence > best.confidence ? entry : best));
    const sourceClass = eat.curated[transfer.source];
    // Two references of other EC classes, so the sketch shows a choice between neighbors.
    const others = [...new Set(eat.curated)].filter((c) => c >= 0 && c !== sourceClass);
    return {
      query: ids[transfer.point],
      source: ids[transfer.source],
      color: eat.categories[transfer.category].color,
      sourceColor: eat.categories[sourceClass]?.color ?? '#94a3b8',
      others: others.slice(0, 2).map((c) => eat.categories[c].color),
      label: eat.categories[transfer.category].label,
      confidence: transfer.confidence,
    };
  }, [venom]);
  if (!example) return null;
  const rim = 'rgb(15 23 42 / 0.35)';

  return (
    <svg
      viewBox="0 0 170 116"
      className="h-full w-full"
      role="img"
      aria-label={`${example.query} has no curated EC number and takes ${example.label} from its nearest annotated reference ${example.source}, reliability index ${example.confidence.toFixed(2)}.`}
    >
      {example.others.map((color, i) => (
        <circle key={i} cx={i ? 142 : 30} cy={i ? 26 : 30} r="5" fill={color} stroke={rim} />
      ))}
      <line
        x1="52"
        y1="84"
        x2="104"
        y2="52"
        stroke="#475569"
        strokeWidth="1.4"
        strokeDasharray="4 3.5"
      />
      <circle cx="104" cy="52" r="11" fill="none" stroke="#0f766e" strokeWidth="1.4" />
      <circle cx="104" cy="52" r="5.5" fill={example.sourceColor} stroke={rim} />
      <circle cx="52" cy="84" r="5" fill="none" stroke={example.color} strokeWidth="2.6" />
      <text x="52" y="104" textAnchor="middle" fontSize="10" fontWeight="600" fill="#0f172a">
        {example.query}
      </text>
      <text x="124" y="76" textAnchor="middle" fontSize="9.5" fill="#64748b">
        {example.source}
      </text>
      <text x="124" y="88" textAnchor="middle" fontSize="9.5" fill="#0f172a">
        RI {example.confidence.toFixed(2)}
      </text>
    </svg>
  );
}

/** Mirrors `OTHER_COLOR` in the landing data script: the collapsed Other bucket. */
const OTHER_GREY = '#888888';
const signed = (value: number) => (value < 0 ? '−' : '') + Math.abs(value).toFixed(2);

/** Where a silhouette value sits on the strip, in percent of its width; [-1, 1] with a margin. */
const stripX = (value: number) => `${5 + ((value + 1) / 2) * 90}%`;

/**
 * The explorer's legend score strips: one dot per category on a shared [-1, 1] axis, in the 2D
 * map and in the embedding, colored as its legend row (collapsed categories grey, drawn first).
 */
function SeparationSketch({ venom }: { venom: VenomData }) {
  const { label, projection, overall, categories } = venom.separation;
  const ordered = [...categories].sort(
    (a, b) => Number(b.color === OTHER_GREY) - Number(a.color === OTHER_GREY),
  );
  const rows = [
    { name: '2D map', value: overall.map, key: 'map' as const },
    { name: 'Embedding', value: overall.embedding, key: 'embedding' as const },
  ];

  return (
    <div
      role="img"
      aria-label={`Silhouette per ${label.toLowerCase()}: ${signed(overall.map)} in ${projection}, ${signed(overall.embedding)} in the embedding, one dot per category.`}
      className="grid h-full content-center gap-1.5 px-3 py-2 text-xs text-[#5b6b7a]"
    >
      <p className="font-semibold text-[#334155]">Silhouette per {label.toLowerCase()}</p>
      {rows.map((row) => (
        <div key={row.key}>
          <p className="flex justify-between gap-2 tabular-nums">
            <span>{row.name}</span>
            <span>{signed(row.value)}</span>
          </p>
          <svg width="100%" height="18" aria-hidden="true" className="block overflow-visible">
            <line x1="5%" x2="95%" y1="9" y2="9" stroke="#cbd5e1" />
            {ordered.map((category) => (
              <circle
                key={category.label}
                cx={stripX(category[row.key])}
                cy="9"
                r="4.6"
                fill={category.color}
                stroke="#fff"
              />
            ))}
          </svg>
        </div>
      ))}
    </div>
  );
}
