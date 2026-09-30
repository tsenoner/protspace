import { Box, ChartColumn, Palette, Shuffle, Tags, type LucideIcon } from 'lucide-react';
import { Eyebrow } from './Section';

/** What the explorer does, each with the icon of the feature it names. */
const CAPABILITIES: [LucideIcon, string][] = [
  [Palette, 'Recolor'],
  [Shuffle, 'Re-project'],
  [Tags, 'Transfer labels'],
  [ChartColumn, 'Score clusters'],
  [Box, 'Open structures'],
];

/**
 * Heading of the "One map, many questions" showcase. The eyebrow introduces the section on a line
 * of its own; below it the title, then what the explorer does, then the data it all runs on. At xl
 * the capabilities sit on the title's baseline with the caption right under them, so the two read
 * as one statement.
 */
export function ShowcaseHeading({ count }: { count: number }) {
  return (
    <div>
      <Eyebrow>In the explorer</Eyebrow>
      <div className="grid xl:grid-cols-[auto_minmax(0,1fr)] xl:items-baseline xl:gap-x-8">
        <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
          One map, many questions
        </h2>
        <ul
          aria-label="What the explorer does"
          className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground sm:gap-x-6 xl:mt-0 xl:justify-end"
        >
          {CAPABILITIES.map(([Icon, label]) => (
            <li key={label} className="whitespace-nowrap">
              <Icon
                className="mr-1.5 inline-block size-4 align-[-0.1875rem] text-primary"
                aria-hidden="true"
              />
              {label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground xl:col-start-2 xl:mt-1 xl:text-right">
          All on the same {count.toLocaleString()} venom proteins.
        </p>
      </div>
    </div>
  );
}
