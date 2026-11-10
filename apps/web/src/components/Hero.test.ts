import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Hero from './Hero';

describe('Hero', () => {
  it('reserves the wordmark box before the SVG loads, so the heading below it does not jump', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Hero)));
    const wordmark = /<img[^>]*id="hero-wordmark"[^>]*>/.exec(markup)?.[0] ?? '';

    // wordmark.svg's viewBox is 0 0 870 190: the attributes give the browser its aspect ratio,
    // and the CSS width then sets its height before the file arrives.
    expect(wordmark).toContain('width="870"');
    expect(wordmark).toContain('height="190"');
  });
});
