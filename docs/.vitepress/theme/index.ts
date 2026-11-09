import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
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
} satisfies Theme;
