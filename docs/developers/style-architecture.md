# Style Architecture

ProtSpace uses a modular CSS architecture based on Lit's `css` tagged template literals and array composition for consistent, maintainable styling across components.

## Organization Rules

### When to Split Files

| Lines   | Pattern                           | Example                       |
| ------- | --------------------------------- | ----------------------------- |
| <150    | Single `.styles.ts` file          | `search`, `annotation-select` |
| 150-300 | Monolithic or add `responsive.ts` | `structure-viewer`            |
| 300+    | Modular `styles/` directory       | `legend`                      |

### Modular Structure

```
component-name/
├── component-name.styles.ts    # Imports only
└── styles/
    ├── theme.ts                # CSS custom properties
    ├── layout.ts               # Structure, containers
    ├── [feature].ts            # Feature-specific styles
    └── responsive.ts           # Media queries (always last)
```

## Import Order

**Always follow this order** (CSS cascade depends on it):

```typescript
export const componentStyles = [
  // 1. Foundation
  tokens,

  // 2. Shared mixins (only what's needed)
  buttonMixin,
  dropdownMixin,
  overlayMixins,

  // 3. Component styles
  themeStyles,
  layoutStyles,
  featureStyles,

  // 4. Responsive (ALWAYS LAST)
  responsiveStyles,
];
```

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

- **Modular components**: All `@media` in `styles/responsive.ts` (imported last)
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
`[data-theme='dark']`). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.

### Component properties

Older components still expose custom properties of their own:

```
--[component-prefix]-[category]-[property]-[modifier?]
```

**Examples:**

```css
--protspace-bg-color            /* component background */
--protspace-viewer-height       /* element sizing */
```

Rules for these:

1. **Always reference tokens**: `--protspace-bg-color: var(--ps-surface)`
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Group with comments**: `/* Layout */`, `/* Colors */`, `/* Sizing */`

### Component Prefixes

| Component            | Prefix                 |
| -------------------- | ---------------------- |
| Legend               | `--ps-*` tokens only   |
| Scatter-plot         | `--protspace-*`        |
| Structure-viewer     | `--protspace-viewer-*` |
| Kit and new elements | `--ps-*` tokens only   |

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

- Keep files under 200 lines
- Use tokens for all values
- Add breakpoint comments to media queries
- Import only needed mixins
- Follow standard import order

### DON'T ✗

- Scatter media queries throughout files
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
- [ ] Extract theme, layout, features to separate files
- [ ] Move all media queries to end (or `responsive.ts`)
- [ ] Add breakpoint comments
- [ ] Update imports following standard order
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

See implementations in `/packages/core/src/components/` and central tokens in `/packages/core/src/styles/tokens.ts`.
