import { useData, type Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h, onMounted, watch } from 'vue';
import { DocsVideo } from './docs-video';
import { EndLinks } from './end-links';
import './custom.css';

/**
 * VitePress's default theme with the site's top bar anchors: the nav bar takes the height,
 * wordmark and insets of the app's bars (custom.css) and ends in Feedback and GitHub, as the
 * landing's header and Explore's app bar do. The phone menu lists the same two links.
 */
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(EndLinks),
      'nav-screen-content-after': () => h(EndLinks, { labelled: true }),
    }),
  // The docs' animations, written <DocsVideo name="…" /> in the pages (docs-video.ts).
  enhanceApp({ app }) {
    app.component('DocsVideo', DocsVideo);
  },
  // VitePress marks dark with a class; the shared --ps-* tokens read data-theme. The head script
  // set it before first paint; from here it follows VitePress's mode, the OS's included.
  setup() {
    const { isDark } = useData();
    onMounted(() =>
      watch(
        isDark,
        (dark) => {
          document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        },
        { immediate: true },
      ),
    );
  },
} satisfies Theme;
