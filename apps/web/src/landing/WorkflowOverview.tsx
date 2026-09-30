import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { DOCS_URL } from '@/config';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from './motion';
import { Section, SectionHeading, linkClass } from './Section';

const INSTALL = 'pip install protspace';
const PREPARE = 'protspace prepare -i sequences.fasta -e prot_t5 -m pca2,umap2 -o out';
/** The same command wrapped the way the docs show it, so it never breaks mid-flag. */
const PREPARE_WRAPPED =
  'protspace prepare -i sequences.fasta \\\n    -e prot_t5 -m pca2,umap2 -o out';
const OUTPUT = 'out/data.parquetbundle';
const CLI_DOCS = `${DOCS_URL}guide/python-cli`;
/** The FAQ answer on what is uploaded (bundle stays local, FASTA upload does not). */
const PRIVACY_DOCS = `${DOCS_URL}guide/faq#is-my-data-uploaded-to-a-server`;

const focusRing =
  'rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

type StoryLine = { kind: 'comment' | 'command' | 'output'; text: string };

const STORY: StoryLine[] = [
  { kind: 'comment', text: '# install once' },
  { kind: 'command', text: INSTALL },
  { kind: 'comment', text: '# embed, project, annotate and bundle' },
  { kind: 'command', text: PREPARE_WRAPPED },
  { kind: 'output', text: `→ ${OUTPUT}` },
];
/** Commands are typed character by character; comments and output appear as whole lines. */
const STORY_STEPS = STORY.map((line) => (line.kind === 'command' ? line.text.length : 1));
const STORY_TOTAL = STORY_STEPS.reduce((sum, n) => sum + n, 0);
const STORY_STARTS = STORY_STEPS.map((_, i) => STORY_STEPS.slice(0, i).reduce((s, n) => s + n, 0));
const TYPE_MS = 16;
const LINE_MS = 280;

const Prompt = ({ hidden }: { hidden?: boolean }) => (
  <span className={cn('select-none text-muted-foreground', hidden && 'invisible')}>$ </span>
);

/**
 * A block cursor that takes no width: it sits on top of the next (still invisible) character, so
 * typing never reflows a line. Solid while typing, a faint slow blink once the session is idle.
 */
const Cursor = ({ idle }: { idle?: boolean }) => (
  <span aria-hidden="true" className="relative">
    <span
      className={cn(
        'absolute inset-y-0 left-0 w-[0.6em]',
        idle ? 'animate-pulse bg-muted-foreground/35 motion-reduce:animate-none' : 'bg-primary/70',
      )}
    />
  </span>
);

/** Three colored clusters: a map, not data. Deterministic so it never reshuffles. */
const MAP_DOTS = (() => {
  const clusters = [
    { cx: 30, cy: 34, color: '#2563eb' },
    { cx: 70, cy: 26, color: '#0f766e' },
    { cx: 56, cy: 66, color: '#d97706' },
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return clusters.flatMap(({ cx, cy, color }) =>
    Array.from({ length: 14 }, () => ({ x: cx + rand() * 12, y: cy + rand() * 10, color })),
  );
})();

function MapGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 90"
      className={cn('rounded-md border border-border/80 bg-white shadow-sm', className)}
      aria-hidden="true"
    >
      {MAP_DOTS.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r="2.1" fill={dot.color} fillOpacity="0.8" />
      ))}
    </svg>
  );
}

/** Starts once the terminal is on screen, types the session once, then idles. */
function useTypedStory() {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? STORY_TOTAL : 0));

  useEffect(() => {
    const element = ref.current;
    if (!element || started || shown >= STORY_TOTAL) return;
    if (typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setStarted(true);
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [started, shown]);

  useEffect(() => {
    if (!started || shown >= STORY_TOTAL) return;
    const delay = STORY_STARTS.includes(shown) ? LINE_MS : TYPE_MS;
    const timer = window.setTimeout(() => setShown((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [started, shown]);

  return { ref, shown, done: shown >= STORY_TOTAL };
}

/**
 * The home-page workflow: one terminal types the real minimal session (install, then
 * `protspace prepare`), prints the bundle, and hands off to the explorer beside it.
 */
export function WorkflowOverview() {
  const { ref, shown, done } = useTypedStory();

  return (
    <Section id="workflow" tone="muted">
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <SectionHeading
          compact
          eyebrow="Your own data"
          title="From sequences to a map in one command"
          lede="Prepare a bundle in Python, then open it in the browser."
        />

        <div className="min-w-0 xl:max-w-5xl">
          <div
            ref={ref}
            className="overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm"
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-4 py-2 sm:px-5">
              <span className="mr-auto font-mono text-xs text-muted-foreground">~/proteins</span>
              <a href={CLI_DOCS} className={cn(linkClass, focusRing, 'text-xs')}>
                All CLI options
              </a>
            </div>
            <p className="sr-only">
              Shell session: {INSTALL}, then {PREPARE}, which writes {OUTPUT}.
            </p>
            <div className="md:grid md:grid-cols-[minmax(0,1fr)_13rem] xl:grid-cols-[minmax(0,1fr)_15rem]">
              {/* Every line is laid out from the start and revealed in place, so nothing moves. */}
              <pre
                aria-hidden="true"
                className="whitespace-pre-wrap px-4 py-4 font-mono text-[12px] leading-[1.75] text-foreground [overflow-wrap:anywhere] sm:px-5 sm:py-5 sm:text-sm md:py-6 md:leading-[1.85]"
              >
                <code>
                  {STORY.map((line, i) => {
                    const start = STORY_STARTS[i];
                    const typed = Math.min(Math.max(shown - start, 0), STORY_STEPS[i]);
                    const count =
                      line.kind === 'command' ? typed : typed > 0 ? line.text.length : 0;
                    const typing = shown >= start && shown < start + STORY_STEPS[i];
                    return (
                      <span
                        key={i}
                        className={cn(
                          'block',
                          line.kind === 'comment' && 'text-muted-foreground/80',
                          line.kind === 'output' && 'select-none font-medium text-primary',
                        )}
                      >
                        {line.kind === 'command' ? <Prompt hidden={shown < start} /> : null}
                        {line.text.slice(0, count)}
                        {typing && shown > 0 ? <Cursor /> : null}
                        {count < line.text.length ? (
                          <span className="invisible">{line.text.slice(count)}</span>
                        ) : null}
                      </span>
                    );
                  })}
                  <span className="block">
                    <Prompt hidden={!done} />
                    {done ? <Cursor idle /> : null}
                  </span>
                </code>
              </pre>

              {/* The hand-off: the printed bundle becomes a map in the explorer. */}
              <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:gap-8 sm:px-5 md:flex-col md:items-stretch md:justify-center md:gap-3 md:border-l md:border-t-0 md:py-5">
                <div
                  aria-hidden="true"
                  className={cn(
                    'flex items-center gap-3 transition-[opacity,filter] duration-700 motion-reduce:transition-none md:flex-col md:items-start md:gap-2.5',
                    done ? 'opacity-100' : 'opacity-40 grayscale',
                  )}
                >
                  <span className="shrink-0 rounded-md border border-border/70 bg-white px-2 py-0.5 font-mono text-xs text-foreground">
                    data.parquetbundle
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" />
                  <ArrowDown className="ml-2 hidden h-4 w-4 text-muted-foreground md:block" />
                  <MapGlyph className="h-[4.5rem] w-20 shrink-0 md:h-[5.5rem] md:w-full md:max-w-[8.5rem] xl:h-[6.5rem] xl:max-w-[10rem]" />
                </div>
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:flex-col sm:items-start sm:gap-y-1.5">
                  <span className="text-sm text-muted-foreground">Drop it into the explorer.</span>
                  <Link to="/explore" className={cn(linkClass, focusRing)}>
                    Open the explorer
                  </Link>
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Bundles open locally and never leave your machine. Sequences leave it only for a FASTA
            upload or Biocentral embedding (skip it with{' '}
            <code className="whitespace-nowrap font-mono text-[13px]">--backend local</code>).{' '}
            <a href={PRIVACY_DOCS} className={cn(linkClass, focusRing)}>
              What gets uploaded
            </a>
          </p>
        </div>
      </div>
    </Section>
  );
}
