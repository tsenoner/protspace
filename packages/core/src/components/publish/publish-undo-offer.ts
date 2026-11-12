import type { ReactiveController, ReactiveElement } from 'lit';
import type { PublishState } from './publish-state';
import type { UndoMessage } from './sections/footer';

/**
 * The footer's Undo after New figure or Reset: on offer until the next edit or for 8 s. The 8 s
 * wait while focus is in the strip, so it never leaves from under a keyboard user.
 */
export class PublishUndoOffer implements ReactiveController {
  private offer: { message: UndoMessage; before: PublishState; after: PublishState } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: ReactiveElement) {
    host.addController(this);
  }

  get message(): UndoMessage | null {
    return this.offer?.message ?? null;
  }

  /** Offers to go back to `before` while the state stays `after`. */
  start(message: UndoMessage, before: PublishState, after: PublishState): void {
    this.offer = { message, before, after };
    this.release();
    this.host.requestUpdate();
  }

  /** Any state but the one New figure or Reset produced is an edit after it: Undo would lose it. */
  dropIfEdited(state: PublishState): void {
    if (this.offer && state !== this.offer.after) this.drop();
  }

  hold(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  release(): void {
    if (!this.offer) return;
    this.hold();
    this.timer = setTimeout(() => this.drop(), 8_000);
  }

  /** Ends the offer and returns the state to go back to. */
  take(): PublishState | null {
    const before = this.offer?.before ?? null;
    this.drop();
    return before;
  }

  /** Ends the offer; focus in the strip goes back to the button whose Undo it was. */
  drop(): void {
    if (!this.offer) return;
    const root = this.host.renderRoot as ShadowRoot;
    const strip = root.querySelector('.publish-undo');
    const hadFocus = !!strip && !!root.activeElement && strip.contains(root.activeElement);
    const from = this.offer.message === 'Settings reset' ? 'Reset' : 'New figure';
    this.hold();
    this.offer = null;
    this.host.requestUpdate();
    if (!hadFocus) return;
    void this.host.updateComplete.then(() => {
      if (!this.host.isConnected) return;
      [...root.querySelectorAll<HTMLElement>('ps-button')]
        .find((each) => each.textContent?.trim() === from)
        ?.focus();
    });
  }

  hostDisconnected(): void {
    this.hold();
  }
}
