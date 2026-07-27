# Installation

This guide covers setting up the ProtSpace monorepo locally, for developers who want to modify the
components or run the app from source.

::: tip Just Want to Use ProtSpace?
If you just want to visualize protein data, visit [protspace.app](https://protspace.app) - no
installation needed!
:::

::: warning No npm Package Yet
`@protspace/core` is not published to npm, so there is no `npm install` or CDN command to give you.
The package is at version `0.1.0` and lives in this repository as a pnpm workspace package. Until it
is published, the only supported way to use the components is to build them from a clone of the
monorepo.
:::

## Development Setup

```bash
# Clone the repository
git clone https://github.com/tsenoner/protspace.git
cd protspace

# Install dependencies for every workspace package
pnpm install

# Start the app and the docs site together
pnpm dev
```

`pnpm dev` runs both dev servers: the app at `http://localhost:8080` and these docs at
`http://localhost:5174/docs/`. Use `pnpm dev:app` or `pnpm dev:docs` to run just one.

Other commands you will need:

```bash
pnpm build       # Build all packages (output lands in packages/*/dist/)
pnpm test        # Run the unit tests
pnpm precommit   # Everything the Git hook runs: lint, type-check, knip, docs build
```

## Using the Components in the Workspace

Inside the monorepo, depend on the package through the workspace protocol rather than a version
range - this is how `apps/web` consumes it:

```json
{
  "dependencies": {
    "@protspace/core": "workspace:*",
    "@protspace/utils": "workspace:*"
  }
}
```

Then import the components for their side effect of registering the custom elements:

```javascript
import '@protspace/core';
```

This defines `protspace-scatterplot`, `protspace-legend`, `protspace-control-bar` and
`protspace-structure-viewer`, among others. See [Embedding Components](/developers/embedding) for
how to wire them together.

## Requirements

### Development Requirements

- Node.js 22+ (`.nvmrc` pins v22.13.1)
- pnpm 10.24.0+ (the root `package.json` sets `"packageManager": "pnpm@10.24.0"`)
- Git

### Browser Support

The scatterplot renders with WebGL2 and has no WebGL1 or Canvas 2D fallback - if a WebGL2 context
cannot be created, the plot does not render. The minimum browser versions are therefore the versions
that ship WebGL2 without a flag:

| Browser | Version |
| ------- | ------- |
| Chrome  | 56+     |
| Edge    | 79+     |
| Firefox | 51+     |
| Safari  | 15+     |

## Troubleshooting

### Dependencies fail to resolve

```bash
# Reinstall from a clean state
rm -rf node_modules
pnpm install
```

Make sure you are on Node 22 (`node --version`); the install can fail in confusing ways on older
runtimes.

### Components not rendering

Check the browser console for errors:

1. **WebGL2 not available**: update the browser or check graphics drivers
2. **Custom element undefined**: confirm `@protspace/core` was imported for its side effect
3. **Stale build output**: run `pnpm build` and check `packages/core/dist/`

## Next Steps

- [Embedding Components](/developers/embedding) - Integration patterns
- [API Reference](/developers/api/) - Component documentation
- [Contributing](/developers/contributing) - Development guide
