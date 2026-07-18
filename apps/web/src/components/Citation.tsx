import { useState } from 'react';
import { BookOpen, Copy, Check, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import {
  PUBLICATION_WEB,
  PUBLICATION_JMB,
  doiUrl,
  type Publication,
} from '../../../../config/citations';

interface Reference extends Publication {
  id: string;
  tag: string;
  tagClass: string;
}

const references: Reference[] = [
  {
    ...PUBLICATION_WEB,
    id: 'web',
    tag: 'Latest · Preprint',
    tagClass: 'bg-primary/10 text-primary',
  },
  {
    ...PUBLICATION_JMB,
    id: 'original',
    tag: 'Original · Peer-reviewed',
    tagClass: 'bg-muted text-muted-foreground',
  },
];

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
    <section id="citation" className="py-24 relative">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
            How to
            <span className="block bg-gradient-primary bg-clip-text text-transparent">
              Cite ProtSpace
            </span>
          </h2>
          <p className="text-lg text-muted-foreground">
            If ProtSpace supports your research, please cite it. The web-application preprint is the
            latest reference; the peer-reviewed article is the original ProtSpace publication.
          </p>
        </div>

        {/* Citation cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {references.map((ref) => (
            <Card
              key={ref.id}
              className="flex flex-col p-6 bg-gradient-card backdrop-blur-xs border-border/40"
            >
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="h-5 w-5 text-primary" />
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${ref.tagClass}`}>
                  {ref.tag}
                </span>
              </div>

              <p className="text-sm text-foreground/90 leading-relaxed mb-4 flex-1">
                {ref.citation}
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-auto">
                <a
                  href={doiUrl(ref.doi)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {ref.doi}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => handleCopy(ref)}
                  aria-label={`Copy BibTeX for ${ref.tag}`}
                >
                  {copied === ref.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === ref.id ? 'Copied' : 'Copy BibTeX'}
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-10">
          A machine-readable{' '}
          <a
            href="https://github.com/tsenoner/protspace/blob/main/CITATION.cff"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            CITATION.cff
          </a>{' '}
          is included — use GitHub&rsquo;s &ldquo;Cite this repository&rdquo; button to export
          BibTeX or APA.
        </p>
      </div>
    </section>
  );
};

export default Citation;
