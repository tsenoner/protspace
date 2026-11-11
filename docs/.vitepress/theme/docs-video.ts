import { defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { isAutoplayRefusal } from './autoplay';

/**
 * `<DocsVideo name="zoom" alt="…" width="1280" height="720" />`: a docs animation, the looping,
 * muted video `pnpm docs:videos` writes to docs/explore/images/ (scripts/docs-screenshots/video.ts):
 * `<name>.webm`, `<name>.mp4` and the poster `<name>.jpg`, with the `-dark` twins.
 *
 * Both themes render, as `.light-only` and `.dark-only`, so the head rule in config.mts shows the
 * one matching the docs' mode, the manual toggle included (a `<source media>` would follow only
 * the OS). Neither loads up front: a video takes its poster when it nears the viewport and plays
 * while it is on screen, so the hidden twin, which never intersects, is never fetched. Under
 * reduced motion it never autoplays: the poster shows, with controls to play it. If the browser
 * refuses to autoplay (a phone's power saving), the controls show too.
 *
 * The files resolve through Vite, so the build fingerprints them under the docs' base URL. The lint
 * (scripts/docs-screenshots/docs-lint.ts) checks the name, the alt text and that width and height
 * are the video's frame size, which reserve its box before it loads.
 */
const MEDIA = import.meta.glob('../../explore/images/**/*.{webm,mp4,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const media = (stem: string, extension: 'webm' | 'mp4' | 'jpg'): string | undefined =>
  MEDIA[`../../explore/images/${stem}.${extension}`];

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/** Starts loading the poster and playing a little before the video scrolls into view. */
const NEAR_VIEWPORT = '200px 0px';

export const DocsVideo = defineComponent({
  name: 'DocsVideo',
  props: {
    name: { type: String, required: true },
    alt: { type: String, required: true },
    width: { type: [String, Number], required: true },
    height: { type: [String, Number], required: true },
  },
  setup(props) {
    const elements: Partial<Record<Theme, HTMLVideoElement>> = {};
    /** Near the viewport once: from then on the poster is set. */
    const near = reactive<Record<Theme, boolean>>({ light: false, dark: false });
    const onScreen = new Set<HTMLVideoElement>();
    const reducedMotion = ref(false);
    /** The browser refused to autoplay: show the controls instead. */
    const blocked = ref(false);
    let observer: IntersectionObserver | undefined;
    let motion: MediaQueryList | undefined;

    const play = (video: HTMLVideoElement) => {
      if (reducedMotion.value) return;
      // Autoplay needs the muted property, not only the attribute.
      video.muted = true;
      video.play().catch((error: unknown) => {
        // Only a refusal: a pause() before the load finished (a quick scroll past) aborts the play.
        if (isAutoplayRefusal(error)) blocked.value = true;
      });
    };
    const onMotionChange = () => {
      reducedMotion.value = motion?.matches ?? false;
      for (const video of onScreen) {
        if (reducedMotion.value) video.pause();
        else play(video);
      }
    };

    onMounted(() => {
      motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion.value = motion.matches;
      motion.addEventListener('change', onMotionChange);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            const theme = video.dataset.mode as Theme;
            if (entry.isIntersecting) {
              near[theme] = true;
              onScreen.add(video);
              play(video);
            } else {
              onScreen.delete(video);
              video.pause();
            }
          }
        },
        { rootMargin: NEAR_VIEWPORT },
      );
      for (const theme of THEMES) {
        const video = elements[theme];
        if (video) observer.observe(video);
      }
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      motion?.removeEventListener('change', onMotionChange);
    });

    return () =>
      h(
        'div',
        { class: 'docs-video' },
        THEMES.map((theme) => {
          const stem = theme === 'dark' ? `${props.name}-dark` : props.name;
          const webm = media(stem, 'webm');
          const mp4 = media(stem, 'mp4');
          return h(
            'video',
            {
              key: theme,
              ref: (element: unknown) => {
                if (element instanceof HTMLVideoElement) elements[theme] = element;
              },
              class: theme === 'dark' ? 'dark-only' : 'light-only',
              'data-mode': theme,
              width: props.width,
              height: props.height,
              style: { aspectRatio: `${props.width} / ${props.height}` },
              poster: near[theme] ? media(stem, 'jpg') : undefined,
              preload: 'none',
              muted: true,
              loop: true,
              playsinline: true,
              controls: reducedMotion.value || blocked.value,
              'aria-label': props.alt,
            },
            [
              webm && h('source', { src: webm, type: 'video/webm' }),
              mp4 && h('source', { src: mp4, type: 'video/mp4' }),
            ],
          );
        }),
      );
  },
});
