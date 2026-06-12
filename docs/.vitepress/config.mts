import { defineConfig } from 'vitepress';
import { getUrls } from '../../config/urls';
import { getNavigation } from '../../config/navigation';

const isDev = process.env.NODE_ENV !== 'production';
const mode = isDev ? 'development' : 'production';
const urls = getUrls(mode);
const navItems = getNavigation(mode);

export default defineConfig({
  title: 'ProtSpace',
  description: 'Interactive visualization for protein language model embeddings',

  base: urls.docs,

  // Internal planning/spec notes — not part of the user-facing docs site.
  srcExclude: ['superpowers/**'],

  head: [['link', { rel: 'icon', href: '/docs/favicon.svg' }]],

  themeConfig: {
    logo: {
      light: '/wordmark.svg',
      dark: '/wordmark-black.svg',
      alt: 'ProtSpace',
    },
    siteTitle: false,

    nav: navItems
      .filter((item) => item.icon !== 'github') // Exclude GitHub icon (it's in socialLinks)
      .map((item) => {
        // When in VitePress (base is /docs/), map "Docs" link to root '/'
        // to avoid /docs/docs/ issue
        const link = item.text === 'Docs' ? '/' : item.link || '';

        // Handle items with dropdown menus
        if (item.items) {
          return {
            text: item.text,
            items: item.items.map((subItem) => ({
              text: subItem.text,
              link: subItem.link,
              target: subItem.link.startsWith('http') ? '_blank' : undefined,
            })),
          };
        }

        return {
          text: item.text,
          link,
          ...(item.link && item.text !== 'Docs' && { target: '_self' }), // Only set target for non-Docs items
        };
      }),

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Quick Start', link: '/' },
          { text: 'What is ProtSpace?', link: '/guide/' },
        ],
      },
      {
        text: 'Preparing Your Data',
        items: [
          { text: 'Using Google Colab', link: '/guide/data-preparation' },
          { text: 'Using Python CLI', link: '/guide/python-cli' },
          { text: 'Data Format Reference', link: '/guide/data-format' },
        ],
      },
      {
        text: 'Using the Explore Page',
        items: [
          { text: 'Interface Overview', link: '/explore/' },
          { text: 'Importing Data', link: '/explore/importing-data' },
          { text: 'Navigating the Scatterplot', link: '/explore/scatterplot' },
          { text: 'Using the Legend', link: '/explore/legend' },
          { text: 'Control Bar Features', link: '/explore/control-bar' },
          { text: 'Viewing 3D Structures', link: '/explore/structures' },
          { text: 'Exporting Results', link: '/explore/exporting' },
          { text: 'Figure Editor', link: '/explore/figure-editor' },
        ],
      },
      {
        text: 'Help',
        items: [{ text: 'FAQ', link: '/guide/faq' }],
      },
      // Developer docs hidden until npm package is published
      // {
      //   text: 'For Developers',
      //   collapsed: true,
      //   items: [
      //     { text: 'Installation', link: '/developers/installation' },
      //     { text: 'Architecture', link: '/developers/architecture' },
      //     { text: 'Style Architecture', link: '/developers/style-architecture' },
      //     { text: 'Embedding Components', link: '/developers/embedding' },
      //     { text: 'API Reference', link: '/developers/api/' },
      //     { text: 'Contributing', link: '/developers/contributing' },
      //   ],
      // },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/tsenoner/protspace_web' }],

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2025 Rostlab, TU Munich',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/tsenoner/protspace_web/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
