import { MessageSquare } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FEEDBACK_MENU_ITEMS, runFeedbackAction, type FeedbackAction } from '@/lib/support';
import { cn } from '@/lib/utils';
import { notifyCopied } from '@/workbench/FeedbackMenu';

/** A 16 px icon at the kit's stroke, as in Explore's app bar; decorative. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * Home's Feedback menu, with Explore's entries (FEEDBACK_MENU_ITEMS): email, the address to copy,
 * and a GitHub issue. A menu button: Enter, Space or a click opens it with focus on the first
 * entry; the arrows, Home and End move; Escape, Tab or a click outside closes it.
 */
export function SiteFeedbackMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const choose = (action: FeedbackAction) => {
    setOpen(false);
    button.current?.focus();
    runFeedbackAction(action, notifyCopied);
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = items();
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => entries[(index + entries.length) % entries.length]?.focus();
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={button}
            type="button"
            className={className}
            aria-label="Feedback"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            <MessageSquare {...ICON} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Feedback</TooltipContent>
      </Tooltip>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Feedback"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-2 min-w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {FEEDBACK_MENU_ITEMS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(value)}
              className={cn(
                'block w-full rounded-md px-3 py-2 text-left transition-colors',
                'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
