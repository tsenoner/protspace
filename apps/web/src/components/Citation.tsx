import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  FileCode2,
  Github,
  Package,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DOCS_URL } from '@/config';
import { Section, SectionHeading } from '@/landing/Section';
import { notify } from '@/lib/notify';
import { GITHUB_REPO_URL } from '@/lib/support';
import { cn } from '@/lib/utils';
import {
  PUBLICATION_WEB,
  PUBLICATION_JMB,
  doiUrl,
  type Publication,
} from '../../../../config/citations';

interface Reference extends Publication {
  id: string;
  /** Short provenance line above the citation. */
  tag: string;
  /** Marks the reference to cite; the tag line says so in place of a lede. */
  preferred?: boolean;
  /** Spoken label for the copy button. */
  aria: string;
}

const references: Reference[] = [
  {
    ...PUBLICATION_WEB,
    id: 'web',
    tag: 'Preprint · 2026',
    preferred: true,
    aria: 'Copy BibTeX for the 2026 bioRxiv preprint',
  },
  {
    ...PUBLICATION_JMB,
    id: 'original',
    tag: 'Peer-reviewed · 2025',
    aria: 'Copy BibTeX for the 2025 Journal of Molecular Biology article',
  },
];

interface Resource {
  label: string;
  note: string;
  href: string;
  external: boolean;
  icon: LucideIcon;
}

const resources: Resource[] = [
  {
    label: 'GitHub repository',
    note: 'Source code and issue tracker',
    href: GITHUB_REPO_URL,
    external: true,
    icon: Github,
  },
  {
    label: 'Documentation',
    note: 'Guides, data preparation, CLI reference',
    href: DOCS_URL,
    external: false,
    icon: BookOpen,
  },
  {
    label: 'Python package',
    note: 'pip install protspace',
    href: 'https://pypi.org/project/protspace/',
    external: true,
    icon: Package,
  },
  {
    label: 'CITATION.cff',
    note: 'Machine-readable citation metadata',
    href: `${GITHUB_REPO_URL}/blob/main/CITATION.cff`,
    external: true,
    icon: FileCode2,
  },
];

const COPIED_MS = 2000;

/** Copies one reference's BibTeX; each button keeps its own "Copied" state and timer. */
function CopyBibtexButton({ reference }: { reference: Reference }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference.bibtex);
      notify.success({ title: 'BibTeX copied to clipboard' });
      setCopied(true);
      // A repeat click restarts the window instead of letting the first timer cut it short.
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      notify.error({ title: 'Could not copy to clipboard' });
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={copy} aria-label={reference.aria}>
      {copied ? <Check className="text-primary" /> : <Copy />}
      {/* Both labels share one grid cell, so the button keeps the wider label's width. */}
      <span className="grid justify-items-start">
        <span className={cn('col-start-1 row-start-1', copied && 'invisible')}>Copy BibTeX</span>
        <span className={cn('col-start-1 row-start-1', !copied && 'invisible')}>Copied</span>
      </span>
    </Button>
  );
}

const Citation = () => (
  <Section id="citation" className="border-t border-border">
    <SectionHeading compact eyebrow="Research software" title="Cite ProtSpace" />

    <div className="mt-8 grid gap-12 lg:grid-cols-12">
      <ul className="divide-y divide-border lg:col-span-7">
        {references.map((ref) => (
          <li key={ref.id} className="py-6 first:pt-0 last:pb-0">
            <p className="text-xs tracking-wide text-muted-foreground">
              {ref.tag}
              {ref.preferred ? (
                <>
                  {' · '}
                  <span className="font-medium text-primary">preferred citation</span>
                </>
              ) : null}
            </p>
            <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground">
              {ref.citation}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a
                href={doiUrl(ref.doi)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`DOI ${ref.doi} (opens in a new tab)`}
                className="break-all rounded-sm font-mono text-[13px] text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {ref.doi}
              </a>
              <CopyBibtexButton reference={ref} />
            </div>
          </li>
        ))}
      </ul>

      {/* From lg up the aside stretches to the references' height: its label sits on the first
          tag line and the panel's rows share the remaining height, so its bottom edge meets the
          last Copy BibTeX button. */}
      <aside aria-labelledby="citation-resources" className="flex min-w-0 flex-col lg:col-span-5">
        <h3 id="citation-resources" className="text-xs tracking-wide text-muted-foreground">
          Code, package and license
        </h3>
        <div className="mt-2 flex flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-white">
          {/* Hairlines come from the 1px gaps over a border-coloured list: rows stack on phones,
              form a 2 x 2 grid on tablets, and share the stretched height from lg up. */}
          <ul className="grid flex-1 gap-px bg-border/70 md:grid-cols-2 lg:flex lg:flex-col">
            {resources.map((resource) => {
              const Icon = resource.icon;
              return (
                <li key={resource.href} className="flex bg-white lg:flex-1">
                  <a
                    href={resource.href}
                    {...(resource.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : undefined)}
                    className="group flex w-full items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Icon
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground group-hover:text-primary">
                        {resource.label}
                      </span>
                      <span className="block text-[13px] leading-snug text-muted-foreground">
                        {resource.note}
                      </span>
                    </span>
                    {resource.external ? (
                      <>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary"
                        />
                        <span className="sr-only">(opens in a new tab)</span>
                      </>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="flex items-center gap-2 border-t border-border/70 bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
            <Scale aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Released under the MIT license, Python&nbsp;≥&nbsp;3.12.
          </p>
        </div>
      </aside>
    </div>
  </Section>
);

export default Citation;
