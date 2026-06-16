import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import Header, { HEADER_HEIGHT_CLASS } from '@/components/Header';
import { useExploreUrlStateSync } from '../explore/use-url-state-sync';
import './Explore.css';

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

  return (
    <div className="h-screen w-full bg-[#f4f4f4] flex flex-col overflow-hidden">
      <div className={`${HEADER_HEIGHT_CLASS} flex-none z-50`}>
        <Header variant="light" />
      </div>
      <div className="explore-wrapper flex-1 relative min-h-[600px]">
        <div className="explore-container h-full">
          <protspace-data-loader id="myDataLoader"></protspace-data-loader>

          <protspace-control-bar
            id="myControlBar"
            data-driver-id="control-bar"
            selected-proteins-count="0"
            auto-sync="true"
            scatterplot-selector="#myPlot"
          ></protspace-control-bar>

          <div className="visualization-container">
            <protspace-scatterplot
              id="myPlot"
              data-driver-id="scatterplot"
              show-tour-button="true"
            ></protspace-scatterplot>

            <div className="right-panel">
              <protspace-legend
                id="myLegend"
                data-driver-id="legend"
                auto-sync="true"
                auto-hide="true"
                scatterplot-selector="#myPlot"
              ></protspace-legend>
              <protspace-structure-viewer
                id="myStructureViewer"
                title="AlphaFold2 Structure"
                height="340px"
                show-header="true"
                show-close-button="true"
                show-tips="true"
                auto-sync="true"
                auto-show="true"
                scatterplot-selector="#myPlot"
                style={{ display: 'none' }}
              ></protspace-structure-viewer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Explore;
