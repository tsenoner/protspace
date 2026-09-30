import Header from '@/components/Header';
import Hero from '@/components/Hero';
import Citation from '@/components/Citation';
import Footer from '@/components/Footer';
import { FeatureShowcase } from '@/landing/FeatureShowcase';
import { WorkflowOverview } from '@/landing/WorkflowOverview';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <FeatureShowcase />
        <WorkflowOverview />
        <Citation />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
