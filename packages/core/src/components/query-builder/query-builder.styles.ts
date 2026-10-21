import { css, unsafeCSS } from 'lit';
import { COMPACT_MEDIA, PHONE_MEDIA } from '../../utils/breakpoints';
import { focusRing, srOnly } from '../kit/kit-shared.styles';

/**
 * The query builder's sheet, shared by the builder, its condition rows, the value picker and the
 * numeric input (each has its own shadow root). Every colour and type size reads a --ps-* token.
 *
 * A condition is a card: the annotation's name (it wraps, never truncates), its source badge and
 * a ⋯ menu on the first line, the operator and the values below, which is what a 240–480 px
 * sidebar panel needs. The two pickers stay `position: fixed` against a measured
 * trigger, so no ancestor of the Filter panel may get a transform, filter, contain or
 * container-type.
 */
export const queryBuilderStyles = [
  focusRing,
  srOnly,
  css`
    :host {
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      line-height: var(--ps-leading-tight);
      color: var(--ps-text);
    }

    button,
    select,
    input {
      font: inherit;
      color: inherit;
    }

    /* ── The builder ─────────────────────────────────────────────────────── */

    .query-builder {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: var(--ps-space-3);
    }

    .query-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .query-title {
      font-size: var(--ps-text-md);
      font-weight: var(--ps-weight-semibold);
    }

    .query-conditions {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: var(--ps-space-2);
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .query-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ps-space-1);
    }

    /* Add condition: a full-width dashed kit button at the end of the cards. */
    .add-condition {
      display: flex;
      align-self: stretch;
    }

    .add-condition::part(button) {
      width: 100%;
      border-style: dashed;
      color: var(--ps-text-muted);
    }

    .add-condition::part(button):hover {
      color: var(--ps-text);
    }

    .query-footer {
      container: query-footer / inline-size;
      display: flex;
      flex: none;
      flex-direction: column;
      gap: var(--ps-space-1-5);
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }

    /* "586 of 7,831 proteins", how the last edit moved it, and a thin share bar. */
    .match-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0 var(--ps-space-2);
    }

    .match-count,
    .match-delta,
    .apply-reason {
      margin: 0;
      font-size: var(--ps-text-sm);
      line-height: var(--ps-leading-normal);
      font-variant-numeric: tabular-nums;
    }

    .match-count {
      color: var(--ps-text-muted);
    }

    .match-number {
      color: var(--ps-text);
      font-size: var(--ps-text-xl);
      font-weight: var(--ps-weight-semibold);
      line-height: var(--ps-leading-tight);
    }

    .match-delta {
      color: var(--ps-text-muted);
      white-space: nowrap;
    }

    .match-bar {
      height: 4px;
      overflow: hidden;
      border-radius: var(--ps-radius-full);
      background: var(--ps-border);
    }

    .match-bar > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--ps-accent);
    }

    /* Room for one line even while empty, so the buttons do not jump when a reason appears. */
    .apply-reason {
      min-height: calc(var(--ps-text-sm) * var(--ps-leading-normal));
      color: var(--ps-text-muted);
    }

    .query-footer-buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .query-footer-reset {
      margin-inline-end: auto;
    }

    /* A 240 px sidebar fits Reset, Cancel and Apply on one line only with Reset as its icon. */
    @container query-footer (max-width: 232px) {
      .reset-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }

    /* A phone's panel leaves the cards about one card's height: each card snaps to the top as
       the list scrolls. */
    @media ${unsafeCSS(COMPACT_MEDIA)} {
      .query-conditions {
        scroll-snap-type: y proximity;
      }

      .query-conditions > :is(protspace-query-condition-row, .group-container, .query-actions) {
        scroll-snap-align: start;
      }
    }

    /* Upright, the panel is full width but short: the footer packs the count and the buttons
       onto one line, so the cards keep the height and Apply stays on screen. */
    @media ${unsafeCSS(PHONE_MEDIA)} {
      .query-builder {
        gap: var(--ps-space-2);
      }

      .query-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--ps-space-1) var(--ps-space-2);
      }

      .match-line {
        grid-area: 1 / 1;
        min-width: 0;
      }

      .match-number {
        font-size: var(--ps-text-lg);
      }

      .query-footer-buttons {
        grid-area: 1 / 2;
        flex-wrap: nowrap;
      }

      .match-bar,
      .apply-reason {
        grid-column: 1 / -1;
      }

      .apply-reason {
        min-height: 0;
      }

      .reset-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }

    /* ── Joiners and groups ──────────────────────────────────────────────── */

    /* "and ⌄" / "or ⌄" centred on a rule between two cards. */
    .joiner {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .joiner::before,
    .joiner::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--ps-border);
    }

    .joiner-pill::part(button) {
      gap: var(--ps-space-1);
      padding-inline: var(--ps-space-2) var(--ps-space-1-5);
      background: var(--ps-surface-hover);
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
    }

    .joiner-pill::part(button):hover {
      background: var(--ps-border);
    }

    .joiner-pill [slot='end'] {
      display: inline-flex;
      color: var(--ps-text-muted);
    }

    .joiner-prompt {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
      padding: var(--ps-space-2) var(--ps-space-3);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
    }

    .joiner-prompt p {
      margin: 0;
      font-size: var(--ps-text-sm);
    }

    .joiner-prompt-text {
      margin: 0;
      padding: var(--ps-space-3) var(--ps-space-5);
      line-height: var(--ps-leading-normal);
    }

    .joiner-prompt-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ps-space-2);
    }

    /* A list that already mixes "and" and "or" says how it reads instead of being rewritten. */
    .mixed-note {
      display: flex;
      align-items: flex-start;
      gap: var(--ps-space-1-5);
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
    }

    .mixed-note svg {
      flex: none;
      margin-top: 1px;
      color: var(--ps-warning);
    }

    .group-container {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
      padding: var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-muted);
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      padding-inline-start: var(--ps-space-1);
    }

    .group-label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-semibold);
    }

    .group-menu-trigger {
      margin-inline-start: auto;
    }

    .add-group-condition {
      align-self: flex-start;
    }

    /* ── A condition row ─────────────────────────────────────────────────── */

    /* The ⋯ menu comes last in the card's markup, so Tab reads name, operator, values, then ⋯;
       the grid still shows it at the end of the first line. */
    .condition-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--ps-space-2) var(--ps-space-1-5);
      box-sizing: border-box;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-2) var(--ps-space-3);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface);
    }

    /* Changed since the last Apply: an accent edge down the card's left side. */
    :host([edited]) .condition-row {
      box-shadow: inset 3px 0 0 var(--ps-accent);
    }

    .condition-head {
      grid-area: 1 / 1;
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      min-width: 0;
    }

    .condition-actions {
      grid-area: 1 / 2;
      align-self: start;
      display: flex;
      align-items: center;
    }

    .condition-badge {
      flex: none;
      padding: var(--ps-space-0-5) var(--ps-space-1-5);
      border-radius: var(--ps-radius-full);
      background: var(--ps-surface-hover);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-medium);
      line-height: var(--ps-leading-tight);
      white-space: nowrap;
    }

    .condition-values {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-1);
      min-width: 0;
    }

    /* The numeric input takes the card's full width under its name. */
    .condition-values > protspace-query-numeric-input {
      flex: 1 1 100%;
      min-width: 0;
    }

    /* The operator in words ("is any of ⌄"), which opens the operator menu. */
    .operator-pill {
      flex: none;
    }

    .operator-pill::part(button) {
      gap: var(--ps-space-1);
      padding-inline: var(--ps-space-2) var(--ps-space-1-5);
      background: var(--ps-surface-hover);
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
    }

    .operator-pill::part(button):hover {
      background: var(--ps-border);
    }

    .operator-pill [slot='end'] {
      display: inline-flex;
      color: var(--ps-text-muted);
    }

    /* The menu's "has any value" / "has no value" sit under a rule, apart from the comparisons. */
    .presence-operators {
      margin-top: var(--ps-space-1);
      padding-top: var(--ps-space-1);
      border-top: 1px solid var(--ps-border);
    }

    /* The card's title: the annotation's name, which opens the annotation picker. */
    .annotation-select-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1);
      box-sizing: border-box;
      min-width: 0;
      min-height: var(--ps-control-sm);
      margin-inline-start: calc(-1 * var(--ps-space-1));
      padding: var(--ps-space-0-5) var(--ps-space-1);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: none;
      color: var(--ps-text);
      font-weight: var(--ps-weight-semibold);
      text-align: left;
      cursor: pointer;
    }

    .annotation-select-trigger .dropdown-trigger-text {
      overflow: visible;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    /* An empty card: "Choose annotation" as a control. */
    .annotation-select-trigger.is-empty {
      margin-inline-start: 0;
      padding: 0 var(--ps-space-1-5) 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text-muted);
      font-weight: var(--ps-weight-medium);
    }

    .annotation-select-trigger:hover {
      background: var(--ps-surface-hover);
    }

    .annotation-select-trigger.is-empty:hover {
      border-color: var(--ps-border-control);
    }

    .dropdown-trigger-text,
    .dropdown-item-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .predicted-mark {
      display: inline-flex;
      flex: none;
      color: var(--ps-text-muted);
    }

    /* ── Value chips ─────────────────────────────────────────────────────── */

    .value-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-1);
      min-width: 0;
    }

    /* Chips wrap their text instead of truncating it: family names are long. */
    .value-chip {
      display: inline-flex;
      align-items: flex-start;
      gap: var(--ps-space-0-5);
      box-sizing: border-box;
      max-width: 100%;
      min-height: 22px;
      padding: 2px var(--ps-space-0-5) 2px var(--ps-space-2);
      border-radius: var(--ps-radius);
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-sm);
      line-height: 18px;
    }

    .value-chip-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .value-chip-remove {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      height: 18px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font-size: var(--ps-text-sm);
      line-height: 1;
      opacity: 0.7;
      cursor: pointer;
    }

    .value-chip-remove:hover {
      opacity: 1;
    }

    /* Touch: a 40 px target around the ×. The negative margins take back what it adds, so the
       chip stays 22 px tall and about as wide; the target overhangs it by 9 px above and below
       and 12 px to the right. The row's gaps match those overhangs, so no target reaches into a
       neighbouring chip, where a press would remove the wrong value. */
    @media (pointer: coarse) {
      .annotation-select-trigger {
        min-height: var(--ps-touch-target);
      }

      .value-chips {
        column-gap: var(--ps-space-3);
        row-gap: calc(var(--ps-touch-target) - 22px);
      }

      .value-chip-remove {
        align-self: center;
        min-width: var(--ps-touch-target);
        min-height: var(--ps-touch-target);
        margin-block: calc((var(--ps-touch-target) - 18px) / -2);
        margin-inline: -12px calc(-12px - var(--ps-space-0-5));
      }
    }

    /* ── The annotation and value pickers ────────────────────────────────── */

    .numeric-field {
      box-sizing: border-box;
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
    }

    .numeric-field:hover {
      border-color: var(--ps-border-control);
    }

    .numeric-field::placeholder {
      color: var(--ps-text-muted);
    }

    /* Inside a tight box the ring sits on the border rather than 2 px outside it. */
    .numeric-field:focus-visible {
      outline-offset: -1px;
    }

    .value-picker-list {
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 15rem;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    /* The annotation picker, inside a ps-popover: under the card's header, or a phone's bottom
       sheet (docked). Sections per source, like the Color by picker. */
    .annotation-picker {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: min(320px, calc(100vw - 16px));
      max-height: min(440px, var(--available-height, 440px));
    }

    ps-popover[docked] .annotation-picker {
      width: 100%;
      max-height: calc(min(85dvh, 100dvh - 48px) - 20px - env(safe-area-inset-bottom, 0px));
    }

    .annotation-picker-title {
      flex: none;
      margin: 0;
      padding: var(--ps-space-1) var(--ps-space-3) 0;
      color: var(--ps-text);
      font-size: var(--ps-text-md);
      font-weight: var(--ps-weight-semibold);
    }

    ps-popover:not([docked]) .annotation-picker-title {
      display: none;
    }

    .annotation-picker .value-picker-search {
      border-bottom: 1px solid var(--ps-border);
    }

    .annotation-picker-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 var(--ps-space-1) var(--ps-space-1);
      scrollbar-width: thin;
    }

    .annotation-picker-section {
      display: flex;
      flex-direction: column;
    }

    /* Each section after the first starts on a divider. */
    .annotation-picker-section + .annotation-picker-section {
      margin-top: var(--ps-space-1);
      border-top: 1px solid var(--ps-border);
    }

    /* Group labels read like ps-menu-label; they stay in view while their section scrolls. */
    .annotation-picker-category {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1);
      background: var(--ps-surface-raised);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* The options carry no tabindex: focus stays in the search input and .highlighted is the
       keyboard cursor (aria-activedescendant). */
    .annotation-picker-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      min-height: var(--ps-row);
      padding: var(--ps-space-1) var(--ps-space-2) var(--ps-space-1) var(--ps-space-1);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-text);
      cursor: pointer;
    }

    .annotation-picker-item:hover,
    .annotation-picker-item.highlighted {
      background: var(--ps-surface-hover);
    }

    .annotation-picker-item.highlighted {
      box-shadow: inset 0 0 0 1px var(--ps-border-strong);
    }

    .annotation-picker-item[aria-selected='true'] {
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
    }

    /* The name wraps rather than truncating. */
    .annotation-picker-item .dropdown-item-label {
      flex: 0 1 auto;
      overflow: visible;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .annotation-picker-item[aria-selected='true'] .dropdown-item-label {
      font-weight: var(--ps-weight-medium);
    }

    .annotation-picker-check {
      display: inline-flex;
      flex: none;
      width: 14px;
    }

    /* What the annotation holds sits at the row's end; the predicted mark stays by the name. */
    .annotation-picker-kind {
      margin-left: auto;
    }

    .annotation-picker-count {
      flex: none;
      margin-left: auto;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .annotation-picker-empty {
      margin: 0;
      padding: var(--ps-space-3);
      color: var(--ps-text-muted);
      overflow-wrap: anywhere;
      text-align: center;
    }

    @media (pointer: coarse) {
      .annotation-picker-item {
        min-height: var(--ps-touch-target);
      }
    }

    @media (forced-colors: active) {
      .dropdown-item.highlighted,
      .value-picker-item.highlighted {
        outline: 1px solid Highlight;
      }
    }

    /* ── The checkbox value list (inside a ps-popover) ───────────────────── */

    .value-picker {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: min(320px, calc(100vw - 16px));
      max-height: min(440px, var(--available-height, 440px));
    }

    /* On a phone the list is a bottom sheet (ps-popover's docked): full width, a title, and the
       rows take the height the sheet leaves. */
    .value-picker-title {
      flex: none;
      margin: 0;
      padding: var(--ps-space-1) var(--ps-space-3) 0;
      color: var(--ps-text);
      font-size: var(--ps-text-md);
      font-weight: var(--ps-weight-semibold);
    }

    ps-popover:not([docked]) .value-picker-title {
      display: none;
    }

    ps-popover[docked] .value-picker {
      width: 100%;
      max-height: calc(min(85dvh, 100dvh - 48px) - 20px - env(safe-area-inset-bottom, 0px));
    }

    ps-popover[docked] .value-picker .value-picker-list {
      max-height: none;
    }

    .value-picker-search {
      position: relative;
      flex: none;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1-5);
      color: var(--ps-text-muted);
    }

    .value-picker-search .ps-icon {
      position: absolute;
      top: 50%;
      left: calc(var(--ps-space-2) + var(--ps-space-2));
      translate: 0 -40%;
      pointer-events: none;
    }

    .value-picker-input {
      box-sizing: border-box;
      width: 100%;
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2) 0 calc(var(--ps-space-2) + 20px);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
    }

    .value-picker-input:hover {
      border-color: var(--ps-border-control);
    }

    .value-picker-input::placeholder {
      color: var(--ps-text-muted);
    }

    .value-picker-input:focus-visible {
      outline-offset: -1px;
    }

    .value-picker-tools {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--ps-space-0-5);
      padding: 0 var(--ps-space-2) var(--ps-space-1-5);
      border-bottom: 1px solid var(--ps-border);
    }

    .value-picker-tools-gap {
      flex: 1;
    }

    .value-picker .value-picker-list {
      position: relative;
      display: block;
      flex: 1 1 auto;
      min-height: 96px;
      max-height: 320px;
      padding: 0;
      overscroll-behavior: contain;
    }

    .value-picker-spacer {
      position: relative;
    }

    .value-picker-section,
    .value-picker-item {
      position: absolute;
      right: 0;
      left: 0;
      box-sizing: border-box;
      height: 36px;
    }

    .value-picker-section {
      display: flex;
      align-items: flex-end;
      padding: 0 var(--ps-space-3) var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .value-picker-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      padding: 0 var(--ps-space-3) 0 var(--ps-space-2);
      color: var(--ps-text);
      cursor: pointer;
    }

    .value-picker-item:hover,
    .value-picker-item.highlighted {
      background: var(--ps-surface-hover);
    }

    .value-picker-item.highlighted {
      box-shadow: inset 2px 0 0 var(--ps-accent);
    }

    .value-picker-check {
      display: inline-grid;
      flex: none;
      place-items: center;
      box-sizing: border-box;
      width: 16px;
      height: 16px;
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface);
      color: var(--ps-text-on-accent);
    }

    .value-picker-check .ps-icon {
      width: 12px;
      height: 12px;
      stroke-width: 2.5;
    }

    .is-checked .value-picker-check {
      border-color: var(--ps-accent);
      background: var(--ps-accent);
    }

    .value-picker-label {
      display: -webkit-box;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font-size: var(--ps-text-base);
      line-height: 1.2;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .value-picker-highlight {
      background: none;
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-semibold);
    }

    .value-picker-count {
      flex: none;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .value-picker-bar {
      flex: none;
      width: 36px;
      height: 4px;
      overflow: hidden;
      border-radius: var(--ps-radius-full);
      background: var(--ps-surface-hover);
    }

    .value-picker-bar b {
      display: block;
      height: 100%;
      background: var(--ps-border-strong);
    }

    .is-checked .value-picker-bar b {
      background: var(--ps-accent);
    }

    /* Locked out while the "Any value" sentinel is selected (it subsumes them). */
    .value-picker-item.is-disabled,
    .value-picker-item.is-disabled:hover,
    .value-picker-item.is-disabled.highlighted {
      background: none;
      color: var(--ps-text-faint);
      cursor: not-allowed;
    }

    .value-picker-empty {
      margin: 0;
      padding: var(--ps-space-3);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      text-align: center;
    }

    .value-picker-footer {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--ps-space-2);
      padding: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }

    .value-picker-summary {
      flex: 1;
      min-width: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
    }

    @media (pointer: coarse) {
      .value-picker-tools ps-button,
      .value-picker-footer ps-button {
        min-height: var(--ps-touch-target);
      }

      /* Keep in step with lineHeight() in query-value-picker.ts. */
      .value-picker-section,
      .value-picker-item {
        height: 44px;
      }

      .numeric-field {
        height: var(--ps-touch-target);
      }
    }

    /* ── The numeric input ───────────────────────────────────────────────── */

    .numeric-input {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
    }

    /* ~40 bins of the annotation: a bar the chosen range overlaps takes the accent, the rest
       stay grey; with no limit set every bar is in the range. */
    .numeric-histogram {
      display: flex;
      align-items: flex-end;
      gap: 1px;
      height: 36px;
      margin-inline: var(--ps-space-2);
    }

    .numeric-histogram i {
      flex: 1;
      border-radius: 1px 1px 0 0;
      background: var(--ps-border-strong);
    }

    .numeric-histogram i.in {
      background: var(--ps-accent);
    }

    /* "60 to 120 aa   2,525" stays on one line however narrow the card: the fields shrink. */
    .numeric-bounds {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--ps-space-1);
      min-width: 0;
    }

    .numeric-field {
      flex: 1 1 0;
      width: 0;
      min-width: 3.5em;
      max-width: 96px;
    }

    .numeric-dash,
    .numeric-unit {
      flex: none;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
    }

    .numeric-match-count {
      flex: none;
      margin-left: auto;
      padding-left: var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* Only the box and its words take the click, not the empty width beside them. */
    .numeric-na {
      align-self: flex-start;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
    }

    /* A phone's card fits its short panel: no histogram, and the count moves beside
       the N/A box. Where the card is wide enough (upright), the slider sits between the typed
       bounds; in the narrow side panel (on its side) it takes its own line above them. The
       container is the input's own box, which holds no fixed-position picker. */
    .numeric-input.compact {
      container: numeric-input / inline-size;
    }

    .numeric-input.compact .numeric-bounds {
      flex-wrap: wrap;
    }

    .numeric-input.compact protspace-query-range-slider {
      flex: 1 1 100%;
      order: -1;
      min-width: 0;
    }

    @container numeric-input (min-width: 300px) {
      .numeric-input.compact .numeric-bounds {
        flex-wrap: nowrap;
      }

      .numeric-input.compact protspace-query-range-slider {
        flex: 1 1 auto;
        order: 0;
      }

      .numeric-input.compact .numeric-field {
        flex: none;
        width: 4.5em;
        min-width: 0;
      }

      .numeric-input.compact protspace-query-range-slider + .numeric-dash {
        display: none;
      }
    }

    .numeric-na-line {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .numeric-na-line .numeric-na {
      align-self: center;
    }

    /* A phone's numeric card is tighter. (No container query here: the row holds the
       fixed-position pickers.) */
    @media ${unsafeCSS(COMPACT_MEDIA)} {
      .condition-row.is-numeric {
        row-gap: var(--ps-space-1);
        padding-block: var(--ps-space-1);
      }
    }
  `,
];

/** The builder's own host fills the panel that holds it; the rows and pickers sharing the sheet above do not. */
export const queryBuilderHostStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Embedded in the app's Filter panel, whose body already pads its content. */
  :host([embedded]) .query-builder {
    padding: 0;
  }
`;
