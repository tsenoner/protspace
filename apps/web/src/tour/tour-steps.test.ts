import { describe, expect, it } from 'vitest';
import type { LayoutMode } from '../explore/layout-defaults';
import type { TourKind } from './storage-key';
import { tourSteps, type TourContext, type TourStepSpec } from './tour-steps';

const MODES: readonly LayoutMode[] = ['desktop', 'tablet', 'phone', 'landscape'];
const KINDS: readonly TourKind[] = ['full', 'whats-new'];

/** The Copy table of the plan's Global Constraints. */
const FULL_DESKTOP = [
  'Welcome to ProtSpace',
  'Import & Export',
  'The View Bar',
  'Search Proteins',
  'Interactive Scatterplot',
  'Selection Tools',
  'Legend Panel',
  'Expand Hidden Categories',
  'The Sidebar',
  'Light or Dark',
  "You're All Set!",
];
const FULL_PHONE = [
  'Welcome to ProtSpace',
  'Your Data',
  'The View Bar',
  'More Options',
  'Search Proteins',
  'Interactive Scatterplot',
  'Selection Tools',
  'Legend Panel',
  'Expand Hidden Categories',
  "You're All Set!",
];
const NEW_DESKTOP = [
  "What's new in ProtSpace",
  'The View Bar',
  'The Sidebar',
  'Selection Tools',
  'Light or Dark',
  "That's it",
];
const NEW_PHONE = [
  "What's new in ProtSpace",
  'The View Bar',
  'More Options',
  'Legend Panel',
  'Selection Tools',
  "That's it",
];
const withoutSidebar = (titles: string[]) => titles.filter((title) => title !== 'The Sidebar');

/** The data-driver-id values the Global Constraints keep or add. */
const DRIVER_IDS = [
  'scatterplot',
  'legend',
  'other-row',
  'import',
  'projections',
  'search',
  'selection',
  'data-actions',
  'help',
  'theme',
  'view-bar',
  'dataset',
  'rail',
  'more',
  'search-toggle',
];

const context = (mode: LayoutMode, coarse = false, mac = false): TourContext => ({
  mode,
  coarse,
  mac,
});
const titles = (steps: TourStepSpec[]) => steps.map((step) => step.title);
const driverId = (selector: string) => /^\[data-driver-id="([a-z-]+)"\]$/.exec(selector)?.[1];
/** The data-driver-id each step points at: its light-DOM target or its shadow host. */
const targetIds = (steps: TourStepSpec[]) =>
  steps.flatMap((step) =>
    step.target === null
      ? []
      : typeof step.target === 'string'
        ? [driverId(step.target)]
        : [driverId(step.target.host), driverId(step.target.inner)],
  );
const step = (steps: TourStepSpec[], id: TourStepSpec['id']) => {
  const found = steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
};

describe('tourSteps', () => {
  it.each([
    ['full', 'desktop', FULL_DESKTOP],
    ['full', 'tablet', withoutSidebar(FULL_DESKTOP)],
    ['full', 'phone', FULL_PHONE],
    ['full', 'landscape', FULL_PHONE],
    ['whats-new', 'desktop', NEW_DESKTOP],
    ['whats-new', 'tablet', withoutSidebar(NEW_DESKTOP)],
    ['whats-new', 'phone', NEW_PHONE],
    ['whats-new', 'landscape', NEW_PHONE],
  ] as const)('the %s tour on %s has the titles of the Copy table', (kind, mode, expected) => {
    expect(titles(tourSteps(kind, context(mode)))).toEqual(expected);
  });

  it('gives a phone on its side the phone lists', () => {
    for (const kind of KINDS) {
      for (const coarse of [false, true]) {
        expect(tourSteps(kind, context('landscape', coarse))).toEqual(
          tourSteps(kind, context('phone', coarse)),
        );
      }
    }
  });

  it('points at nothing a phone or a tablet hides', () => {
    const hiddenOnPhones = [
      'search',
      'import',
      'data-actions',
      'help',
      'theme',
      'rail',
      'projections',
    ];
    for (const kind of KINDS) {
      for (const mode of ['phone', 'landscape'] as const) {
        const ids = targetIds(tourSteps(kind, context(mode, true)));
        for (const hidden of hiddenOnPhones)
          expect(ids, `${kind} on ${mode}`).not.toContain(hidden);
      }
      expect(targetIds(tourSteps(kind, context('tablet')))).not.toContain('rail');
    }
  });

  it('spotlights Help on the first step on desktop and tablet, More on a phone', () => {
    for (const kind of KINDS) {
      for (const mode of MODES) {
        const [first] = tourSteps(kind, context(mode));
        expect(first.target).toBeNull();
        expect(first.spotlight).toBe(
          mode === 'phone' || mode === 'landscape'
            ? '[data-driver-id="more"]'
            : '[data-driver-id="help"]',
        );
      }
    }
  });

  it('talks touch on a coarse pointer, tablet included', () => {
    for (const mode of MODES) {
      const steps = tourSteps('full', context(mode, true));
      for (const id of ['plot', 'legend', 'other'] as const) {
        expect(step(steps, id).description, `${id} on ${mode}`).not.toMatch(
          /click|hover|mouse wheel/i,
        );
      }
      expect(step(steps, 'legend').description).toContain('double-tap');
    }
    const phoneNew = tourSteps('whats-new', context('phone', true));
    expect(step(phoneNew, 'legend').description).toContain('double-tap');
    expect(step(phoneNew, 'legend').description).not.toMatch(/click|hover|mouse wheel/i);
  });

  it('talks mouse on a fine pointer', () => {
    const steps = tourSteps('full', context('desktop'));
    expect(step(steps, 'plot').description).toMatch(/mouse wheel/i);
    expect(step(steps, 'legend').description).toMatch(/double-click/i);
  });

  it('writes the modifier as the keyboard shows it', () => {
    const text = (mac: boolean) =>
      tourSteps('full', context('desktop', false, mac))
        .map((spec) => spec.description)
        .join('\n');
    expect(text(true)).toContain('⌘');
    expect(text(true)).not.toContain('Ctrl');
    expect(text(false)).toContain('Ctrl');
    expect(text(false)).not.toContain('⌘');
  });

  it('targets only the data-driver-id values the shell keeps, each id once per list', () => {
    for (const kind of KINDS) {
      for (const mode of MODES) {
        for (const coarse of [false, true]) {
          const steps = tourSteps(kind, context(mode, coarse));
          for (const spec of steps) {
            const selectors = [
              ...(spec.target === null
                ? []
                : typeof spec.target === 'string'
                  ? [spec.target]
                  : [spec.target.host, spec.target.inner]),
              ...(spec.spotlight ? [spec.spotlight] : []),
            ];
            for (const selector of selectors) {
              expect(DRIVER_IDS, `${spec.id}: ${selector}`).toContain(driverId(selector));
            }
          }
          const ids = steps.map((spec) => spec.id);
          expect(new Set(ids).size, `${kind} on ${mode}`).toBe(ids.length);
        }
      }
    }
  });

  it('points the Other step into the legend shadow root', () => {
    expect(step(tourSteps('full', context('desktop')), 'other').target).toEqual({
      host: '[data-driver-id="legend"]',
      inner: '[data-driver-id="other-row"]',
    });
  });
});
