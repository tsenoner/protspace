import { useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';
import { Section, SectionHeading } from './Section';
import { loadVenomData, useLandingData, type VenomData } from './landing-data';

/**
 * Embedding annotation transfer (EAT) as a simplified scientific diagram of one real transfer from
 * the venom example bundle: a protein with no curated EC number takes the value of its nearest
 * annotated reference, with a reliability index and the source protein recorded alongside it.
 *
 * Proteins, colors, EC labels and the reliability index all come from venom.json. The drawn
 * positions do not: they are illustrative slots for an abstract embedding-space neighborhood.
 */

/** The transfer we illustrate; falls back to the highest-confidence transfer in the bundle. */
const QUERY_ID = 'P0DQE3';
const SOURCE_ID = 'P20005';

/** Illustrative slots for the curated references, nearest first, in the 360 x 216 viewBox. */
const SLOTS = [
  { x: 160, y: 102, dy: -24 },
  { x: 48, y: 56, dy: -13 },
  { x: 150, y: 26, dy: -13 },
  { x: 238, y: 46, dy: -13 },
  { x: 296, y: 102, dy: 22 },
];
const QUERY = { x: 100, y: 140 };
/** Sweeps left to right over the connector to reveal it. */
const CLIP = { x: 92, y: 94, width: 76, height: 54 };

interface Example {
  queryId: string;
  queryName: string;
  sourceId: string;
  sourceName: string;
  categoryLabel: string;
  categoryColor: string;
  confidence: number;
  /** Curated reference proteins, the transfer source first. */
  refs: { id: string; color: string }[];
}

function buildExample(venom: VenomData | null): Example | null {
  if (!venom || venom.eat.transferred.length === 0) return null;
  const { eat, ids, names } = venom;
  const query = ids.indexOf(QUERY_ID);
  const source = ids.indexOf(SOURCE_ID);
  const transfer =
    eat.transferred.find((entry) => entry.point === query && entry.source === source) ??
    eat.transferred.reduce((best, entry) => (entry.confidence > best.confidence ? entry : best));
  // Other curated reference proteins, one per EC class first, so the schematic names real
  // proteins without ranking them by 2D distance (which is not how EAT finds a reference).
  const candidates = eat.curated
    .map((curated, index) => ({ index, curated }))
    .filter((entry) => entry.curated >= 0 && entry.index !== transfer.source);
  const seen = new Set<number>([eat.curated[transfer.source]]);
  const distinct = candidates.filter(
    (entry) => !seen.has(entry.curated) && seen.add(entry.curated),
  );
  const neighbors = [...distinct, ...candidates.filter((entry) => !distinct.includes(entry))].slice(
    0,
    SLOTS.length - 1,
  );

  return {
    queryId: ids[transfer.point],
    queryName: names[transfer.point],
    sourceId: ids[transfer.source],
    sourceName: names[transfer.source],
    categoryLabel: eat.categories[transfer.category].label,
    categoryColor: eat.categories[transfer.category].color,
    confidence: transfer.confidence,
    refs: [transfer.source, ...neighbors.map((entry) => entry.index)].map((index) => ({
      id: ids[index],
      color: eat.categories[eat.curated[index]]?.color ?? '#94a3b8',
    })),
  };
}

export function EatPreview() {
  const venom = useLandingData(loadVenomData);
  const example = useMemo(() => buildExample(venom), [venom]);
  const [shown, setShown] = useState(prefersReducedMotion);
  const figureRef = useRef<HTMLDivElement>(null);

  // One pass on first entry into view; reduced motion starts in the final state instead.
  useEffect(() => {
    const element = figureRef.current;
    if (shown || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShown(true);
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);

  const column = venom?.eat.column ?? 'ec';
  const fade = (delay: number) => ({
    opacity: shown ? 1 : 0,
    transition: `opacity 320ms ease ${delay}ms`,
  });
  const code = 'font-mono text-[12px] text-foreground';

  return (
    <Section id="eat">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
          <SectionHeading
            eyebrow="Annotation transfer"
            title="Borrow a label from the nearest neighbor, in embedding space"
            lede={
              <>
                A protein without a curated value inherits the label of its nearest annotated
                neighbor by cosine distance in the embedding itself (k&nbsp;=&nbsp;1), not by
                position on the 2D map.
              </>
            }
          />

          <dl className="mt-8 space-y-3 text-base leading-relaxed text-muted-foreground">
            <div>
              <dt className="inline font-medium text-foreground">Reliability index:</dt>{' '}
              <dd className="inline">a rank in [0,&nbsp;1], not a probability.</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Kept apart:</dt>{' '}
              <dd className="inline">
                <code className={code}>{column}__pred_value</code>,{' '}
                <code className={code}>{column}__pred_confidence</code>,{' '}
                <code className={code}>{column}__pred_source</code>; curated values are never
                overwritten.
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">In the explorer:</dt>{' '}
              <dd className="inline">
                a hollow ring, with a dashed connector to its source on click.
              </dd>
            </div>
          </dl>

          <p className="mt-6 font-mono text-sm text-muted-foreground">
            <span aria-hidden="true">$ </span>
            <span className="text-foreground">protspace transfer</span>
          </p>

          <p className="mt-6 text-xs text-muted-foreground">
            A transferred value is an inference from embedding geometry, not evidence: read a hollow
            ring as a hypothesis.
          </p>
        </div>

        <figure className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
          <div
            ref={figureRef}
            className="rounded-2xl border border-border/70 bg-white p-6 sm:p-8"
            aria-busy={venom === undefined}
          >
            <div className="relative mx-auto w-full max-w-[560px]">
              {example ? (
                <svg
                  viewBox="0 0 360 216"
                  className="block w-full"
                  role="img"
                  aria-label={`Schematic of an embedding-space neighborhood. The query protein ${example.queryId} (${example.queryName}) has no curated ${venom?.eat.label ?? 'EC number'} and is drawn as a hollow ring. Its nearest annotated reference is ${example.sourceId} (${example.sourceName}), a filled disc joined to the query by a dashed connector. The transferred value is ${example.categoryLabel} with reliability index ${example.confidence.toFixed(2)}. The other filled discs are curated reference proteins, colored by EC class.`}
                >
                  <defs>
                    <clipPath id="eat-connector-clip">
                      <rect
                        x={CLIP.x}
                        y={CLIP.y}
                        height={CLIP.height}
                        style={{
                          width: shown ? CLIP.width : 0,
                          transition: 'width 380ms ease-out 300ms',
                        }}
                      />
                    </clipPath>
                  </defs>

                  {/* Provenance connector: query to the reference its value came from. */}
                  <g clipPath="url(#eat-connector-clip)">
                    <line
                      x1={QUERY.x}
                      y1={QUERY.y}
                      x2={SLOTS[0].x}
                      y2={SLOTS[0].y}
                      stroke="#475569"
                      strokeWidth="1.5"
                      strokeDasharray="5 4"
                    />
                  </g>
                  <circle
                    cx={SLOTS[0].x}
                    cy={SLOTS[0].y}
                    r="13"
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="1.5"
                    style={fade(620)}
                  />

                  {/* Curated references: filled discs in their EC category color. */}
                  {example.refs.map((ref, i) => (
                    <g key={ref.id}>
                      <circle
                        cx={SLOTS[i].x}
                        cy={SLOTS[i].y}
                        r="6.4"
                        fill={ref.color}
                        stroke="rgb(15 23 42 / 0.35)"
                        strokeWidth="1"
                      />
                      <text
                        x={SLOTS[i].x}
                        y={SLOTS[i].y + SLOTS[i].dy}
                        textAnchor="middle"
                        fontSize="12"
                        fill="#64748b"
                      >
                        {ref.id}
                      </text>
                    </g>
                  ))}
                  <text
                    x={SLOTS[0].x}
                    y={SLOTS[0].y + SLOTS[0].dy - 14}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill="#64748b"
                  >
                    nearest reference
                  </text>

                  {/* The query: hollow ring, the explorer's convention for a transferred value. */}
                  <g style={fade(0)}>
                    <circle
                      cx={QUERY.x}
                      cy={QUERY.y}
                      r="5.7"
                      fill="none"
                      stroke={example.categoryColor}
                      strokeWidth="2.8"
                    />
                    <text
                      x={QUERY.x}
                      y={QUERY.y + 24}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="600"
                      fill="#0f172a"
                    >
                      {example.queryId}
                    </text>
                    <text
                      x={QUERY.x}
                      y={QUERY.y + 38}
                      textAnchor="middle"
                      fontSize="10.5"
                      fill="#64748b"
                    >
                      no curated {venom?.eat.label ?? 'EC number'}
                    </text>
                  </g>
                </svg>
              ) : (
                <div className="aspect-[360/216] w-full" />
              )}

              {example ? (
                <div
                  className="mt-3 rounded-md border border-border bg-white px-3 py-2 text-xs shadow-card sm:absolute sm:bottom-[2%] sm:right-0 sm:mt-0 sm:w-[54%]"
                  style={{
                    ...fade(700),
                    transform: shown ? 'none' : 'translateY(4px)',
                    transition: 'opacity 300ms ease 700ms, transform 300ms ease 700ms',
                  }}
                >
                  <p className="font-semibold tracking-tight text-foreground">
                    Predicted (transferred)
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-foreground/90">
                    <span
                      aria-hidden="true"
                      className="mt-[5px] inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: example.categoryColor }}
                    />
                    <span>{example.categoryLabel}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Reliability index{' '}
                    <span className="tabular-nums text-foreground" style={fade(1000)}>
                      {example.confidence.toFixed(2)}
                    </span>{' '}
                    · source {example.sourceId}
                  </p>
                </div>
              ) : null}
            </div>

            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.5" fill="#94a3b8" />
                </svg>
                Filled disc = curated annotation
              </li>
              <li className="flex items-center gap-2">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="3.6" fill="none" stroke="#94a3b8" strokeWidth="2.4" />
                </svg>
                Hollow ring = transferred by EAT
              </li>
            </ul>
          </div>
          <figcaption className="mt-3 text-xs text-muted-foreground">
            Schematic of the embedding-space neighborhood; distances not to scale.
            {venom
              ? ` Proteins, colors and values are real, from the ${venom.count.toLocaleString()}-protein venom example bundle.`
              : ''}
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}
