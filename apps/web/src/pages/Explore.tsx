// Tokens and the kit before the shell's first render: React sets kit properties only on a defined
// element, and the bars paint from --ps-* tokens (design decision 5). The full core arrives later,
// with the runtime.
import '@protspace/core/kit';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useExploreUrlStateSync } from '../explore/use-url-state-sync';
import { Workbench } from '../workbench/Workbench';

const Explore = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { attachController } = useExploreUrlStateSync(searchParams, setSearchParams);

  useEffect(() => {
    let mounted = true;
    let detachController: (() => void) | null = null;

    // Initialize the Explore runtime asynchronously
    const init = async () => {
      try {
        // Import and initialize the Explore runtime
        const { initializeExploreRuntime } = await import('../explore/runtime');

        // Only proceed if component is still mounted
        if (!mounted) return;

        // Wait for custom elements to be defined and initialized
        const controller = await initializeExploreRuntime();

        if (!mounted) {
          controller.dispose();
          return;
        }

        detachController = attachController(controller);
      } catch (error) {
        console.error('Failed to initialize the Explore runtime:', error);
      }
    };

    init();

    return () => {
      mounted = false;
      detachController?.();
    };
  }, [attachController]);

  return <Workbench />;
};

export default Explore;
