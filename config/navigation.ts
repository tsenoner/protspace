/**
 * Shared navigation configuration for ProtSpace
 *
 * Single source of truth for all navigation items across the app and docs.
 * This ensures consistent navigation structure in both React app and VitePress docs.
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
  /** Target attribute for external links */
  target?: string;
  /** Icon identifier (optional, for custom rendering) */
  icon?: string;
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
    {
      text: 'GitHub',
      link: 'https://github.com/tsenoner/protspace',
      internal: false,
      target: '_blank',
      icon: 'github',
    },
  ];
};
