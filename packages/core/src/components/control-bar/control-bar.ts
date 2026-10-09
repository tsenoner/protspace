import { LitElement, nothing } from 'lit';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';

/**
 * Empty since design decision 9 split it: projection, Color by and contours live in the view
 * bar, search, Import and Export in the app bar, the selection tools on the plot, Filter in its
 * dialog, and the app's controllers coordinate them. The app still mounts it until Task 2.10
 * deletes it.
 */
@customElement('protspace-control-bar')
export class ProtspaceControlBar extends LitElement {
  static styles = controlBarStyles;

  render() {
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-control-bar': ProtspaceControlBar;
  }
}
