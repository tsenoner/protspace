import { Network, Layers, Database, Share2, Box, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';

const features = [
  {
    icon: Network,
    title: 'Protein Language Models',
    description:
      'See protein space the way pLMs do — ProtT5, ESM-2, ESM-C, Ankh, and 12+ models, no alignments required.',
  },
  {
    icon: Layers,
    title: 'Six Projection Methods',
    description:
      'Compare PCA, UMAP, t-SNE, PaCMAP, MDS, and LocalMAP side by side to find the view that reveals your biology.',
  },
  {
    icon: Database,
    title: 'Rich Annotations',
    description:
      'Color proteins by UniProt, InterPro, TED domains, AlphaFold, and ML predictions — curated evidence and models in one place.',
  },
  {
    icon: Share2,
    title: 'Annotation Transfer (EAT)',
    description:
      'Fill in missing labels from the nearest annotated protein in embedding space, each with a confidence score.',
  },
  {
    icon: Box,
    title: '3D Structures in the Browser',
    description:
      'Open AlphaFold structures via Mol* right from the plot — sequence and structure, side by side.',
  },
  {
    icon: Zap,
    title: 'Swiss-Prot Scale',
    description:
      'Explore 570,000+ proteins entirely client-side — nothing uploaded — then export publication-ready figures.',
  },
];

const Features = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
            Powerful Features for
            <span className="block bg-gradient-primary bg-clip-text text-transparent">
              Protein Analysis
            </span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to visualize and explore large-scale protein embedding spaces
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card
                key={index}
                className="group relative p-6 bg-gradient-card backdrop-blur-xs border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-card hover:-translate-y-1"
              >
                {/* Icon */}
                <div className="mb-4 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-6 w-6 text-primary" />
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground">{feature.description}</p>

                {/* Hover gradient effect */}
                <div className="absolute inset-0 rounded-lg bg-gradient-primary opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none" />
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Features;
