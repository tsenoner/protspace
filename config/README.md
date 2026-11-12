# Centralized Configuration

Single source of truth for all URLs, ports, navigation, and environment settings.

## Structure

### URLs Configuration (`urls.ts`)

```typescript
PORTS = { app: 8080, docs: 5174 }
PRODUCTION_DOMAIN = 'https://protspace.app'
URLS = { production: {...}, development: {...} }
```

### Navigation Configuration (`navigation.ts`)

```typescript
getNavigation(mode); // Returns all navigation items
```

### Top bar geometry (`site-bar.css`)

The height of the top bar, the wordmark's size and inset, and the inset and size of the icon
buttons the bar ends with (Theme, Feedback, then GitHub), as CSS custom properties. The landing's header
(`apps/web/src/components/Header.tsx`), Explore's app bar (`apps/web/src/workbench/workbench.css`)
and the docs' nav (`docs/.vitepress/theme/custom.css`) all read them, so the wordmark and the
icons stay on the same lines when switching pages.

### Theme (`theme.ts`)

The theme choice Home, Explore and the docs share: its storage key (VitePress's own,
`vitepress-theme-appearance`), the app's earlier key it migrates from, and the pre-paint script
that sets `<html data-theme>` on every page. `apps/web/index.html` holds a pinned copy of the
script; the docs' config puts it in their head.

## Usage

### URLs

```typescript
// VitePress config
import { getUrls } from '../../config/urls';
const urls = getUrls(mode);

// React app
import { getUrls } from '../../config/urls';
export const DOCS_URL = getUrls(mode).docs;
```

### Navigation

```typescript
// React app
import { getNavigation } from '../../config/navigation';
const navItems = getNavigation(mode);

// VitePress config
import { getNavigation } from '../../config/navigation';
const navItems = getNavigation(mode);
```

## Development Proxy

In development, the app server (`localhost:8080`) proxies `/docs` requests to the VitePress dev server (`localhost:5174`). This ensures that:

- Development and production use identical relative URLs (`/docs/`)
- No CORS issues when navigating between app and docs
- Simplified configuration (same URL structure in both environments)

The proxy is configured in `apps/web/vite.config.ts`.

## Note

The docs port (`5174`) appears in both `config/urls.ts` and `package.json` for simplicity - ports rarely change.
