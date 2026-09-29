import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { Eyebrow, Section, SectionHeading } from './Section';

/** The real minimal preparation session (docs: `protspace prepare`), wrapped to fit the column. */
const TERMINAL: { text: string; prompt?: boolean; muted?: boolean }[] = [
  { prompt: true, text: 'pip install protspace' },
  { prompt: true, text: 'protspace prepare -i sequences.fasta \\' },
  { text: '    -e prot_t5 -m pca2,umap2 -o out' },
  { muted: true, text: '  → out/data.parquetbundle' },
];

const panel = 'rounded-xl border border-border/70 bg-white';

/** One workflow step: a hairline with its number on it, then the step's single panel. */
function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="min-w-0 border-t border-border/70 pt-4">
      <Eyebrow>{label}</Eyebrow>
      <div className="space-y-3">{children}</div>
    </li>
  );
}

/**
 * The three stages of using ProtSpace in one row: the Python CLI prepares a dataset, the result
 * is a single portable `.parquetbundle`, and the browser explorer opens that bundle locally.
 */
export function WorkflowOverview() {
  return (
    <Section id="workflow" tone="muted">
      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
        <SectionHeading
          compact
          eyebrow="Your own data"
          title="From sequences to a map in one command"
          lede="Prepare a bundle in Python, then open it in the browser."
        />

        <ol className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)] md:gap-5">
          <Step label="01 Prepare">
            <div
              role="group"
              aria-label="Shell session installing ProtSpace and preparing a bundle"
              className={panel}
            >
              <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed text-foreground">
                <code>
                  {TERMINAL.map((line, i) => (
                    <span key={i} className={cn('block', line.muted && 'text-muted-foreground')}>
                      {line.prompt ? (
                        <span className="select-none text-muted-foreground">$ </span>
                      ) : null}
                      {line.text}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              12 pLM checkpoints or your own embeddings; PCA, UMAP, t-SNE, PaCMAP, MDS, LocalMAP;
              annotations from UniProt, InterPro, NCBI taxonomy and TED.
            </p>
          </Step>

          <Step label="02 Bundle">
            <div className={cn(panel, 'p-3')}>
              <p className="font-mono text-xs text-foreground">data.parquetbundle</p>
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                Annotations, projections, and optional settings and statistics, in one file.
              </p>
            </div>
          </Step>

          <Step label="03 Explore">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Drop the bundle into the explorer. It opens bundles up to Swiss-Prot scale: 573,649
              proteins.
            </p>
            <Link
              to="/explore"
              className="inline-block text-sm font-medium text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:decoration-primary"
            >
              Open the explorer
            </Link>
          </Step>
        </ol>
      </div>

      <p className="mt-8 max-w-4xl text-sm leading-relaxed text-muted-foreground">
        A bundle is read locally in the browser and never leaves the machine. Sequences do leave it
        in two cases: dropping a FASTA file into the explorer sends them to the ProtSpace
        preparation service, and <code className="font-mono text-[13px]">protspace prepare</code>{' '}
        embeds through the Biocentral API by default unless you pass{' '}
        <code className="whitespace-nowrap font-mono text-[13px]">--backend local</code>.
      </p>
    </Section>
  );
}
