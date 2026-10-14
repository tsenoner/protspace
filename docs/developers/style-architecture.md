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

New styles read `--ps-*` tokens (see Custom Properties) and do not compose the legacy `tokens`,
`buttonMixin` or `overlayMixins`; only modules in `LEGACY` still use them, in the older order
`tokens`, mixins, `themeStyles`, features, `responsiveStyles`.

## Responsive Design

### Breakpoints

Defined in `tokens.ts`:

```css
--breakpoint-xs: 550px; /* Mobile */
--breakpoint-sm: 600px; /* Small tablets */
--breakpoint-md: 800px; /* Tablets */
--breakpoint-lg: 950px; /* Small desktop */
--breakpoint-xl: 1200px; /* Desktop */
--breakpoint-2xl: 1450px; /* Large desktop */
```

### Media Query Rules

- **Modular components**: a media query sits in the module whose rules it adapts (for example
  `@media (pointer: coarse)` in the legend's `row.ts`), after that module's other rules
- **Monolithic components**: All `@media` at end of file
- **Always add breakpoint comments**:

```css
@media (max-width: 950px) {
  /* --breakpoint-lg */
  :host {
    max-width: unset;
  }
}
```

## Custom Properties

### Design tokens

Colours, font sizes, spacing, radii, shadows and durations are `--ps-*` tokens, declared only in
`packages/core/src/styles/theme.ts` (light values on `:root`, dark values under
`[data-theme='dark']`, and under `[data-theme='system']` while the OS prefers dark, so a
`system` page follows the OS live). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.
A `LEGACY` module may still read a non-colour alias from `tokens.ts` (spacing, type, z-index), but
no colour: `tokens.ts` declares none, and the lint fails a legacy module that hard-codes one or
reads an alias nothing declares. The web app's `workbench.css` and `tour/product-tour.css` are
held to the colour rule too.

The scatter plot reads three tokens for what it draws: `--ps-plot-bg` (its background),
`--ps-plot-other` (Other points) and `--ps-plot-na` (N/A points whose colour is the default
`#DDDDDD`; a picked N/A colour is kept). Their light values are the data's own colours. When a
theme change gives either grey a new value, the plot restyles its points once, colour only;
anything else (re-setting `data-theme`, an OS flip under an explicit theme) redraws nothing.
Exports always draw the light values on white.

### Component properties

Older components still expose custom properties of their own:

```
--[component-prefix]-[category]-[property]-[modifier?]
```

**Examples:**

```css
--protspace-height              /* element sizing */
--protspace-viewer-height       /* element sizing */
```

Rules for these:

1. **Sizes only**: colours come from the `--ps-*` tokens, so a component property never holds a
   colour (`--protspace-viewer-height: 100%`)
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Group with comments**: `/* Layout */`, `/* Sizing */`

The scatter plot no longer has colour properties: its background, border, brush and lasso, the
overlay chips, EAT connectors and spiderfy marks, the protein tooltip and the projection card
read `--ps-*` tokens (`--ps-plot-bg`, `--ps-accent`, `--ps-surface-raised`, `--ps-plot-connector`,
`--ps-eat`, `--ps-eat-endpoint` and the role colours), so setting those on `:root` restyles it in
both themes. A host-declared colour property would block the theme, so none is offered. Its
remaining `--protspace-*` properties are sizes, opacities and timings.

The structure viewer's colour properties (`--protspace-viewer-bg`, `-border`, `-header-bg`,
`-text`, `-text-muted`, `-error`, `-loading`) are gone too: its frame, header, footer, loading veil
and colour-mode control read the tokens, and the Mol\* canvas takes `--ps-surface` as its
background, set again whenever a theme change gives that token another value. Its
`--protspace-viewer-width`, `-height` and `-border-radius` stay.

### Component Prefixes

| Component            | Prefix                              |
| -------------------- | ----------------------------------- |
| Legend               | `--ps-*` tokens only                |
| Scatter-plot         | `--protspace-*` (sizes only)        |
| Structure-viewer     | `--protspace-viewer-*` (sizes only) |
| Kit and new elements | `--ps-*` tokens only                |

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
import { tokens } from '../../styles/tokens';

const searchStylesCore = css`
  :host {
    /* ... */
  }
  .search-input {
    /* ... */
  }
`;

export const searchStyles = [tokens, searchStylesCore];
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
- [ ] Read only `--ps-*` tokens; remove the module from `LEGACY` in `style-lint.test.ts`
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

Host-level CSS stays in the 183-line `scatter-plot.styles.ts`, which is inside the 150–300 band
above. The sub-components that render their own shadow DOM (`tooltips/`, `projection-metadata/`)
each ship their own co-located `.styles.ts`, so no single stylesheet grows large enough to need a
`styles/` directory.

---

See implementations in `/packages/core/src/components/` and the `--ps-*` tokens in `/packages/core/src/styles/theme.ts`.
