import { LitElement, html, nothing } from 'lit';
import { property, state, query as litQuery } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { FilterCondition, NumericCondition } from './query-types';
import { ANY_VALUE, createCondition, createNumericCondition } from './query-types';
import {
  CATEGORICAL_OPERATORS,
  NUMERIC_OPERATORS,
  isPresenceOperator,
  operatorLabel,
  operatorOf,
  operatorText,
  type ConditionOperator,
} from './query-operators';
import { evaluateQuery } from './query-evaluate';
import type { ProtspaceData } from './types';
import {
  filterGroupedAnnotations,
  flattenGroupedAnnotations,
} from '../common/annotation-categories';
import { predictedMark, renderAnnotationName } from '../common/annotation-name';
import { handleListboxKeydown, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import {
  annotationLabel,
  annotationSource,
  countNoun,
  formatCount,
  isNAValue,
  isNumericAnnotation,
  NA_VALUE,
} from '@protspace/utils';
import { icon } from '../kit/icon';
import { queryBuilderStyles } from './query-builder.styles';
import { displayFilterValue, renderValueChip } from './query-presence';
import { presenceOf } from './query-numeric-helpers';
import '../kit/button';
import '../kit/menu';
import '../kit/popover';
import type { PsPopover } from '../kit/popover';
import './query-value-picker';
import './query-numeric-input';

/**
 * Renders a single query condition row.
 *
 * Events:
 * - `condition-changed` — any field changed, detail: `{ condition: FilterCondition }`
 * - `condition-removed` — Remove in the card's menu, detail: `{ id: string }`
 * - `condition-duplicated` — Duplicate in the card's menu, detail: `{ id: string }`
 * - `operator-changed` — an operator picked in the operator menu, detail:
 *   `{ id: string, operator: ConditionOperator }`; the builder stores it (`setOperator`)
 */
/** Proteins with a value, per dataset and annotation, for the operator menu's counts. */
const presenceCounts = new WeakMap<ProtspaceData, Map<string, number>>();

/** Distinct values a categorical annotation holds, N/A left out, per values array. */
const valueCounts = new WeakMap<readonly (string | null)[], number>();

function distinctValues(values: readonly (string | null)[]): number {
  let n = valueCounts.get(values);
  if (n === undefined) {
    n = values.filter((v) => v !== null && !isNAValue(v)).length;
    valueCounts.set(values, n);
  }
  return n;
}

@customElement('protspace-query-condition-row')
class ProtspaceQueryConditionRow extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: Object }) condition!: FilterCondition;
  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Object }) matchedIndices: Set<number> = new Set();
  /** The condition's number in the builder (1-based, group leaves included); 0 shows none. */
  @property({ type: Number }) number = 0;
  /** Changed since the last Apply: the card carries an accent edge. */
  @property({ type: Boolean, reflect: true }) edited = false;

  @state() private _showAnnotationPicker: boolean = false;
  @state() private _showValuePicker: boolean = false;
  @state() private _annotationSearch: string = '';
  /** Index into the *filtered* annotation list; -1 means nothing highlighted. */
  @state() private _annotationHighlightIndex: number = -1;
  @state() private _menuOpen = false;
  @state() private _operatorMenuOpen = false;
  /**
   * The operator last picked in the menu, for this condition. A comparison with an N/A chip and
   * no bound yet holds exactly what "has no value" holds; the pick keeps the card on the
   * comparison while its bound is typed.
   */
  private _picked?: { id: string; operator: ConditionOperator };

  @litQuery('.annotation-picker-input') private _annotationInputEl?: HTMLInputElement;
  @litQuery('.condition-menu-trigger') private _menuTriggerEl?: HTMLElement;
  @litQuery('.operator-pill') private _operatorPillEl?: HTMLElement;
  @litQuery('.condition-head') private _headEl?: HTMLElement;
  @litQuery('.value-add') private _valueAddEl?: HTMLElement;
  @litQuery('.annotation-popover') private _annotationPopoverEl?: PsPopover;

  // ─── Auto-focus annotation picker input ───────────────────────────────────

  updated(changedProperties: Map<string, unknown>) {
    if (!changedProperties.has('_showAnnotationPicker') || !this._showAnnotationPicker) return;
    // The popover (a layer: Escape and an outside press close it) shows itself in its own update.
    // A phone's sheet focuses its title instead, so the keyboard does not cover the list.
    void (this._annotationPopoverEl?.updateComplete ?? Promise.resolve()).then(() =>
      this._annotationPopoverEl?.hasAttribute('docked')
        ? this.renderRoot.querySelector<HTMLElement>('.annotation-picker-title')?.focus()
        : this._annotationInputEl?.focus(),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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

  /**
   * The grouped annotations that survive the search box, each item already
   * carrying its position in the flattened list.
   *
   * Stamping the index here rather than counting through the nested render keeps
   * `aria-activedescendant` and `.highlighted` from depending on the template
   * arrays being evaluated in document order exactly once — an assumption a
   * `repeat()` or a memoized sub-render would break silently.
   */
  private _filteredAnnotationGroups(): {
    category: string;
    items: { name: string; index: number }[];
  }[] {
    let flatIndex = 0;
    return filterGroupedAnnotations(
      this.annotations,
      this._annotationSearch,
      this.data?.annotations,
    ).map((g) => ({
      category: g.category,
      items: g.annotations.map((name) => ({ name, index: flatIndex++ })),
    }));
  }

  /** Flattened filtered list — the sequence keyboard navigation walks. */
  private _flatFilteredAnnotations(): string[] {
    // Same filter and the same flatten as the annotation dropdown, so the order
    // matches the indices `_filteredAnnotationGroups` stamps for render.
    return flattenGroupedAnnotations(
      filterGroupedAnnotations(this.annotations, this._annotationSearch, this.data?.annotations),
    );
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _closeAnnotationPicker() {
    this._showAnnotationPicker = false;
    this._annotationSearch = '';
    this._annotationHighlightIndex = -1;
  }

  /** Closes this row's annotation and value pickers; `updated()` releases their layers. */
  closePickers(): void {
    this._closeAnnotationPicker();
    this._showValuePicker = false;
    this._menuOpen = false;
    this._operatorMenuOpen = false;
  }

  private _toggleAnnotationPicker() {
    if (this._showAnnotationPicker) {
      this._closeAnnotationPicker();
      return;
    }
    this._openAnnotationPicker();
  }

  /** The picker hangs under the card's header, the row the trigger and the menu sit on. */
  private _openAnnotationPicker() {
    this._showAnnotationPicker = true;
    this._annotationHighlightIndex = -1;
  }

  private _handleAnnotationPickerKeydown(e: KeyboardEvent) {
    if (!this._showAnnotationPicker) {
      // Closed trigger: Enter/Space opens the picker. preventDefault keeps the
      // native button activation from toggling it straight back shut.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._toggleAnnotationPicker();
      }
      return;
    }

    handleListboxKeydown(e, {
      // Lazy: only the arrow and Enter keys pay for re-grouping the annotations.
      getValues: () => this._flatFilteredAnnotations(),
      highlightIndex: this._annotationHighlightIndex,
      setHighlightIndex: (index) => {
        this._annotationHighlightIndex = index;
        this._scrollToHighlighted();
      },
      // Escape stops propagation so the surrounding modal does not also close.
      onEscape: () => this._closeAnnotationPicker(),
      onSelect: (annotation) => this._selectAnnotation(annotation),
      root: this.shadowRoot,
      itemSelector: '.annotation-picker-item',
      valueAttribute: 'data-annotation',
    });
  }

  private _scrollToHighlighted() {
    this.updateComplete.then(() =>
      scrollHighlightedIntoView(this.shadowRoot, '.annotation-picker-item.highlighted'),
    );
  }

  private _selectAnnotation(annotation: string) {
    this._closeAnnotationPicker();
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

  /** The operator the card shows: the stored one, or the comparison just picked (`_picked`). */
  private _operator(): ConditionOperator {
    const stored = operatorOf(this.condition);
    const picked = this._picked;
    return stored === 'has-none' &&
      picked?.id === this.condition.id &&
      !isPresenceOperator(picked.operator) &&
      this.condition.kind === 'numeric'
      ? picked.operator
      : stored;
  }

  private _handleOperatorSelect(e: CustomEvent<{ value: string }>) {
    e.stopPropagation();
    this._operatorMenuOpen = false;
    const operator = e.detail.value as ConditionOperator;
    const current = this._operator();
    this._picked = { id: this.condition.id, operator };
    this._showValuePicker = false;
    if (operator === current) return;
    this.dispatchEvent(
      new CustomEvent('operator-changed', {
        detail: { id: this.condition.id, operator },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _removeValue(value: string) {
    if (this.condition.kind !== 'categorical') return;
    const values = this.condition.values.filter((v) => v !== value);
    // The chip goes; focus stays in the card, on "+ value".
    this._valueAddEl?.focus();
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

  private _handleValuesChange(e: CustomEvent<{ values: string[] }>) {
    if (this.condition.kind !== 'categorical') return;
    this._dispatchChanged({ ...this.condition, values: e.detail.values });
  }

  private _handleValuePickerClose() {
    this._showValuePicker = false;
  }

  private _dispatchById(type: 'condition-removed' | 'condition-duplicated') {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { id: this.condition.id }, bubbles: true, composed: true }),
    );
  }

  private _hasValues(): boolean {
    const c = this.condition;
    return c.kind === 'categorical'
      ? c.values.length > 0
      : c.min !== null || c.max !== null || (c.presence?.length ?? 0) > 0;
  }

  private _clearValues() {
    const c = this.condition;
    this._dispatchChanged(
      c.kind === 'categorical'
        ? { ...c, values: [] }
        : { ...c, min: null, max: null, presence: [] },
    );
  }

  private _handleMenuSelect(e: CustomEvent<{ value: string }>) {
    e.stopPropagation();
    this._menuOpen = false;
    switch (e.detail.value) {
      case 'change':
        this._openAnnotationPicker();
        return;
      case 'clear':
        this._clearValues();
        return;
      case 'duplicate':
        this._dispatchById('condition-duplicated');
        return;
      case 'remove':
        this._dispatchById('condition-removed');
    }
  }

  // ─── Sub-renders ──────────────────────────────────────────────────────────

  /** The annotation picker: a popover under the card's header, a bottom sheet on a phone. */
  private _renderAnnotationPicker() {
    return html`<ps-popover
      class="annotation-popover"
      placement="bottom-start"
      sheet
      panel-label="Choose annotation"
      .anchor=${this._headEl ?? null}
      .open=${this._showAnnotationPicker}
      @ps-close=${(e: Event) => {
        e.stopPropagation();
        this._closeAnnotationPicker();
      }}
      >${this._showAnnotationPicker ? this._renderAnnotationPickerBody() : nothing}</ps-popover
    >`;
  }

  /**
   * The search box over the annotations in their source sections, the Color by picker's
   * grouping and labels: a header and a divider per section, each row its name (wrapping), the
   * predicted mark, and what it holds ("number" or its count of values).
   */
  private _renderAnnotationPickerBody() {
    const filteredGroups = this._filteredAnnotationGroups();
    // Clamped: the list can shrink under a parked highlight (the annotations
    // change), and an index past the end would leave `aria-activedescendant`
    // referencing an id that is no longer rendered.
    const total = filteredGroups.reduce((n, g) => n + g.items.length, 0);
    const activeIndex =
      this._annotationHighlightIndex < total ? this._annotationHighlightIndex : -1;
    const query = this._annotationSearch.trim();

    return html`
      <div class="annotation-picker">
        <p class="annotation-picker-title" tabindex="-1">Choose annotation</p>
        <div class="value-picker-search">
          ${icon('search', 14)}
          <input
            class="annotation-picker-input value-picker-input"
            type="text"
            placeholder="Search ${formatCount(this.annotations.length)} annotations"
            aria-label="Search annotations"
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="annotation-picker-list"
            aria-activedescendant=${activeIndex >= 0
              ? `annotation-picker-option-${activeIndex}`
              : nothing}
            autocomplete="off"
            .value=${this._annotationSearch}
            @input=${(e: Event) => {
              this._annotationSearch = (e.target as HTMLInputElement).value;
              this._annotationHighlightIndex = -1;
            }}
            @keydown=${this._handleAnnotationPickerKeydown}
          />
        </div>
        <div
          id="annotation-picker-list"
          class="annotation-picker-list"
          role="listbox"
          aria-label="Annotations"
        >
          ${filteredGroups.map(
            (group, g) => html`
              <div
                class="annotation-picker-section"
                role="group"
                aria-labelledby="annotation-picker-group-${g}"
              >
                <div
                  class="annotation-picker-category"
                  id="annotation-picker-group-${g}"
                  role="presentation"
                >
                  ${group.category}
                </div>
                ${group.items.map(({ name, index }) =>
                  this._renderAnnotationOption(name, index === activeIndex, index),
                )}
              </div>
            `,
          )}
        </div>
        ${filteredGroups.length === 0
          ? html`<p class="annotation-picker-empty" role="status">
              No annotations match “${query}”
            </p>`
          : nothing}
      </div>
    `;
  }

  private _renderAnnotationOption(name: string, highlighted: boolean, index: number) {
    const definition = this.data?.annotations?.[name];
    const selected = name === this.condition.annotation;
    const numeric = isNumericAnnotation(definition);
    const values = numeric || !definition ? 0 : distinctValues(definition.values);
    return html`
      <div
        id="annotation-picker-option-${index}"
        class="dropdown-item annotation-picker-item ${highlighted ? 'highlighted' : ''}"
        role="option"
        data-annotation=${name}
        aria-selected=${selected}
        @click=${() => this._selectAnnotation(name)}
      >
        <span class="annotation-picker-check">${selected ? icon('check', 14) : nothing}</span>
        <span class="dropdown-item-label">${annotationLabel(name, definition)}</span>
        ${predictedMark(name)}
        ${numeric
          ? html`<span class="condition-badge annotation-picker-kind">number</span>`
          : values > 0
            ? html`<span class="annotation-picker-count"
                >${countNoun(values, 'value', 'values')}</span
              >`
            : nothing}
      </div>
    `;
  }

  private _renderValues() {
    // Ticking only N/A reads as "has no value"; the open list stays until Done.
    if (
      this.condition.kind !== 'categorical' ||
      (isPresenceOperator(this._operator()) && !this._showValuePicker)
    )
      return nothing;
    return html`
      ${this.condition.values.map((v) => renderValueChip(v, () => this._removeValue(v)))}
      <ps-button
        class="value-add"
        variant="ghost"
        size="sm"
        aria-expanded=${this._showValuePicker ? 'true' : 'false'}
        @click=${() => {
          this._showValuePicker = !this._showValuePicker;
        }}
        ><span slot="start">${icon('plus', 14)}</span
        ><span class="sr-only">Add </span>value</ps-button
      >
      <protspace-query-value-picker
        .annotation=${this.condition.annotation}
        .data=${this.data}
        .matchedIndices=${this.matchedIndices}
        .logicalOp=${this.condition.logicalOp}
        .selectedValues=${this.condition.values}
        .open=${this._showValuePicker}
        .anchor=${this._valueAddEl ?? null}
        @value-selected=${this._handleValueSelected}
        @values-change=${this._handleValuesChange}
        @picker-close=${this._handleValuePickerClose}
      ></protspace-query-value-picker>
    `;
  }

  private _handleNumericChanged(e: CustomEvent<{ condition: NumericCondition }>) {
    // Ticking N/A before any bound stores what "has no value" stores; the card keeps its comparison.
    this._picked = { id: this.condition.id, operator: this._operator() };
    this._dispatchChanged(e.detail.condition);
  }

  private _renderNumericInput() {
    if (this.condition.kind !== 'numeric') return nothing;
    if (isPresenceOperator(this._operator())) return nothing;
    return html`
      <protspace-query-numeric-input
        .condition=${this.condition}
        .data=${this.data}
        @numeric-changed=${this._handleNumericChanged}
      ></protspace-query-numeric-input>
    `;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  /** "number" for a numeric annotation, else its source; nothing for an unknown source. */
  private _sourceBadge() {
    const name = this.condition.annotation;
    const definition = this.data?.annotations?.[name];
    const text =
      this.condition.kind === 'numeric' || isNumericAnnotation(definition)
        ? 'number'
        : annotationSource(name, definition);
    return text === 'Other' ? nothing : html`<span class="condition-badge">${text}</span>`;
  }

  /** What each operator does; the presence ones count the proteins they keep. */
  private _operatorDescription(operator: ConditionOperator): string {
    switch (operator) {
      case 'any-of':
        return 'matches one of the chosen values';
      case 'none-of':
        return 'has a value, but not these';
      case 'has-any': {
        const n = this._presenceCount();
        return n === null
          ? 'has a value'
          : countNoun(n, 'protein has a value', 'proteins have a value');
      }
      case 'has-none': {
        const n = this._presenceCount();
        const total = this.data?.protein_ids?.length ?? 0;
        return n === null
          ? 'has no value (N/A)'
          : countNoun(total - n, 'protein has none (N/A)', 'proteins have none (N/A)');
      }
      case 'gte':
        return 'the number or more';
      case 'lte':
        return 'the number or less';
      case 'gt':
        return 'above the number';
      case 'lt':
        return 'below the number';
      case 'between':
        return 'both numbers included';
    }
  }

  /** Proteins with a value for this card's annotation, counted once per dataset and annotation. */
  private _presenceCount(): number | null {
    const data = this.data;
    const annotation = this.condition.annotation;
    if (!data || !annotation) return null;
    let counts = presenceCounts.get(data);
    if (!counts) presenceCounts.set(data, (counts = new Map()));
    let n = counts.get(annotation);
    if (n === undefined) {
      const probe =
        this.condition.kind === 'numeric'
          ? createNumericCondition({ annotation, presence: [ANY_VALUE] })
          : createCondition({ annotation, values: [ANY_VALUE] });
      n = evaluateQuery([probe], data).size;
      counts.set(annotation, n);
    }
    return n;
  }

  private _renderOperator(label: string) {
    const current = this._operator();
    const operators = this.condition.kind === 'numeric' ? NUMERIC_OPERATORS : CATEGORICAL_OPERATORS;
    const text =
      current === operatorOf(this.condition)
        ? operatorText(this.condition)
        : operatorLabel(current);
    const item = (operator: ConditionOperator) => html`
      <ps-menu-item type="radio" value=${operator} ?checked=${operator === current}
        >${operatorLabel(operator)}<span slot="description"
          >${this._operatorMenuOpen ? this._operatorDescription(operator) : ''}</span
        ></ps-menu-item
      >
    `;
    return html`
      <ps-button
        class="operator-pill"
        variant="ghost"
        size="sm"
        @click=${() => (this._operatorMenuOpen = !this._operatorMenuOpen)}
        ><span class="sr-only">${label}: </span>${text}<span slot="end"
          >${icon('chevron-down', 14)}</span
        ></ps-button
      >
      <ps-menu
        label=${label}
        sheet
        .anchor=${this._operatorPillEl ?? null}
        .open=${this._operatorMenuOpen}
        @ps-select=${this._handleOperatorSelect}
        @ps-close=${(e: Event) => {
          e.stopPropagation();
          this._operatorMenuOpen = false;
        }}
      >
        <ps-menu-group>${operators.filter((o) => !isPresenceOperator(o)).map(item)}</ps-menu-group>
        <ps-menu-group class="presence-operators"
          >${operators.filter(isPresenceOperator).map(item)}</ps-menu-group
        >
      </ps-menu>
    `;
  }

  private _renderMenu(name: string) {
    const annotation = this.condition.annotation;
    return html`
      <ps-icon-button
        class="condition-menu-trigger"
        icon="ellipsis"
        size="sm"
        label=${`Actions for ${name}`}
        @click=${() => (this._menuOpen = !this._menuOpen)}
      ></ps-icon-button>
      <ps-menu
        label=${`Actions for ${name}`}
        placement="bottom-end"
        sheet
        .anchor=${this._menuTriggerEl ?? null}
        .open=${this._menuOpen}
        @ps-select=${this._handleMenuSelect}
        @ps-close=${(e: Event) => {
          e.stopPropagation();
          this._menuOpen = false;
        }}
      >
        <ps-menu-item value="change"
          >${annotation ? 'Change annotation' : 'Choose annotation'}</ps-menu-item
        >
        <ps-menu-item value="clear" ?disabled=${!this._hasValues()}>Clear values</ps-menu-item>
        <ps-menu-item value="duplicate">Duplicate</ps-menu-item>
        <ps-menu-item value="remove">Remove</ps-menu-item>
      </ps-menu>
    `;
  }

  /** The card's name for a screen reader: "Condition 2: Protein family is any of 2 values". */
  private _summary(name: string): string {
    const c = this.condition;
    const tail = this.edited ? ', not applied' : '';
    if (!c.annotation) return `${name}: no annotation chosen${tail}`;
    const label = annotationLabel(c.annotation, this.data?.annotations?.[c.annotation]);
    const operator = this._operator();
    const words = operator === operatorOf(c) ? operatorText(c) : operatorLabel(operator);
    // A missing value reads after a comma: "Sequence length is more than, no number yet".
    let what = '';
    if (isPresenceOperator(operator)) {
      // "has any value" / "has no value" say it all.
    } else if (c.kind === 'categorical') {
      const k = c.values.length;
      what =
        k === 0
          ? ', no value chosen'
          : k === 1
            ? ` ${displayFilterValue(c.values[0])}`
            : ` ${k} values`;
    } else {
      const bounds =
        operator === 'between'
          ? [c.min, c.max]
          : [operator === 'lt' || operator === 'lte' ? c.max : c.min];
      what = bounds.includes(null)
        ? ', no number yet'
        : ` ${bounds.map((v) => formatCount(v as number)).join(' and ')}`;
      if (presenceOf(c).includes(NA_VALUE)) what += ', or has no value';
    }
    return `${name}: ${label} ${words}${what}${tail}`;
  }

  render() {
    const n = this.number;
    const name = n > 0 ? `Condition ${n}` : 'Condition';
    const annotation = this.condition.annotation;
    return html`
      <div
        class="condition-row ${this.condition.kind === 'numeric' ? 'is-numeric' : ''}"
        role="group"
        aria-label=${this._summary(name)}
      >
        <div class="condition-head">
          <button
            type="button"
            class="annotation-select-trigger ${annotation ? '' : 'is-empty'}"
            @click=${this._toggleAnnotationPicker}
            @keydown=${this._handleAnnotationPickerKeydown}
            aria-expanded=${this._showAnnotationPicker}
            aria-haspopup="listbox"
          >
            ${annotation
              ? renderAnnotationName(
                  annotation,
                  this.data?.annotations?.[annotation],
                  'dropdown-trigger-text',
                )
              : html`<span class="dropdown-trigger-text">Choose annotation</span>${icon(
                    'chevron-down',
                    14,
                  )}`}
          </button>
          ${annotation ? this._sourceBadge() : nothing}
        </div>

        ${this._renderAnnotationPicker()}

        <div class="condition-values ${this.condition.kind === 'numeric' ? '' : 'value-chips'}">
          ${annotation
            ? this._renderOperator(n > 0 ? `Operator for condition ${n}` : 'Operator')
            : nothing}
          ${this.condition.kind === 'numeric' ? this._renderNumericInput() : this._renderValues()}
        </div>
        ${this._renderMenu(name.toLowerCase())}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-condition-row': ProtspaceQueryConditionRow;
  }
}
