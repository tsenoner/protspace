import { css } from 'lit';

/**
 * The design tokens: the only place in core with literal colours, sizes and durations.
 * Components read these custom properties and never declare them on :host, which would block the
 * page's theme. Core adopts this sheet into the document (components/kit/adopt-theme.ts), and
 * custom properties inherit into every shadow root. Role colours come from the slate and sky ramps
 * named in the comments; the ramps are not variables, so every variable here has a user
 * (style-lint.test.ts checks this).
 *
 * Light values sit on :root. Dark values apply under [data-theme='dark'], and under
 * [data-theme='system'] when the OS prefers dark. Until the theme switch lands nothing sets
 * data-theme, so pages stay light. All of it sits in the `ps-theme` cascade layer, so any
 * unlayered page rule, even `:root { --ps-accent: … }`, overrides a token in both themes.
 */

const lightRoles = css`
  --ps-surface: #ffffff;
  --ps-surface-muted: #f8fafc; /* slate-50 */
  --ps-surface-raised: #ffffff;
  --ps-surface-hover: #f1f5f9; /* slate-100 */
  --ps-border: #e2e8f0; /* slate-200 */
  --ps-border-strong: #cbd5e1; /* slate-300 */
  --ps-text: #0f172a; /* slate-900 */
  --ps-text-muted: #475569; /* slate-600 */
  --ps-text-faint: #94a3b8; /* slate-400, 2.6:1 on white: disabled text and decorative icons only */
  --ps-text-on-accent: #ffffff;
  --ps-accent: #007ab5; /* brand cyan #00a3e0 deepened: 4.7:1 under white text */
  --ps-accent-hover: #00699c;
  --ps-accent-text: #0369a1; /* sky-700, 5.9:1 on white */
  --ps-accent-tint: #e0f2fe; /* sky-100 */
  --ps-focus: #0284c7; /* sky-600, 4.1:1 on white; non-text needs 3:1 */
  --ps-danger: #dc2626; /* red-600 */
  --ps-warning: #b45309; /* amber-700 */
  --ps-success: #15803d; /* green-700 */
  --ps-tooltip-bg: #0f172a;
  --ps-tooltip-text: #f8fafc;
  --ps-scrim: rgb(15 23 42 / 0.45);
  --ps-shadow-sm: 0 1px 2px rgb(15 23 42 / 0.06);
  --ps-shadow-md: 0 4px 12px -2px rgb(15 23 42 / 0.12);
  --ps-shadow-lg: 0 12px 32px -12px rgb(15 23 42 / 0.24), 0 2px 6px rgb(15 23 42 / 0.06);
`;

const darkRoles = css`
  --ps-surface: #0f172a; /* slate-900 */
  --ps-surface-muted: #131d33;
  --ps-surface-raised: #162036;
  --ps-surface-hover: #1e293b; /* slate-800 */
  --ps-border: #1e293b;
  --ps-border-strong: #334155; /* slate-700 */
  --ps-text: #f1f5f9; /* slate-100 */
  --ps-text-muted: #94a3b8; /* slate-400 */
  --ps-text-faint: #64748b; /* slate-500, 3.8:1 on the surface: disabled text and decorative icons only */
  --ps-text-on-accent: #04121c;
  --ps-accent: #38bdf8; /* sky-400, 8.3:1 on the dark surface */
  --ps-accent-hover: #7dd3fc; /* sky-300 */
  --ps-accent-text: #38bdf8;
  --ps-accent-tint: rgb(56 189 248 / 0.16);
  --ps-focus: #38bdf8;
  --ps-danger: #f87171; /* red-400 */
  --ps-warning: #fbbf24; /* amber-400 */
  --ps-success: #4ade80; /* green-400 */
  --ps-tooltip-bg: #e2e8f0;
  --ps-tooltip-text: #0f172a;
  --ps-scrim: rgb(2 6 23 / 0.65);
  --ps-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);
  --ps-shadow-md: 0 6px 16px -4px rgb(0 0 0 / 0.6);
  --ps-shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.75), 0 0 0 1px #24324a;
`;

const sizes = css`
  --ps-font-sans:
    'Inter Variable', 'Inter Fallback', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ps-text-xs: 11px;
  --ps-text-sm: 12px;
  --ps-text-base: 13px;
  --ps-text-md: 14px;
  --ps-text-lg: 16px;
  --ps-text-xl: 20px;
  --ps-weight-medium: 500;
  --ps-weight-semibold: 600;
  --ps-leading-tight: 1.25;
  --ps-leading-normal: 1.45;
  --ps-space-0-5: 2px;
  --ps-space-1: 4px;
  --ps-space-1-5: 6px;
  --ps-space-2: 8px;
  --ps-space-3: 12px;
  --ps-space-5: 20px;
  --ps-space-6: 24px;
  --ps-radius-sm: 4px;
  --ps-radius: 6px;
  --ps-radius-lg: 10px;
  --ps-radius-full: 9999px;
  --ps-control-sm: 28px;
  --ps-control-md: 32px;
  --ps-row: 28px;
  --ps-touch-target: 40px;
  --ps-focus-width: 2px;
  --ps-focus-offset: 2px;
  --ps-duration-fast: 120ms;
  --ps-ease: cubic-bezier(0.2, 0, 0, 1);
`;

export const theme = css`
  @layer ps-theme {
    :root {
      color-scheme: light;
      ${lightRoles}
      ${sizes}
    }
    :root[data-theme='dark'] {
      color-scheme: dark;
      ${darkRoles}
    }
    @media (prefers-color-scheme: dark) {
      :root[data-theme='system'] {
        color-scheme: dark;
        ${darkRoles}
      }
    }
  }
`;
