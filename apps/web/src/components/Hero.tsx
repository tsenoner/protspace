import { Button } from '@/components/ui/button';
import { Database, BookOpen, Play } from 'lucide-react';
import { Link } from 'react-router';
import { DOCS_URL } from '@/config';

const Hero = () => {
  return (
    <section
      id="home"
      className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16"
    >
      {/* Animated background - protein network visualization */}
      <div className="absolute inset-0 bg-gradient-hero">
        <div className="absolute inset-0 opacity-30">
          {/* Floating protein nodes */}
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-primary/20 blur-xl animate-pulse"
              style={{
                width: `${Math.random() * 100 + 50}px`,
                height: `${Math.random() * 100 + 50}px`,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${Math.random() * 5 + 3}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Title */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight">
            <span className="block"> Your Journey Through</span>
            <span className="block bg-gradient-primary bg-clip-text text-transparent">
              Protein Universe
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            Explore protein language model embeddings overlaid with biology — and see what sequence
            similarity can&rsquo;t.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button variant="hero" size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/explore">
                <Play className="h-5 w-5" />
                Start Exploring
              </Link>
            </Button>

            <Button variant="outline-hero" size="lg" className="w-full sm:w-auto" asChild>
              <a href={DOCS_URL}>
                <BookOpen className="h-5 w-5" />
                Documentation
              </a>
            </Button>

            <Button variant="outline-hero" size="lg" className="w-full sm:w-auto" asChild>
              <a
                href="https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Preparation.ipynb"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Database className="h-5 w-5" />
                Prepare Data
              </a>
            </Button>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-3 justify-center pt-8">
            <span className="px-4 py-2 rounded-full bg-card/50 backdrop-blur-xs border border-border/40 text-sm">
              Nothing leaves your browser
            </span>
            <span className="px-4 py-2 rounded-full bg-card/50 backdrop-blur-xs border border-border/40 text-sm">
              Swiss-Prot scale
            </span>
            <span className="px-4 py-2 rounded-full bg-card/50 backdrop-blur-xs border border-border/40 text-sm">
              Annotation transfer (EAT)
            </span>
            <span className="px-4 py-2 rounded-full bg-card/50 backdrop-blur-xs border border-border/40 text-sm">
              Trustworthy projections
            </span>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 rounded-full border-2 border-primary/50 flex items-start justify-center p-2">
          <div className="w-1 h-3 rounded-full bg-primary/50" />
        </div>
      </div>
    </section>
  );
};

export default Hero;
