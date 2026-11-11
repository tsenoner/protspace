import { useData } from 'vitepress';
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import {
  FEEDBACK_MENU_ITEMS,
  GITHUB_REPO_URL,
  runFeedbackAction,
  SUPPORT_EMAIL,
  type FeedbackAction,
} from '../../../apps/web/src/lib/support';

/**
 * The icon buttons the docs' nav bar ends with: the theme button, the Feedback menu, then GitHub,
 * the order and the icons of Explore's app bar and the landing's header, so the three end on the
 * same line. Lucide's paths, drawn as the app draws them (16 px, stroke 1.75). In the phone menu
 * (`labelled`) each also shows its name: Theme as a Light | Dark pair, and Feedback lists its
 * entries in place.
 */
const FEEDBACK_ICON = ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] as const;
const GITHUB_ICON = [
  'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
  'M9 18c-4.51 2-5-2-7-2',
] as const;

/**
 * The theme button, Explore's (apps/web/src/workbench/ThemeToggle.tsx): one icon button that flips
 * between light and dark, its icon the mode on screen. It stands where VitePress's slider stood,
 * before Feedback and GitHub; custom.css hides the slider. VitePress's isDark keeps the choice
 * under the key the app shares (config/theme.ts), and stores 'auto' when the pick matches the OS,
 * so a press back to the OS's mode follows the system again, as in the app.
 */
const THEME_LABELS = { light: 'Light', dark: 'Dark' } as const;
/** Lucide's sun and moon, as Explore's kit draws them. */
const SUN = [
  'M12 2v2',
  'M12 20v2',
  'm4.93 4.93 1.41 1.41',
  'm17.66 17.66 1.41 1.41',
  'M2 12h2',
  'M20 12h2',
  'm6.34 17.66-1.41 1.41',
  'm19.07 4.93-1.41 1.41',
] as const;
const MOON = ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'] as const;

const ThemeButton = defineComponent({
  name: 'ThemeButton',
  setup() {
    const { isDark } = useData();
    // The static HTML cannot know the mode: both icons render and CSS shows one (html.dark), and
    // the name waits for the mount, so the first client render matches the server's.
    const mounted = ref(false);
    onMounted(() => (mounted.value = true));
    const toggle = () => {
      isDark.value = !isDark.value;
    };
    return () => {
      const mode = isDark.value ? 'dark' : 'light';
      const other = isDark.value ? 'light' : 'dark';
      const label = mounted.value
        ? `Theme: ${THEME_LABELS[mode]}. Switch to ${THEME_LABELS[other]}`
        : 'Theme';
      return h(
        'button',
        {
          type: 'button',
          class: 'site-end-link site-theme-button',
          onClick: toggle,
          'aria-label': label,
          title: label,
        },
        [icon(SUN, 4, 'site-theme-sun'), icon(MOON, 0, 'site-theme-moon')],
      );
    };
  },
});

/**
 * The phone menu's Theme row: Light and Dark as a pair, the mode on screen pressed, as Home's
 * phone menu and Explore's More sheet have it. Picking the OS's own mode follows the system again
 * (VitePress's isDark stores 'auto' then). Neither is pressed until the mount, when the mode is
 * known.
 */
const ThemeChoice = defineComponent({
  name: 'ThemeChoice',
  setup() {
    const { isDark } = useData();
    const mounted = ref(false);
    onMounted(() => (mounted.value = true));
    return () =>
      h('div', { class: 'site-theme-choice' }, [
        h('span', { class: 'site-theme-choice-name', 'aria-hidden': 'true' }, [
          icon(SUN, 4, 'site-theme-sun'),
          icon(MOON, 0, 'site-theme-moon'),
          'Theme',
        ]),
        h(
          'div',
          { role: 'group', 'aria-label': 'Theme', class: 'site-theme-segments' },
          (['light', 'dark'] as const).map((value) =>
            h(
              'button',
              {
                type: 'button',
                class: 'site-theme-segment',
                'aria-pressed': String(mounted.value && isDark.value === (value === 'dark')),
                onClick: () => {
                  isDark.value = value === 'dark';
                },
              },
              THEME_LABELS[value],
            ),
          ),
        ),
      ]);
  },
});

const icon = (paths: readonly string[], sunRadius = 0, className?: string) =>
  h(
    'svg',
    {
      class: className,
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

/** What a copy shows in place of its entry for a moment: the docs have no toasts. */
function useCopyNote() {
  const note = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (copied: boolean) => {
    note.value = copied ? `Copied ${SUPPORT_EMAIL}` : 'Could not copy';
    clearTimeout(timer);
    timer = setTimeout(() => (note.value = ''), 2000);
  };
  onBeforeUnmount(() => clearTimeout(timer));
  return { note, show };
}

/**
 * The Feedback menu, Explore's and Home's entries (FEEDBACK_MENU_ITEMS): email, the address to
 * copy, and a GitHub issue. A menu button in the bar: a click, Enter or Space opens it with focus
 * on the first entry; the arrows, Home and End move; Escape, Tab or a click outside closes it. In
 * the phone menu the entries are rows of their own.
 */
const FeedbackMenu = defineComponent({
  name: 'FeedbackMenu',
  props: { labelled: Boolean },
  setup(props) {
    const open = ref(false);
    const button = ref<HTMLButtonElement | null>(null);
    const menu = ref<HTMLElement | null>(null);
    const { note, show } = useCopyNote();
    const entries = () => [
      ...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];

    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.value?.contains(target) && !button.value?.contains(target)) open.value = false;
    };
    onMounted(() => document.addEventListener('pointerdown', onOutside));
    onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));

    const toggle = async () => {
      open.value = !open.value;
      if (!open.value) return;
      await nextTick();
      entries()[0]?.focus();
    };
    const choose = (action: FeedbackAction) => {
      if (action !== 'copy') open.value = false;
      runFeedbackAction(action, show);
    };
    const onKey = (event: KeyboardEvent) => {
      const items = entries();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const move = (index: number) => items[(index + items.length) % items.length]?.focus();
      if (event.key === 'ArrowDown') move(at + 1);
      else if (event.key === 'ArrowUp') move(at - 1);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(items.length - 1);
      else if (event.key === 'Escape') {
        open.value = false;
        button.value?.focus();
      } else if (event.key === 'Tab') open.value = false;
      else return;
      if (event.key !== 'Tab') event.preventDefault();
    };

    const entryLabel = (value: FeedbackAction, label: string) =>
      value === 'copy' && note.value ? note.value : label;

    return () => {
      if (props.labelled)
        return h('div', { class: 'site-feedback-rows' }, [
          h('span', { class: 'site-feedback-heading' }, [icon(FEEDBACK_ICON), 'Feedback']),
          ...FEEDBACK_MENU_ITEMS.map(({ value, label }) =>
            h(
              'button',
              { type: 'button', class: 'site-end-link', onClick: () => choose(value) },
              entryLabel(value, label),
            ),
          ),
        ]);
      return h('div', { class: 'site-feedback' }, [
        h(
          'button',
          {
            ref: button,
            type: 'button',
            class: 'site-end-link',
            'aria-label': 'Feedback',
            title: 'Feedback',
            'aria-haspopup': 'menu',
            'aria-expanded': String(open.value),
            onClick: toggle,
          },
          [icon(FEEDBACK_ICON)],
        ),
        open.value
          ? h(
              'div',
              {
                ref: menu,
                role: 'menu',
                'aria-label': 'Feedback',
                class: 'site-feedback-menu',
                onKeydown: onKey,
              },
              FEEDBACK_MENU_ITEMS.map(({ value, label }) =>
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    tabindex: -1,
                    class: 'site-feedback-item',
                    onClick: () => choose(value),
                  },
                  entryLabel(value, label),
                ),
              ),
            )
          : null,
      ]);
    };
  },
});

const GitHubLink = defineComponent({
  name: 'GitHubLink',
  props: { labelled: Boolean },
  setup(props) {
    return () =>
      h(
        'a',
        {
          class: 'site-end-link',
          href: GITHUB_REPO_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
          // Icon only in the bar: the name is the label, and the native tooltip for the eye.
          ...(props.labelled ? {} : { 'aria-label': 'GitHub', title: 'GitHub' }),
        },
        [icon(GITHUB_ICON), props.labelled ? h('span', 'GitHub') : null],
      );
  },
});

export const EndLinks = defineComponent({
  name: 'EndLinks',
  props: { labelled: { type: Boolean as PropType<boolean>, default: false } },
  setup(props) {
    return () =>
      h('div', { class: ['site-end-links', { labelled: props.labelled }] }, [
        props.labelled ? h(ThemeChoice) : h(ThemeButton),
        h(FeedbackMenu, { labelled: props.labelled }),
        h(GitHubLink, { labelled: props.labelled }),
      ]);
  },
});
