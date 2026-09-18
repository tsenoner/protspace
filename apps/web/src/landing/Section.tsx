import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  id?: string;
  /** `muted` puts the section on the explorer's off-white canvas to vary the page rhythm. */
  tone?: 'default' | 'muted';
  className?: string;
  children: ReactNode;
}

/** A landing-page section: generous vertical rhythm, shared container, optional muted band. */
export function Section({ id, tone = 'default', className, children }: SectionProps) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-12 py-24 sm:py-32', tone === 'muted' && 'bg-muted/40', className)}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  className?: string;
}

/** Section heading: mono eyebrow like an explorer chip, editorial title, one lede paragraph. */
export function SectionHeading({ eyebrow, title, lede, className }: SectionHeadingProps) {
  return (
    <div className={cn('max-w-2xl', className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
        {title}
      </h2>
      {lede ? (
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">{lede}</p>
      ) : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: string }) {
  return (
    <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}
