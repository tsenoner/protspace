import { useData } from 'vitepress';
import { defineComponent, h, nextTick, onMounted, ref } from 'vue';
import { FEEDBACK_HREF, GITHUB_REPO_URL } from '../../../apps/web/src/lib/support';

/**
 * The icon buttons the docs' nav bar ends with: the theme button, Feedback, then GitHub, the order and the icons of
 * Explore's app bar and the landing's header, so the three end on the same line. Lucide's
 * message-square and github paths, drawn as the app draws them (16 px, stroke 1.75). In the phone
 * menu (`labelled`) each link also shows its name.
 */
const END_LINKS = [
  {
    label: 'Feedback',
    href: FEEDBACK_HREF,
    paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    newTab: false,
  },
  {
    label: 'GitHub',
    href: GITHUB_REPO_URL,
    paths: [
      'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      'M9 18c-4.51 2-5-2-7-2',
    ],
    newTab: true,
  },
] as const;

/**
 * The theme button, Explore's (apps/web/src/workbench/ThemeToggle.tsx): one icon button that steps
 * System → Dark → Light, its icon the current choice. It stands where VitePress's slider stood,
 * before Feedback and GitHub; custom.css hides the slider. VitePress keeps the choice under its
 * own key ('auto' | 'dark' | 'light'), which its head script reads before the first paint.
 */
type ThemeChoice = 'auto' | 'dark' | 'light';
const APPEARANCE_KEY = 'vitepress-theme-appearance';
const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'dark', 'light'];
const THEME_LABELS: Record<ThemeChoice, string> = { auto: 'System', dark: 'Dark', light: 'Light' };
/** Lucide's sun-moon, moon and sun, as Explore's kit draws them. */
const THEME_ICONS: Record<ThemeChoice, readonly string[]> = {
  auto: [
    'M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4',
    'M12 2v2',
    'M12 20v2',
    'm4.9 4.9 1.4 1.4',
    'm17.7 17.7 1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'm6.3 17.7-1.4 1.4',
    'm19.1 4.9-1.4 1.4',
  ],
  dark: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  light: [
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
};

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

const ThemeButton = defineComponent({
  name: 'ThemeButton',
  props: { labelled: Boolean },
  setup(props) {
    const { isDark } = useData();
    // 'auto' on the server and until mount, so the first client render matches the static HTML.
    const choice = ref<ThemeChoice>('auto');
    onMounted(() => (choice.value = readChoice()));
    const cycle = async () => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(choice.value) + 1) % THEME_ORDER.length];
      choice.value = next;
      isDark.value =
        next === 'dark' ||
        (next === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      // VitePress stores 'auto' for a choice that matches the OS; keep the one picked, after its
      // own write.
      await nextTick();
      try {
        localStorage.setItem(APPEARANCE_KEY, next);
      } catch {
        // Storage blocked: the choice lasts for this page.
      }
    };
    return () => {
      const current = choice.value;
      const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
      const label = `Theme: ${THEME_LABELS[current]}. Switch to ${THEME_LABELS[next]}`;
      return h(
        'button',
        {
          type: 'button',
          class: 'site-end-link site-theme-button',
          onClick: cycle,
          ...(props.labelled ? {} : { 'aria-label': label, title: label }),
        },
        [
          icon(THEME_ICONS[current], current === 'light' ? 4 : 0),
          props.labelled ? h('span', `Theme: ${THEME_LABELS[current]}`) : null,
        ],
      );
    };
  },
});

const icon = (paths: readonly string[], sunRadius = 0) =>
  h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    [
      ...(sunRadius ? [h('circle', { cx: 12, cy: 12, r: sunRadius })] : []),
      ...paths.map((d) => h('path', { d })),
    ],
  );

export const EndLinks = defineComponent({
  name: 'EndLinks',
  props: { labelled: Boolean },
  setup(props) {
    return () =>
      h('div', { class: ['site-end-links', { labelled: props.labelled }] }, [
        h(ThemeButton, { labelled: props.labelled }),
        ...END_LINKS.map(({ label, href, paths, newTab }) =>
          h(
            'a',
            {
              class: 'site-end-link',
              href,
              // Icon only in the bar: the name is the label, and the native tooltip for the eye.
              ...(props.labelled ? {} : { 'aria-label': label, title: label }),
              ...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
            },
            [icon(paths), props.labelled ? h('span', label) : null],
          ),
        ),
      ]);
  },
});
