import type { PsDialog } from '@protspace/core';
import { isMacOrIos } from '@protspace/utils';
import { useEffect, useRef } from 'react';
import { formatKeys, SHORTCUT_GROUPS } from './shortcuts';

/** The keyboard and pointer shortcuts, one titled section per group, in a modal dialog. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const dialog = useRef<PsDialog>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Escape, the close button and a backdrop press close the dialog itself; follow it.
    element.addEventListener('ps-close', onClose);
    return () => element.removeEventListener('ps-close', onClose);
  }, [onClose]);

  const mac = isMacOrIos();
  return (
    <ps-dialog ref={dialog} heading="Keyboard shortcuts" size="lg" open={open}>
      <div className="wb-shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((shortcut) => (
                <div className="wb-shortcut" key={`${shortcut.keys.join('+')} ${shortcut.action}`}>
                  <dt>{shortcut.action}</dt>
                  <dd>
                    <kbd>{formatKeys(shortcut.keys, mac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </ps-dialog>
  );
}
