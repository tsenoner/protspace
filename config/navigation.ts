/**
 * Shared navigation configuration for ProtSpace
 *
 * Single source of truth for the text navigation across the app and docs. The icon links every
 * top bar ends with (Feedback, then GitHub) are not navigation: each bar renders them itself, in
 * the same order and boxes (config/site-bar.css).
 */
import { getUrls, type Environment } from './urls';
import { PUBLICATION_WEB, PUBLICATION_JMB, doiUrl } from './citations';

interface NavItem {
  text: string;
  link?: string;
  /**
   * Whether this link is internal (uses React Router) or external (uses <a> tag). Internal links
   * are app-relative paths, so they stay on whatever origin and port the app is served from.
   */
  internal?: boolean;
  /** Dropdown items for navigation groups */
  items?: Array<{ text: string; link: string }>;
}

/**
 * Get navigation items for the specified environment
 */
export const getNavigation = (mode: Environment): NavItem[] => {
  const urls = getUrls(mode);

  return [
    {
      text: 'Home',
      link: '/',
      internal: true,
    },
    {
      text: 'Docs',
      link: urls.docs,
      internal: false, // Cross-app navigation
    },
    {
      text: 'Explore',
      link: urls.explore,
      internal: true,
    },
    {
      text: 'Resources',
      items: [
        { text: 'Python Package', link: 'https://pypi.org/project/protspace/' },
        { text: 'Latest publication (bioRxiv)', link: doiUrl(PUBLICATION_WEB.doi) },
        { text: 'Original publication (JMB)', link: doiUrl(PUBLICATION_JMB.doi) },
      ],
    },
  ];
};
