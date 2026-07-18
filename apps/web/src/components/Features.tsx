import { Sparkles, Layers, Share2, BarChart3, SlidersHorizontal, Box } from 'lucide-react';
import { Card } from '@/components/ui/card';

const features = [
  {
    icon: Sparkles,
    title: 'Beyond Sequence Similarity',
    description:
      'Surface functional relationships that sequence alignment misses — the biology embeddings reveal and networks cannot.',
  },
  {
    icon: Layers,
    title: 'Layered Annotations',
    description:
      'Overlay UniProt, InterPro, AlphaFold, TED domains, and ML predictions on every protein in the map.',
  },
  {
    icon: Share2,
    title: 'Annotation Transfer (EAT)',
    description:
      'Fill missing labels from the nearest neighbour in embedding space, each with a confidence score.',
  },
  {
    icon: BarChart3,
    title: 'Insights Through Statistics',
    description:
      'Silhouette, trustworthiness, and cluster-validity scores tell you which regions of the map to trust.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Your Model, Your Projection',
    description:
      'Model-agnostic embeddings with modular, extensible projection methods — bring your own and compare.',
  },
  {
    icon: Box,
    title: 'Structures & Figures, in Place',
    description:
      'Open AlphaFold 3D structures and export publication-ready figures without leaving the browser.',
  },
];

const Features = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
            From embedding space to
            <span className="block bg-gradient-primary bg-clip-text text-transparent">
              biological insight
            </span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to explore protein embedding space — and act on it
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
