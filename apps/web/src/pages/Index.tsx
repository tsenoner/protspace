import Header from '@/components/Header';
import Hero from '@/components/Hero';
import Citation from '@/components/Citation';
import Footer from '@/components/Footer';
import { AnnotationExplorerPreview } from '@/landing/AnnotationExplorerPreview';
import { WorkflowOverview } from '@/landing/WorkflowOverview';
import { EatPreview } from '@/landing/EatPreview';
import { ProjectionEvaluationPreview } from '@/landing/ProjectionEvaluationPreview';
import { ClosingCta } from '@/landing/ClosingCta';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <AnnotationExplorerPreview />
        <WorkflowOverview />
        <EatPreview />
        <ProjectionEvaluationPreview />
        <ClosingCta />
        <Citation />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
