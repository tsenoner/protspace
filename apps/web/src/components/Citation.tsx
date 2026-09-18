import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DOCS_URL } from '@/config';
import { Section, SectionHeading } from '@/landing/Section';
import { notify } from '@/lib/notify';
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
  /** Spoken label for the copy button. */
  aria: string;
}

const references: Reference[] = [
  {
    ...PUBLICATION_WEB,
    id: 'web',
    tag: 'Preprint · 2026 · preferred citation',
    aria: 'Copy BibTeX for the 2026 bioRxiv preprint',
  },
  {
    ...PUBLICATION_JMB,
    id: 'original',
    tag: 'Peer-reviewed · 2025',
    aria: 'Copy BibTeX for the 2025 Journal of Molecular Biology article',
  },
];

const resources = [
  {
    label: 'GitHub repository',
    note: 'Source code and issue tracker',
    href: 'https://github.com/tsenoner/protspace',
    external: true,
  },
  {
    label: 'Documentation',
    note: 'Guides, data preparation, CLI reference',
    href: DOCS_URL,
    external: false,
  },
  {
    label: 'Python package',
    note: 'pip install protspace',
    href: 'https://pypi.org/project/protspace/',
    external: true,
  },
  {
    label: 'CITATION.cff',
    note: 'Machine-readable citation metadata',
    href: 'https://github.com/tsenoner/protspace/blob/main/CITATION.cff',
    external: true,
  },
];

const linkClass =
  'text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground';

const Citation = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (ref: Reference) => {
    try {
      await navigator.clipboard.writeText(ref.bibtex);
      setCopied(ref.id);
      notify.success({ title: 'BibTeX copied to clipboard' });
      setTimeout(() => setCopied((current) => (current === ref.id ? null : current)), 2000);
    } catch {
      notify.error({ title: 'Could not copy to clipboard' });
    }
  };

  return (
    <Section id="citation" className="border-t border-border">
      <SectionHeading
        eyebrow="Research software"
        title="Paper, code and citation"
        lede="If ProtSpace supports your work, cite the bioRxiv preprint; the Journal of Molecular Biology article describes the original tool."
      />

      <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <ul className="divide-y divide-border lg:col-span-7">
          {references.map((ref) => (
            <li key={ref.id} className="py-6 first:pt-0 last:pb-0">
              <p className="text-xs tracking-wide text-muted-foreground">{ref.tag}</p>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{ref.citation}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                <a
                  href={doiUrl(ref.doi)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[13px] text-primary hover:underline"
                >
                  {ref.doi}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(ref)}
                  aria-label={ref.aria}
                >
                  {copied === ref.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === ref.id ? 'Copied' : 'Copy BibTeX'}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="lg:col-span-5">
          <h3 className="text-sm font-medium text-foreground">Code, package and license</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {resources.map((resource) => (
              <li key={resource.href}>
                <a
                  href={resource.href}
                  {...(resource.external
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : undefined)}
                  className={linkClass}
                >
                  {resource.label}
                </a>
                <span className="text-muted-foreground"> · {resource.note}</span>
              </li>
            ))}
            <li className="text-muted-foreground">
              Released under the MIT license, Python ≥ 3.12.
            </li>
          </ul>
        </div>
      </div>
    </Section>
  );
};

export default Citation;
