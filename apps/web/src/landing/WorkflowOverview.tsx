import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { ExplorerFrame, ToolbarChip } from './ExplorerFrame';
import { ScatterCanvas } from './ScatterCanvas';
import { Eyebrow, Section, SectionHeading } from './Section';
import { loadDemoData, useLandingData } from './landing-data';

const MINI_ANNOTATION = 'protein_families';
const LEGEND_ROWS = 6;

/** The real minimal preparation session (docs: `protspace prepare`), wrapped to fit the column. */
const TERMINAL: { text: string; prompt?: boolean; muted?: boolean }[] = [
  { prompt: true, text: 'pip install protspace' },
  { text: '' },
  { prompt: true, text: 'protspace prepare -i sequences.fasta \\' },
  { text: '    -e prot_t5 -m pca2,umap2 -o out' },
  { muted: true, text: '  → out/data.parquetbundle' },
];

const BUNDLE_PARTS = [
  'annotations',
  'projection metadata',
  'projections',
  'settings (optional)',
  'statistics (optional)',
];

/** One workflow step: a hairline with its number on it, then the step's single panel. */
function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border/70 pt-5">
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  );
}

/**
 * The three stages of using ProtSpace: the Python CLI prepares a dataset, the result is a single
 * portable `.parquetbundle`, and the browser explorer opens that bundle locally.
 */
export function WorkflowOverview() {
  const demo = useLandingData(loadDemoData);
  const annotation = demo?.annotations.find((entry) => entry.column === MINI_ANNOTATION);
  const palette = annotation?.categories.map((category) => category.color) ?? [];
  const baseCategories =
    annotation?.categories.flatMap((category, i) => (category.kind ? [i] : [])) ?? [];

  return (
    <Section id="workflow" tone="muted">
      <SectionHeading
        eyebrow="Workflow"
        title="From sequences to an interactive map"
        lede="One command in Python turns sequences into a portable bundle. The browser explorer opens that bundle locally."
      />

      <div className="mt-12 grid gap-10 lg:mt-16 lg:grid-cols-[1fr_minmax(12rem,0.6fr)_1.3fr] lg:gap-8">
        <Step label="01 Prepare">
          <div
            role="group"
            aria-label="Shell session installing ProtSpace and preparing a bundle"
            className="rounded-2xl border border-border/70 bg-white"
          >
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-foreground">
              <code>
                {TERMINAL.map((line, i) => (
                  <span key={i} className={cn('block', line.muted && 'text-muted-foreground')}>
                    {line.prompt ? (
                      <span className="select-none text-muted-foreground">$ </span>
                    ) : null}
                    {line.text || ' '}
                  </span>
                ))}
              </code>
            </pre>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            12 pLM checkpoints or your own embeddings; PCA, UMAP, t-SNE, PaCMAP, MDS, LocalMAP;
            annotations from UniProt, InterPro, NCBI taxonomy and TED.
          </p>
        </Step>

        <Step label="02 Bundle">
          <div className="rounded-2xl border border-border/70 bg-white p-4">
            <p className="font-mono text-xs text-foreground">data.parquetbundle</p>
            <ul className="mt-3 space-y-1.5 border-t border-border/70 pt-3 text-xs leading-snug text-muted-foreground">
              {BUNDLE_PARTS.map((part) => (
                <li key={part}>{part}</li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            One file, explored locally in the browser.
          </p>
        </Step>

        <Step label="03 Explore">
          <ExplorerFrame
            compact
            toolbar={
              <>
                <ToolbarChip label="Projection">
                  {demo?.projection.name ?? 'ProtT5 · UMAP 2'}
                </ToolbarChip>
                <ToolbarChip label="Annotation">
                  {annotation?.label ?? 'Protein family'}
                </ToolbarChip>
              </>
            }
            legendTitle={annotation?.label ?? 'Protein family'}
            categories={annotation?.categories ?? []}
            legendRows={LEGEND_ROWS}
            count={demo?.count}
            busy={demo === undefined}
            plotClassName="aspect-[4/3] sm:aspect-auto sm:min-h-[240px]"
          >
            {demo && annotation ? (
              <ScatterCanvas
                x={demo.x}
                y={demo.y}
                categories={annotation.index}
                palette={palette}
                baseCategories={baseCategories}
                pointRadius={1.6}
                aria-label={`${demo.projection.name} of ${demo.count.toLocaleString()} venom proteins colored by ${annotation.label.toLowerCase()}, as shown in the explorer`}
              />
            ) : null}
          </ExplorerFrame>
          <Link
            to="/explore"
            className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline focus-visible:underline"
          >
            Open the explorer
          </Link>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Opens bundles up to Swiss-Prot scale: 573,649 proteins in the shipped Swiss-Prot bundle.
          </p>
        </Step>
      </div>

      <p className="mt-12 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        A bundle is read locally in the browser and never leaves the machine. Sequences do leave it
        in two cases: dropping a FASTA file into the explorer sends them to the ProtSpace
        preparation service, and <code className="font-mono text-[13px]">protspace prepare</code>{' '}
        embeds through the Biocentral API by default unless you pass{' '}
        <code className="whitespace-nowrap font-mono text-[13px]">--backend local</code>.
      </p>
    </Section>
  );
}
