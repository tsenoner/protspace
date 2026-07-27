# Contributing

The contribution guide for the whole repository, issue reporting, setup, quality gates, commit
conventions, pull requests and the release process, lives in one place:

**→ [CONTRIBUTING.md on GitHub](https://github.com/tsenoner/protspace/blob/main/CONTRIBUTING.md)**

Read that first. This page only covers the component patterns specific to the web front end.

## Web component patterns

The visual components in `packages/core` are [Lit](https://lit.dev) elements. `apps/web` is a React
host shell that mounts them; the rendering itself is Lit plus a hand-written WebGL2 renderer under
`packages/core/src/components/scatter-plot/webgl/`.

### Writing a component

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('protspace-example')
export class ProtspaceExample extends LitElement {
  @property({ type: String }) title = 'Example';
  @state() private _count = 0;

  static styles = css`
    :host {
      display: block;
    }
  `;

  render() {
    return html`
      <div>
        <h1>${this.title}</h1>
        <button @click=${this._increment}>Count: ${this._count}</button>
      </div>
    `;
  }

  private _increment() {
    this._count++;
    this.dispatchEvent(
      new CustomEvent('count-change', {
        detail: { count: this._count },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
```

### Event communication

Components stay decoupled by talking through custom events. Use `bubbles: true` and
`composed: true` so the event escapes the shadow root and reaches the host app.

```typescript
// Dispatch, this is how the scatter plot emits a box/lasso selection
this.dispatchEvent(
  new CustomEvent('brush-selection', {
    detail: { proteinIds: selectedIds, isMultiple: true },
    bubbles: true,
    composed: true,
  }),
);

// Listen
plot.addEventListener('brush-selection', (e) => {
  console.log('Selected:', e.detail.proteinIds);
});
```

The scatter plot's public events are `protein-click`, `protein-hover`, `brush-selection`,
`data-change`, `data-isolation`, `data-isolation-reset`, `auto-disable-selection`, `file-dropped`
and `tour-start`.

::: tip
Event names and payloads are a public contract. When you change one, update
[Messaging](/developers/messaging) and the tests in the same pull request.
:::

## See also

- [Architecture](/developers/architecture), how the packages fit together
- [Style Architecture](/developers/style-architecture), CSS and theming conventions
- [Installation](/developers/installation), local setup
