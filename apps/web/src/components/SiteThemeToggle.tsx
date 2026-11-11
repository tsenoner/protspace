import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { THEME_MODE_LABELS, themeButtonLabel, type ThemeMode } from '@/explore/theme-defaults';
import { getResolvedTheme, setThemeMode, toggleThemeMode } from '@/explore/theme-state';
import { cn } from '@/lib/utils';
import { useResolvedTheme } from '@/workbench/use-theme';

/** A 16 px icon at the kit's stroke, as in Explore's app bar; decorative. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * Home's theme button, Explore's twin (workbench/ThemeToggle.tsx) in React: it flips between light
 * and dark, starting from the system's mode, and the choice is the one Explore and the docs read.
 * Its icon is the mode on screen; a press also announces the new mode.
 */
export function SiteThemeToggle({ className }: { className: string }) {
  const mode = useResolvedTheme();
  const [announcement, setAnnouncement] = useState('');
  const label = themeButtonLabel(mode);
  const toggle = () => {
    toggleThemeMode();
    setAnnouncement(`Theme: ${THEME_MODE_LABELS[getResolvedTheme()]}`);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={className} aria-label={label} onClick={toggle}>
            {mode === 'dark' ? <Moon {...ICON} /> : <Sun {...ICON} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}

/**
 * The phone menu's Theme row: Light and Dark as a pair, the mode on screen selected, as Explore's
 * More sheet has it. Picking the system's own mode follows the system again.
 */
export function SiteThemeChoice({ className }: { className?: string }) {
  const mode = useResolvedTheme();
  const modes: ThemeMode[] = ['light', 'dark'];
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <span className="flex items-center gap-2" aria-hidden="true">
        {mode === 'dark' ? <Moon {...ICON} /> : <Sun {...ICON} />}
        Theme
      </span>
      <div role="group" aria-label="Theme" className="flex rounded-md border p-0.5">
        {modes.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setThemeMode(value)}
            className={cn(
              'rounded-[4px] px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {THEME_MODE_LABELS[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
