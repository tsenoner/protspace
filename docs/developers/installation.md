# Installation

This guide covers installing ProtSpace for developers who want to embed the components in their own applications.

::: tip Just Want to Use ProtSpace?
If you just want to visualize protein data, visit [protspace.app](https://protspace.app) - no installation needed!
:::

## NPM Package

::: danger Not yet published
These packages are **not on the npm registry** — every command in this section and
the next currently returns a 404. `@protspace/core` and `@protspace/utils` exist in
the repo and are ready to publish; `@protspace/react` has not been built yet.
Tracked in [#378](https://github.com/tsenoner/protspace/issues/378).

To embed the components today, consume them from a local checkout via the
workspace — see [Development Setup](#development-setup).
:::

Install the `@protspace/core` package to embed ProtSpace components in your project.

::: code-group

```bash [npm]
npm install @protspace/core
```

```bash [pnpm]
pnpm add @protspace/core
```

```bash [yarn]
yarn add @protspace/core
```

:::

Then import in your JavaScript/TypeScript:

```javascript
import '@protspace/core';
import {
  readFileOptimized,
  extractRowsFromParquetBundle,
  convertParquetToVisualizationDataOptimized,
} from '@protspace/core';
```

## CDN

Use directly from a CDN without installation:

```html
<script type="module" src="https://unpkg.com/@protspace/core"></script>
```

::: warning Version Pinning
For production use, pin to a specific version:

```html
<script type="module" src="https://unpkg.com/@protspace/core@<version>"></script>
```

:::

## Development Setup

To contribute or modify ProtSpace:

```bash
# Clone repository
git clone https://github.com/tsenoner/protspace.git
cd protspace

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The dev server runs at `http://localhost:8080`

## Requirements

### Browser Support

| Browser | Version |
| ------- | ------- |
| Chrome  | 80+     |
| Edge    | 80+     |
| Firefox | 75+     |
| Safari  | 13.1+   |

### Development Requirements

- Node.js 18+
- pnpm 8+

## Verifying Installation

After installing, verify the components are available:

```html
<!DOCTYPE html>
<html>
  <head>
    <script type="module">
      import '@protspace/core';

      window.addEventListener('DOMContentLoaded', () => {
        console.log('Scatterplot:', customElements.get('protspace-scatterplot'));
        console.log('Legend:', customElements.get('protspace-legend'));
        console.log('Control Bar:', customElements.get('protspace-control-bar'));
        console.log('Structure Viewer:', customElements.get('protspace-structure-viewer'));
      });
    </script>
  </head>
  <body>
    <protspace-scatterplot></protspace-scatterplot>
  </body>
</html>
```

If all four components are defined, the installation is successful.

## Troubleshooting

### Module not found

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Components not rendering

Check browser console for errors:

1. **Shadow DOM not supported**: Update browser
2. **WebGL not available**: Check graphics drivers
3. **Import path incorrect**: Verify import matches your setup

### TypeScript errors

Ensure `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Next Steps

- [Embedding Components](/developers/embedding) - Integration patterns
- [API Reference](/developers/api/) - Component documentation
- [Contributing](/developers/contributing) - Development guide
