import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { countNoun, formatCount } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import type { PsButton } from '../kit/button';
import type { ProtspaceData } from './types';
import '../kit/menu';
import '../kit/dialog';
import { pushLayer } from '../kit/layers';
import { COMPACT_MEDIA } from '../../utils/breakpoints';
import type { FilterCondition, FilterGroup, FilterQuery, FilterQueryItem } from './query-types';
import { createCondition, createGroup, isFilterGroup } from './query-types';
import {
  addToGroup,
  cardOf,
  duplicateCard,
  groupRun,
  isMixed,
  isNegatedGroup,
  itemJoiner,
  joinerWouldMix,
  nextJoiner,
  removeCard,
  replaceCondition,
  setJoiner,
  setJoinerForAll,
  setOperator,
  ungroup,
  ungroupChangesResult,
  type ConditionOperator,
  type Joiner,
} from './query-operators';
import { evaluateQuery, evaluateQueryExcluding, hasConfiguredCondition } from './query-evaluate';
import { queryChanges } from './query-equal';
import { applyBlock, applyBlockText, leafConditions } from './query-apply-state';
import { queryBuilderHostStyles, queryBuilderStyles } from './query-builder.styles';
import './query-condition-row';

/**
 * Each card's count base, by condition id: the proteins its values are counted among, null for
 * the whole dataset. A card joined with "or" adds proteins from anywhere its list reaches, so it
 * counts over its list's base; so does the first card of an "or" list. A card joined with "and"
 * counts inside what the rest of its list keeps. A group passes its own base down to its cards,
 * worked out by the same rule; the top-level list's base is the whole dataset.
 */
function countBases(query: FilterQuery, data: ProtspaceData): Map<string, Set<number> | null> {
  const bases = new Map<string, Set<number> | null>();
  const walk = (items: FilterQueryItem[], context: Set<number> | null) => {
    items.forEach((item, index) => {
      const orJoined =
        itemJoiner(item, index) === 'OR' ||
        (index === 0 && items.length > 1 && itemJoiner(items[1], 1) === 'OR');
      let base = context;
      if (!orJoined && hasConfiguredCondition(items.filter((_, i) => i !== index))) {
        const rest = evaluateQueryExcluding(items, data, item.id);
        base = context ? new Set([...rest].filter((i) => context.has(i))) : rest;
      }
      const card = cardOf(item, index === 0);
      if (card) bases.set(card.condition.id, base);
      else walk((item as FilterGroup).conditions, base);
    });
  };
  walk(query, null);
  return bases;
}

/**
 * The filter's query builder (design decision 14): conditions and groups, a live count of the
 * proteins the query keeps, and Apply, which says why it is disabled.
 *
 * A host that keeps a draft (the app's Filter panel) owns the query and whether it differs from the
 * filter last applied (`dirty`): Cancel is enabled, and Apply can apply, only while it does. A host
 * that never sets `dirty` (null) keeps the earlier behaviour: Apply follows the count alone.
 *
 * Events:
 * - `query-changed` — the query was edited; detail `{ query: FilterQuery }`. Set `query` back.
 * - `query-apply`   — Apply; detail `{ matchedIndices: Set<number> }` (indices into `data`)
 * - `query-reset`   — Reset
 * - `query-cancel`  — Cancel: return the query to the filter last applied
 * - `query-close`   — the close button or Escape, only when not `embedded`
 */
@customElement('protspace-query-builder')
export class ProtspaceQueryBuilder extends LitElement {
  static styles = [queryBuilderStyles, queryBuilderHostStyles];

  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Array }) query: FilterQuery = [];
  /**
   * The query differs from the filter last applied; set by a host that keeps a draft. null (unset):
   * Apply and Cancel ignore it.
   */
  @property({ attribute: false }) dirty: boolean | null = null;
  /**
   * The query a clean draft equals (the filter last applied), set by a host that keeps a draft:
   * cards that differ from it carry an accent edge, and Reset is off while both are empty. null:
   * no edges, Reset always on.
   */
  @property({ attribute: false }) appliedQuery: FilterQuery | null = null;
  /**
   * Hosted by a panel or dialog that brings its own heading (the app's Filter panel): the builder
   * then shows neither its title nor its close button, and leaves Escape to the host.
   */
  @property({ type: Boolean, reflect: true }) embedded = false;

  @state() private _matchedIndices: Set<number> = new Set();
  /** Each card's count base, by condition id (see `countBases`). */
  @state() private _excludedMatchMap: Map<string, Set<number> | null> = new Map();
  /** A count is pending (the 300 ms debounce): Apply waits, with no reason text. */
  @state() private _counting = true;
  /** How the count moved with the last edit; null before a second count on the same data. */
  @state() private _delta: number | null = null;
  /** The data the last count ran on, so a dataset swap is not read as an edit. */
  private _countedData: ProtspaceData | undefined = undefined;
  /** The query the last count ran on: Apply reuses its matches while it is still the query. */
  private _countedQuery: FilterQuery | undefined = undefined;

  /** The joiner menu is open, for the item `_joinerTarget`. */
  @state() private _joinerMenuOpen = false;
  /** The group menu is open, for the group `_groupTarget`. */
  @state() private _groupMenuOpen = false;
  /** A joiner that would mix "and" and "or" in its list waits here for "Group these?". */
  @state() private _joinerPrompt: { id: string; joiner: Joiner } | null = null;
  /** The prompt shows as a bottom sheet (a phone) rather than under its joiner. */
  private _promptSheet = false;
  /** Releases the inline prompt's layer, so Escape cancels it; set while it shows. */
  private _releasePromptLayer?: () => void;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Kept apart from the open state: the menu closes (ps-close) before it reports the choice.
  private _joinerTarget: { id: string; anchor: Element } | null = null;
  private _groupTarget: { id: string; anchor: Element } | null = null;
  private _focusPrompt = false;
  /** The cards that differ from `appliedQuery`, worked out once per render. */
  private _edited: ReadonlySet<string> = new Set();

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  private _onKeydown = (e: KeyboardEvent) => {
    // Embedded, the host owns Escape; a document listener here would dispatch query-close for
    // every Escape on the page.
    if (e.key === 'Escape' && !this.embedded) {
      this._handleClose();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeydown);
  }

  // Set here rather than in updated(): a state change in willUpdate joins this update, so Apply is
  // disabled in the same frame the query changes instead of trusting the previous count.
  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data') || changedProperties.has('query')) {
      this._counting = true;
    }
    // The query moved on (an edit, undo, the EAT slider): a pending prompt no longer applies.
    if (changedProperties.has('query')) this._joinerPrompt = null;
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data') || changedProperties.has('query')) {
      this._scheduleEvaluation(this.query);
    }
    // An id reference cannot reach into the button's shadow root: hand it the element.
    const apply = this.renderRoot.querySelector<PsButton>('.query-footer-apply');
    const reason = this.renderRoot.querySelector<HTMLElement>('#apply-reason');
    if (apply && reason && apply.describedBy[0] !== reason) apply.describedBy = [reason];
    this._syncPromptLayer();
    if (this._focusPrompt && !this._promptSheet) {
      this._focusPrompt = false;
      this.renderRoot.querySelector('.joiner-prompt')?.scrollIntoView({ block: 'nearest' });
      // Once the button has rendered its own <button>: a host with nothing inside takes no focus.
      const group = this.renderRoot.querySelector<PsButton>('.joiner-prompt-group');
      void group?.updateComplete.then(() => group.focus({ preventScroll: true }));
    }
  }

  /** The inline prompt is a layer while it shows: Escape cancels it before anything else. */
  private _syncPromptLayer() {
    const inline = this._joinerPrompt !== null && !this._promptSheet;
    if (inline && !this._releasePromptLayer) {
      this._releasePromptLayer = pushLayer({
        close: () => this._resolvePrompt('cancel'),
        elements: [this],
        dismissOnOutsidePress: false,
      });
    } else if (!inline && this._releasePromptLayer) {
      this._releasePromptLayer();
      this._releasePromptLayer = undefined;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._releasePromptLayer?.();
    this._releasePromptLayer = undefined;
    document.removeEventListener('keydown', this._onKeydown);
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  // ─── Match Count (debounced) ──────────────────────────────────────────────

  private _scheduleEvaluation(query: FilterQuery) {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (!this.data) return;
      const matched = evaluateQuery(query, this.data);
      this._delta =
        this._countedData === this.data ? matched.size - this._matchedIndices.size : null;
      this._countedData = this.data;
      this._countedQuery = query;
      this._matchedIndices = matched;

      const map = countBases(query, this.data);
      this._excludedMatchMap = map;
      this._counting = false;
    }, 300);
  }

  // ─── Dispatch helpers ────────────────────────────────────────────────────

  private _dispatch(type: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private _dispatchQueryChanged(newQuery: FilterQuery) {
    // The host sets `query` back, and updated() recounts.
    this._dispatch('query-changed', { query: newQuery });
  }

  // ─── Query mutations ─────────────────────────────────────────────────────

  private _addCondition() {
    const condition = createCondition({ logicalOp: nextJoiner(this.query) });
    this._dispatchQueryChanged([...this.query, condition]);
  }

  /** Adds an empty group after the last item; the Filter panel header's ⋯ menu calls it. */
  addGroup(): void {
    const group = createGroup({ logicalOp: nextJoiner(this.query) });
    this._dispatchQueryChanged([...this.query, group]);
  }

  /**
   * Leaves one empty card. It keeps the first card's id, so clearing a draft that was only ever
   * the fresh panel's empty card leaves it clean.
   */
  clearAll(): void {
    const first = leafConditions(this.query)[0];
    this._dispatchQueryChanged([createCondition(first ? { id: first.id } : undefined)]);
  }

  /** Whether Clear all has anything to clear. */
  get canClearAll(): boolean {
    return this.query.length > 1 || hasConfiguredCondition(this.query);
  }

  private _addConditionToGroup(groupId: string) {
    this._dispatchQueryChanged(addToGroup(this.query, groupId, createCondition()));
  }

  private _handleConditionChanged(e: CustomEvent<{ condition: FilterCondition }>) {
    e.stopPropagation();
    this._dispatchQueryChanged(replaceCondition(this.query, e.detail.condition));
  }

  private _handleOperatorChanged(e: CustomEvent<{ id: string; operator: ConditionOperator }>) {
    e.stopPropagation();
    this._dispatchQueryChanged(setOperator(this.query, e.detail.id, e.detail.operator));
  }

  private _openJoinerMenu(id: string, e: Event) {
    const anchor = e.currentTarget as Element;
    const same = this._joinerMenuOpen && this._joinerTarget?.id === id;
    this._joinerTarget = { id, anchor };
    this._joinerMenuOpen = !same;
  }

  /** A joiner picked: applied, unless it would mix "and" and "or", which asks first. */
  private _handleJoinerSelect(e: CustomEvent<{ value: string }>) {
    e.stopPropagation();
    this._joinerMenuOpen = false;
    const target = this._joinerTarget;
    if (!target) return;
    const joiner = e.detail.value as Joiner;
    if (joiner === this._joinerOf(target.id)) return;
    if (joinerWouldMix(this.query, target.id, joiner)) {
      this._promptSheet = typeof matchMedia === 'function' && matchMedia(COMPACT_MEDIA).matches;
      this._joinerPrompt = { id: target.id, joiner };
      this._focusPrompt = true;
      return;
    }
    this._dispatchQueryChanged(setJoiner(this.query, target.id, joiner));
  }

  /** The joiner the item `id` shows now; "and not" (a negated group) reads as neither. */
  private _joinerOf(id: string): Joiner | 'NOT' | undefined {
    const find = (items: FilterQuery): Joiner | 'NOT' | undefined | null => {
      for (const [index, item] of items.entries()) {
        const card = cardOf(item, index === 0);
        if (item.id === id || card?.condition.id === id)
          return isNegatedGroup(item) && index > 0 ? 'NOT' : itemJoiner(item, index);
        if (!card && isFilterGroup(item)) {
          const inner = find(item.conditions);
          if (inner !== null) return inner;
        }
      }
      return null;
    };
    return find(this.query) ?? undefined;
  }

  private _resolvePrompt(choice: 'group' | 'all' | 'cancel') {
    const prompt = this._joinerPrompt;
    this._joinerPrompt = null;
    this._focusPrompt = false;
    if (!prompt) return;
    if (choice === 'cancel') {
      // The sheet hands focus back itself, as a dialog does.
      if (!this._promptSheet) (this._joinerTarget?.anchor as HTMLElement | undefined)?.focus();
      return;
    }
    const next =
      choice === 'group'
        ? groupRun(this.query, prompt.id, prompt.joiner)
        : setJoinerForAll(this.query, prompt.id, prompt.joiner);
    this._dispatchQueryChanged(next);
  }

  private _openGroupMenu(id: string, e: Event) {
    const anchor = e.currentTarget as Element;
    const same = this._groupMenuOpen && this._groupTarget?.id === id;
    this._groupTarget = { id, anchor };
    this._groupMenuOpen = !same;
  }

  private _handleGroupMenuSelect(e: CustomEvent<{ value: string }>) {
    e.stopPropagation();
    this._groupMenuOpen = false;
    const id = this._groupTarget?.id;
    if (!id) return;
    if (e.detail.value === 'ungroup') this._dispatchQueryChanged(ungroup(this.query, id));
  }

  /** A copy of the condition, under a new id, right after it. */
  private _handleConditionDuplicated(e: CustomEvent<{ id: string }>) {
    e.stopPropagation();
    this._dispatchQueryChanged(duplicateCard(this.query, e.detail.id, createCondition().id));
  }

  private _handleConditionRemoved(e: CustomEvent<{ id: string }>) {
    e.stopPropagation();
    this._dispatchQueryChanged(removeCard(this.query, e.detail.id));
  }

  // ─── Apply, Reset, Cancel, Close ──────────────────────────────────────────

  private _handleApply() {
    if (!this.data) return;
    // The finished count when it is for this query and data; else evaluated afresh, so a click
    // inside the debounce window applies what the rows say. The same gate as the button, for
    // callers that bypass the click: an unconfigured or unchanged query, or one that keeps no
    // protein or every protein, applies nothing.
    const counted =
      !this._counting && this._countedQuery === this.query && this._countedData === this.data;
    const result = counted ? this._matchedIndices : evaluateQuery(this.query, this.data);
    const total = this.data.protein_ids?.length ?? 0;
    if (applyBlock({ query: this.query, matched: result.size, total, dirty: this.dirty })) return;
    this._dispatch('query-apply', { matchedIndices: result });
  }

  private _handleReset() {
    this._dispatch('query-reset');
  }

  private _handleCancel() {
    if (this.dirty === false) return;
    this._dispatch('query-cancel');
  }

  private _handleClose() {
    this._dispatch('query-close');
  }

  /** Closes every row's open picker, for a host that hides the builder. */
  closePopups(): void {
    for (const row of this.renderRoot.querySelectorAll('protspace-query-condition-row')) {
      (row as HTMLElement & { closePickers(): void }).closePickers();
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  /** One list (the query or a group's): its items with a joiner pill between each two. */
  private _renderList(items: FilterQuery, numbers: ReadonlyMap<string, number>): unknown {
    return html`
      ${isMixed(items)
        ? html`<p class="mixed-note">
            ${icon('info', 14)}<span
              >Mixes “and” and “or”, read left to right: each joiner takes in everything above
              it.</span
            >
          </p>`
        : nothing}
      ${items.map(
        (item, index) => html`
          ${index > 0 ? this._renderJoiner(item, index, numbers) : nothing}
          ${this._renderItem(item, index, numbers)}
        `,
      )}
    `;
  }

  /** "and ⌄" / "or ⌄" between two items, and the "Group these?" prompt it may raise. */
  private _renderJoiner(
    item: FilterQueryItem,
    index: number,
    numbers: ReadonlyMap<string, number>,
  ) {
    const card = cardOf(item, false);
    const id = card ? card.condition.id : item.id;
    const n = card ? numbers.get(card.condition.id) : undefined;
    const label = n ? `Joiner for condition ${n}` : card ? 'Joiner' : 'Joiner for group';
    const text = isNegatedGroup(item) ? 'and not' : itemJoiner(item, index) === 'OR' ? 'or' : 'and';
    const prompt = this._joinerPrompt?.id === id ? this._joinerPrompt : null;
    return html`
      <div class="joiner">
        <ps-button
          class="joiner-pill"
          variant="ghost"
          size="sm"
          @click=${(e: Event) => this._openJoinerMenu(id, e)}
          ><span class="sr-only">${label}: </span>${text}<span slot="end"
            >${icon('chevron-down', 14)}</span
          ></ps-button
        >
      </div>
      ${prompt && !this._promptSheet
        ? html`<div class="joiner-prompt" role="group" aria-label="Group these?">
            <p>“and” and “or” together are read left to right. Group these?</p>
            <div class="joiner-prompt-actions">${this._promptButtons(prompt.joiner, false)}</div>
          </div>`
        : nothing}
    `;
  }

  /** Group these / Use "or" for all / Cancel, under the joiner or in the phone's sheet. */
  private _promptButtons(joiner: Joiner, sheet: boolean) {
    const word = joiner === 'OR' ? 'or' : 'and';
    return html`
      <ps-button
        class="joiner-prompt-group"
        slot=${sheet ? 'footer' : nothing}
        variant="primary"
        size=${sheet ? 'md' : 'sm'}
        ?autofocus=${sheet}
        @click=${() => this._resolvePrompt('group')}
        >Group these</ps-button
      >
      <ps-button
        slot=${sheet ? 'footer' : nothing}
        variant="secondary"
        size=${sheet ? 'md' : 'sm'}
        @click=${() => this._resolvePrompt('all')}
        >Use “${word}” for all</ps-button
      >
      ${sheet
        ? nothing
        : html`<ps-button variant="ghost" size="sm" @click=${() => this._resolvePrompt('cancel')}
            >Cancel</ps-button
          >`}
    `;
  }

  /** On a phone the prompt is a bottom sheet; its ✕, Escape and the scrim cancel it. */
  private _renderPromptSheet() {
    const prompt = this._promptSheet ? this._joinerPrompt : null;
    return html`<ps-dialog
      class="joiner-prompt-sheet"
      size="sheet"
      heading="Group these?"
      .open=${prompt !== null}
      @ps-close=${(e: Event) => {
        e.stopPropagation();
        this._resolvePrompt('cancel');
      }}
    >
      <p class="joiner-prompt-text">
        “and” and “or” together are read left to right. Group the conditions this joiner links, or
        use one joiner for all of them.
      </p>
      ${prompt ? this._promptButtons(prompt.joiner, true) : nothing}
    </ps-dialog>`;
  }

  /** A card, or the group the user built; the group "is none of" needs under "or" is a card. */
  private _renderItem(
    item: FilterQueryItem,
    index: number,
    numbers: ReadonlyMap<string, number>,
  ): unknown {
    const card = cardOf(item, index === 0);
    if (!card) return this._renderGroup(item as FilterGroup, numbers);
    const { condition } = card;
    return html`
      <protspace-query-condition-row
        .condition=${condition}
        .edited=${this._edited.has(condition.id)}
        .annotations=${this.annotations}
        .data=${this.data}
        .matchedIndices=${this._countBase(condition.id)}
        .number=${numbers.get(condition.id) ?? 0}
        @condition-changed=${this._handleConditionChanged}
        @operator-changed=${this._handleOperatorChanged}
        @condition-removed=${this._handleConditionRemoved}
        @condition-duplicated=${this._handleConditionDuplicated}
      ></protspace-query-condition-row>
    `;
  }

  /**
   * A card's count base (see `countBases`), or undefined while it waits for the count: a card
   * added since the last one. With nothing else configured the base is the whole dataset, known
   * without the count.
   */
  private _countBase(id: string): Set<number> | null | undefined {
    if (this._excludedMatchMap.has(id)) return this._excludedMatchMap.get(id);
    const others = leafConditions(this.query).filter((condition) => condition.id !== id);
    return hasConfiguredCondition(others) ? undefined : null;
  }

  private _renderGroup(group: FilterGroup, numbers: ReadonlyMap<string, number>) {
    const items = group.conditions;
    const joiners = new Set(items.map(itemJoiner).filter(Boolean));
    const inner = joiners.size === 1 ? [...joiners][0] : undefined;
    const label = inner === 'OR' ? 'Any of these' : inner === 'AND' ? 'All of these' : 'Group';
    const negated = isNegatedGroup(group);
    const name = inner ? `Group, joined with ${inner === 'OR' ? 'or' : 'and'}` : 'Group';
    return html`
      <div class="group-container" role="group" aria-label=${negated ? `${name}, negated` : name}>
        <div class="group-header">
          <span class="group-label">${label}</span>
          ${negated ? html`<span class="condition-badge">not</span>` : nothing}
          <ps-icon-button
            class="group-menu-trigger"
            icon="ellipsis"
            size="sm"
            label="Actions for group"
            @click=${(e: Event) => this._openGroupMenu(group.id, e)}
          ></ps-icon-button>
          <ps-icon-button
            class="group-remove"
            icon="x"
            size="sm"
            label="Remove group"
            @click=${() => this._dispatchQueryChanged(removeCard(this.query, group.id))}
          ></ps-icon-button>
        </div>
        ${this._renderList(items, numbers)}
        <ps-button
          class="add-group-condition"
          variant="ghost"
          size="sm"
          @click=${() => this._addConditionToGroup(group.id)}
          ><span slot="start">${icon('plus', 14)}</span>Add condition</ps-button
        >
      </div>
    `;
  }

  /** The joiner and group menus, one each, anchored to the pill or ⋯ that opened them. */
  private _renderMenus() {
    const current = this._joinerTarget ? this._joinerOf(this._joinerTarget.id) : undefined;
    const negated = this._groupTarget
      ? this._findGroup(this._groupTarget.id)?.logicalOp === 'NOT'
      : false;
    const changesResult =
      !negated && !!this._groupTarget && ungroupChangesResult(this.query, this._groupTarget.id);
    return html`
      <ps-menu
        label="Joiner"
        sheet
        .anchor=${this._joinerTarget?.anchor ?? null}
        .open=${this._joinerMenuOpen}
        @ps-select=${this._handleJoinerSelect}
        @ps-close=${(e: Event) => {
          e.stopPropagation();
          this._joinerMenuOpen = false;
        }}
      >
        <ps-menu-item type="radio" value="AND" ?checked=${current === 'AND'}
          >and<span slot="description">this and everything above must match</span></ps-menu-item
        >
        <ps-menu-item type="radio" value="OR" ?checked=${current === 'OR'}
          >or<span slot="description">this or everything above may match</span></ps-menu-item
        >
      </ps-menu>
      <ps-menu
        label="Actions for group"
        placement="bottom-end"
        sheet
        .anchor=${this._groupTarget?.anchor ?? null}
        .open=${this._groupMenuOpen}
        @ps-select=${this._handleGroupMenuSelect}
        @ps-close=${(e: Event) => {
          e.stopPropagation();
          this._groupMenuOpen = false;
        }}
      >
        <ps-menu-item value="ungroup" ?disabled=${negated || changesResult}
          >Ungroup${changesResult
            ? html`<span slot="description">would change which proteins match</span>`
            : nothing}</ps-menu-item
        >
      </ps-menu>
    `;
  }

  private _findGroup(id: string): FilterGroup | null {
    const find = (items: FilterQuery): FilterGroup | null => {
      for (const item of items) {
        if (!isFilterGroup(item)) continue;
        if (item.id === id) return item;
        const inner = find(item.conditions);
        if (inner) return inner;
      }
      return null;
    };
    return find(this.query);
  }

  render() {
    // The protein count of the data the last count ran on, so it agrees with the matches.
    const total = this._countedData?.protein_ids?.length ?? 0;
    const block = applyBlock({
      query: this.query,
      matched: this._counting ? null : this._matchedIndices.size,
      total,
      dirty: this.dirty,
    });
    // The number each condition is called by in the reason text, group leaves included.
    const numbers = new Map(leafConditions(this.query).map((leaf, index) => [leaf.id, index + 1]));
    const applied = this.appliedQuery;
    this._edited = applied ? queryChanges(this.query, applied).edited : new Set();
    const canReset =
      !applied ||
      hasConfiguredCondition(applied) ||
      hasConfiguredCondition(this.query) ||
      this.dirty === true;
    const matched = this._matchedIndices.size;
    const delta = this._counting ? null : this._delta;
    return html`
      <div class="query-builder">
        ${this.embedded
          ? nothing
          : html`<div class="query-header">
              <span class="query-title">Filter Query</span>
              <ps-icon-button
                class="btn-close"
                icon="x"
                label="Close filter query builder"
                @click=${this._handleClose}
              ></ps-icon-button>
            </div>`}

        <div class="query-conditions">
          ${this._renderList(this.query, numbers)}
          <div class="query-actions">
            <ps-button class="add-condition" @click=${this._addCondition}
              ><span slot="start">${icon('plus', 16)}</span>Add condition</ps-button
            >
            ${this.embedded
              ? nothing
              : html`<ps-button class="add-group" variant="ghost" size="sm" @click=${this.addGroup}
                  ><span slot="start">${icon('plus', 14)}</span>Add group</ps-button
                >`}
          </div>
        </div>

        ${this._renderMenus()} ${this._renderPromptSheet()}

        <div class="query-footer">
          <div class="match-line">
            <p class="match-count" role="status" aria-live="polite">
              ${total > 0
                ? html`<span class="match-number">${formatCount(matched)}</span
                    ><span class="match-total"
                      >${` of ${countNoun(total, 'protein', 'proteins')}`}</span
                    ><span class="sr-only">${' match'}</span>`
                : nothing}
            </p>
            ${delta
              ? html`<span class="match-delta"
                  >${delta < 0 ? '−' : '+'}${formatCount(Math.abs(delta))} since last edit</span
                >`
              : nothing}
          </div>
          <div class="match-bar" aria-hidden="true">
            <span style="width: ${total > 0 ? (100 * matched) / total : 0}%"></span>
          </div>
          <div class="query-footer-buttons">
            <ps-button
              class="query-footer-reset"
              variant="ghost"
              .disabled=${!canReset}
              @click=${this._handleReset}
              ><span slot="start">${icon('rotate-ccw', 16)}</span
              ><span class="reset-label">Reset</span></ps-button
            >
            <ps-button
              class="query-footer-cancel"
              variant="secondary"
              .disabled=${this.dirty === false}
              @click=${this._handleCancel}
              >Cancel</ps-button
            >
            <ps-button
              class="query-footer-apply"
              variant="primary"
              .disabled=${block !== null}
              @click=${this._handleApply}
              >Apply</ps-button
            >
          </div>
          <p id="apply-reason" class="apply-reason" aria-live="polite">
            ${block ? applyBlockText(block) : ''}
          </p>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-builder': ProtspaceQueryBuilder;
  }
}
