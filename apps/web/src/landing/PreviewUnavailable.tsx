import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { linkClass } from './Section';

/**
 * What a landing preview box shows when its static data failed to load: one muted line,
 * centered in the box (which must be positioned). With `exploreLink`, it also points to
 * /explore, which loads its own data and so still works.
 */
export function PreviewUnavailable({
  message = 'Preview unavailable',
  exploreLink = false,
}: {
  message?: string;
  exploreLink?: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground',
        exploreLink ? 'text-sm' : 'text-xs',
      )}
    >
      <p>{message}</p>
      {exploreLink ? (
        <Link to="/explore" className={cn('inline-flex items-center gap-1', linkClass)}>
          Open the explorer
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
