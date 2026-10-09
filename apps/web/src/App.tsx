import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import Index from './pages/Index';
import Explore from './pages/Explore';
import NotFound from './pages/NotFound';
import Privacy from './pages/Privacy';

// Development-only review page for the kit; production builds drop the import entirely.
const KitGallery = import.meta.env.DEV ? lazy(() => import('./dev/KitGallery')) : null;

const App = () => (
  <TooltipProvider>
    <Toaster />
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/privacy" element={<Privacy />} />
        {KitGallery && (
          <Route
            path="/dev/kit"
            element={
              <Suspense fallback={null}>
                <KitGallery />
              </Suspense>
            }
          />
        )}
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
