import { unsafeCSS } from 'lit';
import tokens from './tokens.css?raw';

/**
 * The design tokens as a Lit sheet. The values live in tokens.css, plain CSS that the landing page
 * and the docs import too, so the three share one palette. Read raw, not through the CSS
 * pipeline, so the sheet holds the file as written in builds and in tests alike.
 */
export const theme = unsafeCSS(tokens);
