import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ExplorerFrame, ToolbarChip } from './ExplorerFrame';
import { ProteinTooltip, useHoverLabels } from './ProteinTooltip';
import { ScatterCanvas } from './ScatterCanvas';
import { Section, SectionHeading } from './Section';
import { loadDemoData, useLandingData } from './landing-data';
import { prefersReducedMotion } from './motion';

const DEFAULT_ANNOTATION = 'phylum';
/** Auto-cycle cadence until the visitor picks an annotation themselves. */
const CYCLE_MS = 3000;

/**
 * The centerpiece: one projection inside the explorer's own chrome. Switching the annotation
 * recolors the points in place while the coordinates stay fixed; colors fade in from neutral
 * when the section scrolls into view.
 */
export function AnnotationExplorerPreview() {
  const demo = useLandingData(loadDemoData);
  const [active, setActive] = useState<string>(DEFAULT_ANNOTATION);
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

  // Cycle through the annotations while in view so visitors notice the chips are interactive.
  useEffect(() => {
    const columns = demo?.annotations.map((entry) => entry.column) ?? [];
    if (!inView || pinned || columns.length < 2 || prefersReducedMotion()) return;
    const timer = setInterval(() => {
      setActive((current) => columns[(columns.indexOf(current) + 1) % columns.length]);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [demo, inView, pinned]);

  const annotation =
    demo?.annotations.find((entry) => entry.column === active) ?? demo?.annotations[0];
  const palette = annotation?.categories.map((category) => category.color) ?? [];
  const baseCategories =
    annotation?.categories.flatMap((category, i) => (category.kind ? [i] : [])) ?? [];

  return (
    <Section id="annotations">
      <SectionHeading
        eyebrow="Biological context"
        title="Same proteins, same coordinates, a different question"
        lede="Switch the annotation and the map recolors without moving a point. Where known biology follows the learned representation, clusters turn one color; where it does not, they do not."
      />

      <div ref={frameRef} className="mt-12">
        <ExplorerFrame
          toolbar={
            <>
              <ToolbarChip label="Projection">
                {demo?.projection.name ?? 'ProtT5 · UMAP 2'}
              </ToolbarChip>
              <div
                role="group"
                aria-label="Color the projection by annotation"
                className="flex flex-wrap items-center gap-1.5 text-xs"
              >
                <span className="mr-0.5 text-[#5b6b7a]">Annotation</span>
                {(demo?.annotations ?? []).map((entry) => {
                  const selected = entry.column === annotation?.column;
                  return (
                    <button
                      key={entry.column}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setPinned(true);
                        setActive(entry.column);
                      }}
                      className={cn(
                        'rounded-[4px] border px-2 py-0.5 font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        selected
                          ? 'border-[#334155] bg-[#334155] text-white'
                          : 'border-[#d9e2ec] bg-white text-[#334155] hover:border-[#5b6b7a]',
                      )}
                    >
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </>
          }
          legendTitle={annotation?.label ?? 'Annotation'}
          categories={annotation?.categories ?? []}
          colored={inView}
          count={demo?.count}
          busy={demo === undefined}
          plotClassName="aspect-[4/3] lg:aspect-auto lg:h-[min(70vh,680px)] lg:min-h-[420px]"
        >
          {demo && annotation ? (
            <ScatterCanvas
              x={demo.x}
              y={demo.y}
              categories={annotation.index}
              palette={palette}
              baseCategories={baseCategories}
              pointRadius={2.6}
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
              aria-label={`${demo.projection.name} of ${demo.count.toLocaleString()} venom proteins colored by ${annotation.label.toLowerCase()}`}
            />
          ) : null}
        </ExplorerFrame>
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
          Coordinates never change between annotations. Gray points have no value for the selected
          annotation or sit in the collapsed “Other” bucket, exactly as in the explorer.
        </p>
      </div>
    </Section>
  );
}
