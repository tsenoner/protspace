# Style Architecture

ProtSpace uses a modular CSS architecture based on Lit's `css` tagged template literals and array composition for consistent, maintainable styling across components.

## Organization Rules

### When to Split Files

| Lines   | Pattern                     | Example                       |
| ------- | --------------------------- | ----------------------------- |
| <150    | Single `.styles.ts` file    | `search`, `annotation-select` |
| 150-300 | Monolithic                  | `structure-viewer`            |
| 300+    | Modular `styles/` directory | `legend`                      |

### Modular Structure

```
component-name/
├── component-name.styles.ts    # Composes the kit's shared sheets and the modules below; no rules
└── styles/
    ├── layout.ts               # The host and its frame
    └── [piece].ts              # One module per piece of the element (header, row, picker, ...)
```

A child element (a popover, a strip) has its own co-located `*.styles.ts` instead of a module here.

## Import Order

Shared sheets first, then the component's own modules, broad to specific, since a later sheet
wins a tie in specificity:

```typescript
export const componentStyles = [
  // 1. The kit's shared sheets (kit/kit-shared.styles.ts), only those needed
  kitHost, // host font and colour
  focusRing, // the one focus ring
  reducedMotion,
  srOnly,

  // 2. The component's modules: the frame, then its pieces
  layoutStyles,
  featureStyles,
];
```

Styles read `--ps-*` tokens (see Custom Properties). There are no alias sheets or style mixins to
compose: an element that renders its own text sets `font-family: var(--ps-font-sans)` on its
`:host`, or composes `kitHost`, which also sets the base size and colour.

## Responsive Design

### Breakpoints

Defined in `packages/core/src/utils/breakpoints.ts` (design decision 17), the values the web app's
layouts switch at:

| Constant                     | Value  | Layout                                                 |
| ---------------------------- | ------ | ------------------------------------------------------ |
| `PHONE_MAX_WIDTH`            | 640 px | phone at or below this width                           |
| `DESKTOP_MIN_WIDTH`          | 951 px | the desktop workbench at or above this width           |
| `LANDSCAPE_PHONE_MAX_HEIGHT` | 500 px | landscape phone at or below this height, below desktop |

A shadow-DOM stylesheet cannot see the workbench's `data-layout` attribute, so it uses the
module's ready-made queries: `PHONE_MEDIA`, `LANDSCAPE_PHONE_MEDIA` and `COMPACT_MEDIA` (either
phone layout).

```typescript
import { css, unsafeCSS } from 'lit';
import { PHONE_MEDIA } from '../../utils/breakpoints';

export const rowStyles = css`
  @media ${unsafeCSS(PHONE_MEDIA)} {
    /* phone */
  }
`;
```

### Media Query Rules

- **Modular components**: a media query sits in the module whose rules it adapts (for example
  `@media (pointer: coarse)` in the legend's `row.ts`), after that module's other rules
- **Monolithic components**: All `@media` at end of file
- **Always add breakpoint comments**, and build a width query from the constants rather than
  typing the number:

```typescript
import { css } from 'lit';
import { DESKTOP_MIN_WIDTH } from '../../utils/breakpoints';

export const layoutStyles = css`
  @media (max-width: ${DESKTOP_MIN_WIDTH - 1}px) {
    /* below DESKTOP_MIN_WIDTH */
    :host {
      max-width: unset;
    }
  }
`;
```

## Custom Properties

### Design tokens

Colours, font sizes, spacing, radii, shadows and durations are `--ps-*` tokens, declared only in
`packages/core/src/styles/theme.ts` (light values on `:root`, dark values under
`[data-theme='dark']`, and under `[data-theme='system']` while the OS prefers dark, so a
`system` page follows the OS live). Stylesheets read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` checks every core stylesheet, with no exemptions.
It fails one that hard-codes a colour or a font size, declares a `--ps-*` token, or reads a
variable that neither `theme.ts` nor the stylesheet itself declares. A module may read a
variable it declares itself (the scatter plot's `--protspace-height`, the projection card's
local `--card-gap`); the few values code sets at run time (`--protspace-tooltip-max-height`, the kit's
`--available-height`, …) are listed in the test. `z-index` values are plain numbers: there are no
layer tokens. The web app's `workbench.css` and `tour/product-tour.css` are held to the colour
rule too.

The scatter plot reads three tokens for what it draws: `--ps-plot-bg` (its background),
`--ps-plot-other` (Other points) and `--ps-plot-na` (N/A points whose colour is the default
`#DDDDDD`; a picked N/A colour is kept). Their light values are the data's own colours. When a
theme change gives either grey a new value, the plot restyles its points once, colour only;
anything else (re-setting `data-theme`, an OS flip under an explicit theme) redraws nothing.
Exports always draw the light values on white.

### Component properties

The scatter plot is the one element with custom properties an embedder can set, four sizes on
its `:host`:

| Property                         | Default | Sets                                       |
| -------------------------------- | ------- | ------------------------------------------ |
| `--protspace-width`              | `100%`  | the element's width                        |
| `--protspace-height`             | `600px` | the element's height                       |
| `--protspace-border-radius`      | `6px`   | its corner radius                          |
| `--protspace-brush-stroke-width` | `1px`   | the outline of the box and lasso selection |

Rules for a component property:

1. **Sizes only**: colours come from the `--ps-*` tokens, so a component property never holds a
   colour (`--protspace-height: 480px`)
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Name it** `--[component-prefix]-[property]`, and group it under a comment (`/* Layout */`)

The scatter plot has no colour properties: its background, border, brush and lasso, the overlay
chips, EAT connectors and spiderfy marks, the protein tooltip and the projection card read
`--ps-*` tokens (`--ps-plot-bg`, `--ps-accent`, `--ps-surface-raised`, `--ps-plot-connector`,
`--ps-eat`, `--ps-eat-endpoint` and the role colours), so setting those on `:root` restyles it in
both themes. A host-declared colour property would block the theme, so none is offered. Its point
size, opacity, stroke and transition properties, which nothing read, are gone as well.

The structure viewer has no properties of its own. Its frame, header, footer, loading veil and
colour-mode control read the tokens, and the Mol\* canvas takes `--ps-surface` as its background,
set again whenever a theme change gives that token another value. Its size comes from its host,
as the workbench's structure section and floating card set it.

### Component Prefixes

| Component            | Prefix                       |
| -------------------- | ---------------------------- |
| Legend               | `--ps-*` tokens only         |
| Scatter-plot         | `--protspace-*` (sizes only) |
| Structure-viewer     | `--ps-*` tokens only         |
| Kit and new elements | `--ps-*` tokens only         |

### Theming the legend

The legend reads `--ps-*` tokens only; its former legend-specific custom properties are gone.
To restyle it, set the `--ps-*` tokens on `:root`. The legend draws no card of its own (no border, radius
or shadow) and fills the height its container gives it, as the workbench sidebar does. An
embedder that wants a card adds one on the host:

```css
protspace-legend {
  height: 480px;
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
}
```

## Examples

### Simple Component

```typescript
// search.styles.ts
import { css } from 'lit';
import { focusRing, kitHost } from '../kit/kit-shared.styles';

const searchStylesCore = css`
  :host {
    display: block;
  }
  .search-input {
    font-size: var(--ps-text-base);
    color: var(--ps-text);
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius);
  }
`;

export const searchStyles = [kitHost, focusRing, searchStylesCore];
```

### Complex Component

```typescript
// legend.styles.ts
import { focusRing, kitHost, reducedMotion, srOnly } from '../kit/kit-shared.styles';
import { layoutStyles } from './styles/layout';
import { headerStyles } from './styles/header';
import { rowStyles } from './styles/row';
import { pickerStyles } from './styles/picker';
import { eatStyles } from './styles/eat';
import { stripStyles } from './styles/strips';

export const legendStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  srOnly,
  layoutStyles,
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];
```

## Best Practices

### DO ✓

- Keep a module to one piece of the element
- Use tokens for all values
- Add breakpoint comments to media queries
- Compose only the kit sheets you need
- Follow the import order above

### DON'T ✗

- Put a media query away from the rules it adapts
- Create custom properties for one-off values
- Duplicate styles between files
- Use hard-coded values
- Ignore import order

## Reference Implementation

Study **legend** as the modular pattern:

```typescript
// legend.styles.ts
export const legendStyles = [
  kitHost, // shared kit sheets first: host font and colour,
  focusRing, // the one focus ring,
  reducedMotion, // no motion when the user asked for less,
  srOnly, // the visually hidden class
  layoutStyles, // then one module per piece of the element
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];
```

The Other and settings popovers are child elements (`legend-other-popover.ts`,
`legend-settings-popover.ts`), each with its own `*.styles.ts`.

## Migration Checklist

When refactoring a component:

- [ ] Component >150 lines or has 3+ concerns?
- [ ] Create `styles/` directory if needed
- [ ] Extract the frame (`layout.ts`) and one module per piece to `styles/`
- [ ] Read only `--ps-*` tokens (`style-lint.test.ts` checks every stylesheet)
- [ ] Add breakpoint comments
- [ ] Compose the kit's shared sheets first, then the modules
- [ ] Test: `npm run dev`, verify visuals unchanged
- [ ] Run: `npm run test && npm run lint && npm run type-check`

## Component Status

| Component         | Organization | Status        |
| ----------------- | ------------ | ------------- |
| legend            | Modular      | ✅ Reference  |
| structure-viewer  | Monolithic   | ✅ Updated    |
| scatter-plot      | Per-feature  | ✅ Refactored |
| annotation-select | Monolithic   | ✓ Good as-is  |
| search            | Monolithic   | ✓ Good as-is  |

### scatter-plot

`scatter-plot` does not follow the `styles/` pattern because the component itself is split by
feature rather than by stylesheet. `packages/core/src/components/scatter-plot/` contains six
feature subdirectories:

| Directory              | Responsibility                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webgl/`               | WebGL2 rendering, shaders, GL resources, and `renderer/` (on-screen and offscreen export renderers, framebuffers, point staging, context-loss handling) |
| `interaction/`         | Pointer interaction controller and the uniform-grid point hit-test index                                                                                |
| `duplicate-stacks/`    | Duplicate-point detection, badge rendering, and the spiderfy overlay                                                                                    |
| `tooltips/`            | Protein tooltip and tips surfaces, plus positioning and height estimation                                                                               |
| `styling/`             | Style getters, the visibility model, and numeric re-binning                                                                                             |
| `projection-metadata/` | The projection metadata panel                                                                                                                           |

Host-level CSS stays in the 221-line `scatter-plot.styles.ts`, which is inside the 150–300 band
above. The sub-components that render their own shadow DOM (`tooltips/`, `projection-metadata/`)
each ship their own co-located `.styles.ts`, so no single stylesheet grows large enough to need a
`styles/` directory.

---

See implementations in `/packages/core/src/components/` and the `--ps-*` tokens in `/packages/core/src/styles/theme.ts`.
