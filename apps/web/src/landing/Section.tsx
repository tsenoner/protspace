import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  id?: string;
  /** `muted` puts the section on the explorer's off-white canvas to vary the page rhythm. */
  tone?: 'default' | 'muted';
  className?: string;
  children: ReactNode;
}

/** A landing-page section: shared container and vertical rhythm, optional muted band. */
export function Section({ id, tone = 'default', className, children }: SectionProps) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-12 py-12 sm:py-18', tone === 'muted' && 'bg-muted/40', className)}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  /** A smaller title for the supporting sections below the features. */
  compact?: boolean;
}

/** Section heading: mono eyebrow like an explorer chip, editorial title, one lede paragraph. */
export function SectionHeading({ eyebrow, title, lede, compact }: SectionHeadingProps) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          'text-balance font-semibold leading-[1.1] tracking-tight text-foreground',
          compact ? 'text-2xl sm:text-[1.75rem]' : 'text-3xl sm:text-4xl lg:text-[2.75rem]',
        )}
      >
        {title}
      </h2>
      {lede ? (
        <p
          className={cn(
            'text-pretty leading-relaxed text-muted-foreground',
            compact ? 'mt-3 text-base' : 'mt-5 text-lg',
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

/** The accent text link used under landing-page features and steps. */
export const linkClass =
  'text-sm font-medium text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:decoration-primary';

export function Eyebrow({ children }: { children: string }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}
