import { observeTheme } from '../../../utils/theme-observer';
import { resolveColor } from '../webgl/color-utils';
import { LIGHT_NEUTRALS, sameNeutrals, type PlotNeutrals } from './plot-neutrals';

type Rgb = readonly [number, number, number];

const parentAcrossShadow = (node: Node): Node | null =>
  node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;

/**
 * The plot's themed values, read from computed style and kept until something that can restyle
 * them happens: the background, which the renderer takes as its knockout colour on every draw,
 * and the neutral greys (`--ps-plot-other`, `--ps-plot-na`) the style getters draw Other and
 * default-coloured N/A points with.
 *
 * Reading computed style forces a synchronous style recalculation whenever the document has
 * pending style changes, which a render that follows any DOM or class change has, so both are
 * cached. The background is dropped on anything that could restyle the host: attribute changes
 * (class, style, data-theme, ...) on the host or any ancestor across shadow boundaries, a
 * stylesheet or `<style>` added to or removed from `<head>`, a `prefers-color-scheme` flip, and
 * re-attachment to the document. Dropping it never asks for a render: the knockout has no
 * visible effect (`PREDICTED_INTERIOR_FILL` is 0).
 *
 * The greys follow the theme. On a theme change (`observeTheme`: `<html>`'s `data-theme`, `class`
 * or `style`, or the OS scheme) they are read again if they were read before, and `onChange`
 * runs once when either resolves to another value. Re-setting `data-theme` to its value, an OS
 * flip under an explicit theme, and attribute changes below `<html>` (the sidebar's slide) never
 * run it, which keeps a theme watcher from adding renders on load or while idle. Rules inserted
 * through the CSSOM (`insertRule`, `adoptedStyleSheets`) cannot be observed: an embedder that
 * restyles the plot that way touches an attribute of `<html>` (the greys) or of the plot (the
 * background) for the next draw to read the new values.
 */
export class PlotTheme {
  private _background: Rgb | null = null;
  private _neutrals: PlotNeutrals | null = null;
  private _observer: MutationObserver | null = null;
  private _scheme: MediaQueryList | null = null;
  /** The scheme the cached background was read under. */
  private _schemeDark = false;
  private _stopTheme: (() => void) | null = null;

  constructor(
    private readonly _host: HTMLElement,
    private readonly _onChange: () => void,
  ) {}

  /** The neutral greys: one computed-style read, the light greys where a token is unset. */
  neutrals(): PlotNeutrals {
    return (this._neutrals ??= this._readNeutrals());
  }

  /** The resolved background; read from computed style only when no valid value is cached. */
  background(): Rgb {
    // Mutations are delivered as a microtask; a read in the same task as the change must not
    // see the old colour.
    if (this._observer?.takeRecords().length) this._background = null;
    // Likewise a `prefers-color-scheme` flip, whose change event waits for the next frame.
    if (this._scheme && this._scheme.matches !== this._schemeDark) this._background = null;
    if (this._background) return this._background;
    const color = resolveColor(getComputedStyle(this._host).backgroundColor);
    // A detached host has no computed style to cache.
    if (this._host.isConnected) {
      this._background = color;
      this._schemeDark = this._scheme?.matches ?? false;
    }
    return color;
  }

  /** Start watching for restyles; call from `connectedCallback`. Idempotent. */
  connect(): void {
    this.disconnect();
    if (typeof MutationObserver !== 'undefined') {
      this._observer = new MutationObserver(this._invalidateBackground);
      for (let node: Node | null = this._host; node; node = parentAcrossShadow(node)) {
        if (node instanceof Element) this._observer.observe(node, { attributes: true });
      }
      const head = this._host.ownerDocument.head;
      if (head) this._observer.observe(head, { childList: true, subtree: true });
    }
    if (typeof matchMedia === 'function') {
      this._scheme = matchMedia('(prefers-color-scheme: dark)');
      this._scheme.addEventListener?.('change', this._invalidateBackground);
    }
    this._stopTheme = observeTheme(this._onTheme, this._host.ownerDocument);
    // A theme change while the plot was detached went unheard.
    this._onTheme();
  }

  /** Stop watching; call from `disconnectedCallback`. The greys stay, for `connect` to compare. */
  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._scheme?.removeEventListener?.('change', this._invalidateBackground);
    this._scheme = null;
    this._stopTheme?.();
    this._stopTheme = null;
    this._background = null;
  }

  private _invalidateBackground = () => {
    this._background = null;
  };

  private _onTheme = () => {
    this._background = null;
    const before = this._neutrals;
    if (!before) return;
    const after = this._readNeutrals();
    if (sameNeutrals(before, after)) return;
    this._neutrals = after;
    this._onChange();
  };

  private _readNeutrals(): PlotNeutrals {
    const style = getComputedStyle(this._host);
    const read = {
      other: style.getPropertyValue('--ps-plot-other').trim() || LIGHT_NEUTRALS.other,
      na: style.getPropertyValue('--ps-plot-na').trim() || LIGHT_NEUTRALS.na,
    };
    // The light greys by identity, so exportGetters' sameNeutrals check (once per point per
    // getter during an export) takes its `a === b` fast path.
    return sameNeutrals(read, LIGHT_NEUTRALS) ? LIGHT_NEUTRALS : read;
  }
}
