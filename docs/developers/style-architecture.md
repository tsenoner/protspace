# Style Architecture

ProtSpace uses a modular CSS architecture based on Lit's `css` tagged template literals and array composition for consistent, maintainable styling across components.

## Organization Rules

### When to Split Files

| Lines   | Pattern                           | Example                       |
| ------- | --------------------------------- | ----------------------------- |
| <150    | Single `.styles.ts` file          | `search`, `annotation-select` |
| 150-300 | Monolithic or add `responsive.ts` | `structure-viewer`            |
| 300+    | Modular `styles/` directory       | `control-bar`, `legend`       |

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

### Naming Convention

```
--[component-prefix]-[category]-[property]-[modifier?]
```

**Examples:**

```css
--legend-bg                     /* component background */
--legend-item-padding           /* element spacing */
--legend-text-secondary         /* semantic color */
```

### Rules

1. **Always reference tokens**: `--legend-bg: var(--surface)`
2. **Define in `:host` only** (or `theme.ts` if modular)
3. **Use only when**:
   - Runtime override needed, OR
   - Used 3+ times
4. **Group with comments**: `/* Layout */`, `/* Colors */`, `/* Sizing */`

### Component Prefixes

| Component        | Prefix                 |
| ---------------- | ---------------------- |
| Legend           | `--legend-*`           |
| Scatter-plot     | `--protspace-*`        |
| Structure-viewer | `--protspace-viewer-*` |
| Control-bar      | Uses tokens only       |

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
import { tokens } from '../../styles/tokens';
import { buttonMixin } from '../../styles/mixins';
import { themeStyles } from './styles/theme';
import { layoutStyles } from './styles/layout';
import { itemStyles } from './styles/item';
import { responsiveStyles } from './styles/responsive';

export const legendStyles = [
  tokens,
  buttonMixin,
  themeStyles,
  layoutStyles,
  itemStyles,
  responsiveStyles, // Always last
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

Study **control-bar** as the ideal modular pattern:

```typescript
// control-bar.styles.ts (35 lines)
export const controlBarStyles = [
  tokens,
  buttonMixin,
  inputMixin,
  dropdownMixin,
  layoutStyles,
  filterStyles,
  exportStyles,
  responsiveStyles, // Always last
];
```

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
| control-bar       | Modular      | ✅ Reference  |
| legend            | Modular      | ✅ Refactored |
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
| `interaction/`         | Pointer interaction controller and the quadtree hit-test index                                                                                          |
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
