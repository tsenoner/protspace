import { useState } from 'react';
import { BookOpen, Copy, Check, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

interface Reference {
  id: string;
  tag: string;
  tagClass: string;
  citation: string;
  doi: string;
  doiLabel: string;
  bibtex: string;
}

const references: Reference[] = [
  {
    id: 'web',
    tag: 'Latest · Preprint',
    tagClass: 'bg-primary/10 text-primary',
    citation:
      'Senoner, T., Vahidi, P., Olenyi, T., Senoner, F., Sisman, G., Kahl, E., Rost, B., & Koludarov, I. (2026). ProtSpace: Protein Universe in Your Browser. bioRxiv.',
    doi: 'https://doi.org/10.64898/2026.05.04.722720',
    doiLabel: '10.64898/2026.05.04.722720',
    bibtex: `@article{senoner2026protspaceweb,
  title     = {ProtSpace: Protein Universe in Your Browser},
  author    = {Senoner, Tobias and Vahidi, Peyman and Olenyi, Tobias and Senoner, Florin and Sisman, G{\\"o}khan and Kahl, Elias and Rost, Burkhard and Koludarov, Ivan},
  journal   = {bioRxiv},
  year      = {2026},
  doi       = {10.64898/2026.05.04.722720},
  url       = {https://www.biorxiv.org/content/10.64898/2026.05.04.722720v1},
  publisher = {openRxiv}
}`,
  },
  {
    id: 'original',
    tag: 'Original · Peer-reviewed',
    tagClass: 'bg-muted text-muted-foreground',
    citation:
      'Senoner, T., Olenyi, T., Heinzinger, M., Spannagl, A., Bouras, G., Rost, B., & Koludarov, I. (2025). ProtSpace: A Tool for Visualizing Protein Space. Journal of Molecular Biology, 437(15), 168940.',
    doi: 'https://doi.org/10.1016/j.jmb.2025.168940',
    doiLabel: '10.1016/j.jmb.2025.168940',
    bibtex: `@article{senoner2025protspace,
  title     = {ProtSpace: A Tool for Visualizing Protein Space},
  author    = {Senoner, Tobias and Olenyi, Tobias and Heinzinger, Michael and Spannagl, Anton and Bouras, George and Rost, Burkhard and Koludarov, Ivan},
  journal   = {Journal of Molecular Biology},
  volume    = {437},
  number    = {15},
  pages     = {168940},
  year      = {2025},
  doi       = {10.1016/j.jmb.2025.168940},
  publisher = {Elsevier}
}`,
  },
];

const Citation = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (ref: Reference) => {
    try {
      await navigator.clipboard.writeText(ref.bibtex);
      setCopied(ref.id);
      toast.success('BibTeX copied to clipboard');
      setTimeout(() => setCopied((current) => (current === ref.id ? null : current)), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
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
                  href={ref.doi}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {ref.doiLabel}
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
