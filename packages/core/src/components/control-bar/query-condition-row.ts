import { LitElement, html, nothing } from 'lit';
import { property, state, query as litQuery } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { FilterCondition, LogicalOp, NumericCondition } from './query-types';
import { ANY_VALUE, createCondition, createNumericCondition } from './query-types';
import type { ProtspaceData } from './types';
import { groupAnnotations } from './annotation-categories';
import { handleDropdownEscape } from '../../utils/dropdown-helpers';
import { NA_VALUE, NA_DISPLAY, isNumericAnnotation } from '@protspace/utils';
import { queryBuilderStyles } from './query-builder.styles';
import { ANY_DISPLAY } from './query-value-picker';
import './query-numeric-input';

/**
 * Renders a single query condition row.
 *
 * Events:
 * - `condition-changed` — any field changed, detail: `{ condition: FilterCondition }`
 * - `condition-removed` — remove button clicked, detail: `{ id: string }`
 */
@customElement('protspace-query-condition-row')
class ProtspaceQueryConditionRow extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: Object }) condition!: FilterCondition;
  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Object }) matchedIndices: Set<number> = new Set();
  @property({ type: Boolean }) isFirst: boolean = false;

  @state() private _showAnnotationPicker: boolean = false;
  @state() private _showValuePicker: boolean = false;
  @state() private _annotationSearch: string = '';
  /** Index into the *filtered* annotation list; -1 means nothing highlighted. */
  @state() private _annotationHighlightIndex: number = -1;
  @state() private _pickerPos = { top: 0, left: 0 };
  @state() private _valuePickerPos = { top: 0, left: 0 };

  @litQuery('.annotation-picker-input') private _annotationInputEl?: HTMLInputElement;

  // ─── Click-outside detection ──────────────────────────────────────────────

  private _handleDocumentClick = (e: MouseEvent) => {
    if (this._showAnnotationPicker && !e.composedPath().includes(this)) {
      this._closeAnnotationPicker();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._handleDocumentClick, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleDocumentClick, true);
  }

  // ─── Auto-focus annotation picker input ───────────────────────────────────

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('_showAnnotationPicker') && this._showAnnotationPicker) {
      this.updateComplete.then(() => {
        this._annotationInputEl?.focus();
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _displayValue(value: string): string {
    if (value === NA_VALUE) return NA_DISPLAY;
    if (value === ANY_VALUE) return ANY_DISPLAY;
    return value;
  }

  private _dispatchChanged(updated: FilterCondition) {
    this.dispatchEvent(
      new CustomEvent('condition-changed', {
        detail: { condition: updated },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ─── Annotation picker grouping ───────────────────────────────────────────

  private _groupAnnotations() {
    return groupAnnotations(this.annotations, this.data?.annotations).map((g) => ({
      category: g.category,
      items: g.annotations,
    }));
  }

  /** The grouped annotations that survive the search box, in render order. */
  private _filteredAnnotationGroups(): { category: string; items: string[] }[] {
    const queryLower = this._annotationSearch.trim().toLowerCase();
    const groups = this._groupAnnotations();
    if (!queryLower) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((a) => a.toLowerCase().includes(queryLower)) }))
      .filter((g) => g.items.length > 0);
  }

  /** Flattened filtered list — the sequence keyboard navigation walks. */
  private _flatFilteredAnnotations(): string[] {
    return this._filteredAnnotationGroups().flatMap((g) => g.items);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _closeAnnotationPicker() {
    this._showAnnotationPicker = false;
    this._annotationSearch = '';
    this._annotationHighlightIndex = -1;
  }

  private _toggleAnnotationPicker(e: Event) {
    this._showAnnotationPicker = !this._showAnnotationPicker;
    this._annotationHighlightIndex = -1;
    if (this._showAnnotationPicker) {
      const btn = e.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      this._pickerPos = { top: rect.bottom + 4, left: rect.left };
    } else {
      this._annotationSearch = '';
    }
  }

  private _handleAnnotationPickerKeydown(e: KeyboardEvent) {
    if (!this._showAnnotationPicker) {
      // Closed trigger: Enter/Space opens the picker. preventDefault keeps the
      // native button activation from toggling it straight back shut.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._toggleAnnotationPicker(e);
      }
      return;
    }

    const items = this._flatFilteredAnnotations();

    if (e.key === 'Escape') {
      // Stops propagation so the surrounding modal does not also close.
      handleDropdownEscape(e, () => this._closeAnnotationPicker());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        this._annotationHighlightIndex = Math.min(
          this._annotationHighlightIndex + 1,
          items.length - 1,
        );
        this._scrollToHighlighted();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        this._annotationHighlightIndex = Math.max(this._annotationHighlightIndex - 1, 0);
        this._scrollToHighlighted();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._annotationHighlightIndex >= 0 && this._annotationHighlightIndex < items.length) {
        this._selectAnnotation(items[this._annotationHighlightIndex]);
      }
    }
  }

  private _scrollToHighlighted() {
    this.updateComplete.then(() => {
      const highlighted = this.shadowRoot?.querySelector('.annotation-picker-item.highlighted');
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  private _selectAnnotation(annotation: string) {
    this._showAnnotationPicker = false;
    this._annotationSearch = '';
    this._annotationHighlightIndex = -1;
    this._showValuePicker = false;
    // Replace the whole condition object so its kind matches the annotation.
    const base = {
      id: this.condition.id,
      logicalOp: this.condition.logicalOp,
      annotation,
    };
    // Use the shared numeric check so that a numeric annotation is still treated as
    // numeric after materialization bins it to kind:'categorical' (it keeps
    // sourceKind:'numeric'); otherwise the currently-coloured numeric annotation
    // would offer a categorical bin picker instead of the numeric range input.
    const isNumeric = isNumericAnnotation(this.data?.annotations?.[annotation]);
    this._dispatchChanged(isNumeric ? createNumericCondition(base) : createCondition(base));
  }

  private _handleLogicalOpChange(e: Event) {
    const raw = (e.target as HTMLSelectElement).value;
    const value = raw === '' ? undefined : (raw as LogicalOp);
    this._dispatchChanged({ ...this.condition, logicalOp: value });
  }

  private _removeValue(value: string) {
    if (this.condition.kind !== 'categorical') return;
    const values = this.condition.values.filter((v) => v !== value);
    this._dispatchChanged({ ...this.condition, values });
  }

  private _handleValueSelected(e: CustomEvent<{ value: string }>) {
    if (this.condition.kind !== 'categorical') return;
    const value = e.detail.value;
    const values = this.condition.values;
    if (values.includes(value)) return;

    // "Any value" is mutually exclusive with every other value: OR-ing it with a
    // real value is just "any value", and OR-ing it with N/A matches everything.
    // Selecting it therefore replaces the selection; once it is in place the
    // picker locks the rest out, and this guard backs that up.
    if (value === ANY_VALUE) {
      this._dispatchChanged({ ...this.condition, values: [ANY_VALUE] });
      return;
    }
    if (values.includes(ANY_VALUE)) return;

    this._dispatchChanged({ ...this.condition, values: [...values, value] });
  }

  private _handleValuePickerClose() {
    this._showValuePicker = false;
  }

  private _handleRemove() {
    this.dispatchEvent(
      new CustomEvent('condition-removed', {
        detail: { id: this.condition.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ─── Sub-renders ──────────────────────────────────────────────────────────

  private _renderAnnotationPicker() {
    const filteredGroups = this._filteredAnnotationGroups();
    // Running index over the flattened filtered list, so it lines up with
    // `_flatFilteredAnnotations()` and therefore with `_annotationHighlightIndex`.
    let flatIndex = 0;

    return html`
      <div
        class="annotation-picker"
        style="top:${this._pickerPos.top}px;left:${this._pickerPos.left}px"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <input
          class="annotation-picker-input"
          placeholder="Search annotations..."
          aria-label="Search annotations"
          aria-controls="annotation-picker-list"
          aria-activedescendant=${this._annotationHighlightIndex >= 0
            ? `annotation-picker-option-${this._annotationHighlightIndex}`
            : nothing}
          .value=${this._annotationSearch}
          @input=${(e: Event) => {
            this._annotationSearch = (e.target as HTMLInputElement).value;
            this._annotationHighlightIndex = -1;
          }}
          @keydown=${this._handleAnnotationPickerKeydown}
        />
        <div
          id="annotation-picker-list"
          class="value-picker-list"
          role="listbox"
          aria-label="Annotations"
        >
          ${filteredGroups.map(
            (group) => html`
              <div class="annotation-picker-category" role="presentation">${group.category}</div>
              ${group.items.map((ann) => {
                const itemIndex = flatIndex++;
                const isHighlighted = itemIndex === this._annotationHighlightIndex;
                return html`
                  <div
                    id="annotation-picker-option-${itemIndex}"
                    class="annotation-picker-item ${isHighlighted ? 'highlighted' : ''}"
                    role="option"
                    aria-selected=${ann === this.condition.annotation}
                    @click=${() => this._selectAnnotation(ann)}
                    @mouseenter=${() => {
                      this._annotationHighlightIndex = itemIndex;
                    }}
                  >
                    ${ann}
                  </div>
                `;
              })}
            `,
          )}
          ${filteredGroups.length === 0
            ? html`<div class="value-picker-footer">No matching annotations</div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderValues() {
    if (this.condition.kind !== 'categorical') return nothing;
    return html`
      <div class="value-chips">
        ${this.condition.values.map(
          (v) => html`
            <span class="value-chip">
              <span class="value-chip-text">${this._displayValue(v)}</span>
              <button
                class="value-chip-remove"
                @click=${() => this._removeValue(v)}
                title="Remove value"
              >
                ×
              </button>
            </span>
          `,
        )}
        <button
          class="value-chip-add"
          @click=${(e: Event) => {
            this._showValuePicker = !this._showValuePicker;
            if (this._showValuePicker) {
              const btn = e.currentTarget as HTMLElement;
              const rect = btn.getBoundingClientRect();
              this._valuePickerPos = { top: rect.bottom + 4, left: rect.left };
            }
          }}
          title="Add value"
        >
          +
        </button>
      </div>
      <protspace-query-value-picker
        .annotation=${this.condition.annotation}
        .data=${this.data}
        .matchedIndices=${this.matchedIndices}
        .logicalOp=${this.condition.logicalOp}
        .selectedValues=${this.condition.values}
        .open=${this._showValuePicker}
        .triggerTop=${this._valuePickerPos.top}
        .triggerLeft=${this._valuePickerPos.left}
        @value-selected=${this._handleValueSelected}
        @picker-close=${this._handleValuePickerClose}
      ></protspace-query-value-picker>
    `;
  }

  private _handleNumericChanged(e: CustomEvent<{ condition: NumericCondition }>) {
    this._dispatchChanged(e.detail.condition);
  }

  private _renderNumericInput() {
    if (this.condition.kind !== 'numeric') return nothing;
    return html`
      <protspace-query-numeric-input
        .condition=${this.condition}
        .data=${this.data}
        @numeric-changed=${this._handleNumericChanged}
      ></protspace-query-numeric-input>
    `;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="condition-row">
        ${this.isFirst
          ? html`
              <select
                class="logical-op-select ${this.condition.logicalOp === 'NOT' ? '' : 'op-blank'}"
                .value=${this.condition.logicalOp ?? ''}
                @change=${this._handleLogicalOpChange}
              >
                <option value="">​</option>
                <option value="NOT">NOT</option>
              </select>
            `
          : html`
              <select
                class="logical-op-select"
                .value=${this.condition.logicalOp ?? 'AND'}
                @change=${this._handleLogicalOpChange}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
                <option value="NOT">NOT</option>
              </select>
            `}

        <button
          class="annotation-select-trigger"
          @click=${this._toggleAnnotationPicker}
          @keydown=${this._handleAnnotationPickerKeydown}
          aria-expanded=${this._showAnnotationPicker}
          aria-haspopup="listbox"
        >
          ${this.condition.annotation || 'Select annotation...'}
        </button>

        ${this._showAnnotationPicker ? this._renderAnnotationPicker() : nothing}
        ${this.condition.kind === 'numeric' ? this._renderNumericInput() : this._renderValues()}

        <button class="condition-remove" @click=${this._handleRemove} title="Remove condition">
          ×
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-condition-row': ProtspaceQueryConditionRow;
  }
}
