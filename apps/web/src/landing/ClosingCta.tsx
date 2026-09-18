import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DOCS_URL } from '@/config';
import { Eyebrow, Section } from './Section';

/** Closing call to action: open the shipped demo bundle, or prepare your own. */
export function ClosingCta() {
  return (
    <Section id="start" className="border-t border-border">
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>Get started</Eyebrow>
        <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
          Open the demo bundle, or bring your own
        </h2>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          The explorer ships with the 7,831-protein venom demo. Your own data needs one{' '}
          <code className="font-mono text-[15px]">protspace prepare</code> run.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" className="px-6" asChild>
            <Link to="/explore">Start exploring</Link>
          </Button>
          <Button size="lg" variant="outline" className="px-6" asChild>
            <a href={`${DOCS_URL}guide/data-preparation`}>Prepare data</a>
          </Button>
        </div>
      </div>
    </Section>
  );
}
