import type { Locator } from '@playwright/test';
import type { Clip } from '../capture-plan';

/**
 * The smallest viewport rectangle holding every locator's box, grown by `pad` on each side and
 * clamped to the viewport: a menu crop holds its trigger and the open menu. Throws when a locator
 * has no box (hidden or detached), so a crop never silently shrinks to what happened to show.
 */
export async function around(locators: readonly Locator[], pad = 12): Promise<Clip> {
  if (locators.length === 0) throw new Error('around() needs at least one locator');
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [index, locator] of locators.entries()) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`around(): locator ${index} has no box (hidden or detached)`);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  const viewport = locators[0].page().viewportSize();
  if (!viewport) throw new Error('around(): the page has no fixed viewport');
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  const width = Math.min(viewport.width, Math.ceil(right + pad)) - x;
  const height = Math.min(viewport.height, Math.ceil(bottom + pad)) - y;
  return { x, y, width, height };
}
