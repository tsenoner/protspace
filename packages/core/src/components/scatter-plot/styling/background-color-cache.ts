import { resolveColor } from '../webgl/color-utils';

type Rgb = readonly [number, number, number];

/**
 * The plot's resolved background colour, read from computed style once and kept until something
 * that can restyle it happens.
 *
 * Reading `getComputedStyle(host).backgroundColor` forces a synchronous style recalculation
 * whenever the document has pending style changes — which a render that follows any DOM or class
 * change has. The renderer asks for the colour on every draw, so the read is cached here.
 *
 * Nothing in the app switches the background (there is no theme toggle; `--protspace-bg-color`
 * defaults to the constant `--surface` token), so the cache is dropped on the things that could
 * restyle the host: attribute changes (class, style, data-theme, ...) on the host or any ancestor
 * across shadow boundaries, a stylesheet or `<style>` being added or removed in `<head>`, a
 * `prefers-color-scheme` flip, and re-attachment to the document. Rules inserted through the
 * CSSOM (`insertRule`, `adoptedStyleSheets`) cannot be observed; a host that restyles that way
 * calls `invalidate()`.
 */
export class BackgroundColorCache {
  private _color: Rgb | null = null;
  private _observer: MutationObserver | null = null;
  private _scheme: MediaQueryList | null = null;
  /** The scheme the cached colour was read under. */
  private _schemeDark = false;

  constructor(private readonly _host: HTMLElement) {}

  /** The resolved colour; read from computed style only when no valid value is cached. */
  get(): Rgb {
    // Mutations are delivered as a microtask; a read in the same task as the change must not
    // see the old colour.
    if (this._observer?.takeRecords().length) this.invalidate();
    // Likewise a `prefers-color-scheme` flip, whose change event waits for the next frame.
    if (this._scheme && this._scheme.matches !== this._schemeDark) this.invalidate();
    if (this._color) return this._color;
    const color = resolveColor(getComputedStyle(this._host).backgroundColor);
    // A detached host has no computed style to cache.
    if (this._host.isConnected) {
      this._color = color;
      this._schemeDark = this._scheme?.matches ?? false;
    }
    return color;
  }

  invalidate(): void {
    this._color = null;
  }

  /** Start watching for restyles; call from `connectedCallback`. Idempotent. */
  connect(): void {
    this.invalidate();
    this.disconnect();
    if (typeof MutationObserver !== 'undefined') {
      this._observer = new MutationObserver(() => this.invalidate());
      for (let node: Node | null = this._host; node; node = this._parentAcrossShadow(node)) {
        if (node instanceof Element) this._observer.observe(node, { attributes: true });
      }
      const head = this._host.ownerDocument.head;
      if (head) this._observer.observe(head, { childList: true, subtree: true });
    }
    if (typeof matchMedia === 'function') {
      this._scheme = matchMedia('(prefers-color-scheme: dark)');
      this._scheme.addEventListener?.('change', this._onSchemeChange);
    }
  }

  /** Stop watching; call from `disconnectedCallback`. */
  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._scheme?.removeEventListener?.('change', this._onSchemeChange);
    this._scheme = null;
    this.invalidate();
  }

  private _onSchemeChange = () => this.invalidate();

  private _parentAcrossShadow(node: Node): Node | null {
    return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
  }
}
