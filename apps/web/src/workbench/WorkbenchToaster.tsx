import { useEffect, type CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';
import { setNotifyTarget } from '../lib/notify';

const TOASTER_ID = 'workbench';

/** Sonner reads its toast width from --width; the style prop overrides its inline default. */
const TOASTER_STYLE = { '--width': '360px' } as CSSProperties;

/**
 * The workbench's own toaster (design decision 15): centred at the plot's bottom edge, so a
 * notification never covers the legend, at most three at a time, each with a close button. While
 * it is mounted every `notify` toast comes here; the app's toaster keeps the other routes'. Light
 * theme: the colours come from the --ps-* tokens in workbench.css, which follow the theme.
 */
export function WorkbenchToaster() {
  useEffect(() => {
    setNotifyTarget(TOASTER_ID);
    return () => setNotifyTarget(null);
  }, []);
  return (
    <Sonner
      id={TOASTER_ID}
      position="bottom-center"
      closeButton
      visibleToasts={3}
      theme="light"
      offset={{ bottom: 12 }}
      style={TOASTER_STYLE}
      toastOptions={{ closeButtonAriaLabel: 'Dismiss notification', className: 'wb-toast' }}
    />
  );
}
