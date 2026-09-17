## Context

`<protspace-annotation-select>` is the app's canonical searchable dropdown: a trigger, a search box,
a grouped and filtered option list, arrow-key navigation, listbox ARIA. The query builder needed two
more of these — one to pick the annotation a condition filters on, one to pick its values — and both
were written by copying the reference's markup and stylesheet without its behaviour. They looked
right and answered only Escape.

The stylesheet had a subtler version of the same problem. `query-builder.styles.ts` was a bare `css`
block. It is adopted by four components, and only one of them — the control bar — lives in a shadow
root whose stylesheet already pulls in the design system's mixins. CSS custom properties inherit
across a shadow boundary, so the colours and spacing looked right everywhere; component classes do
not, so `.btn-primary` and friends simply did not exist in the row and picker shadow roots, and each
one had grown a hand-written mirror of whatever it needed.

## Goals / Non-Goals

**Goals:**

- Make the query builder's controls indistinguishable from the same controls elsewhere in the app,
  by reaching the design system rather than restating it.
- Give both pickers the keyboard and screen-reader behaviour the reference already had.
- State the listbox contract once, so the three implementations cannot drift apart again.
- Record the stylesheet-ordering constraint that composing the mixins turned out to depend on.

**Non-Goals:**

- Replacing the native `<select>`s with custom widgets. See Decisions.
- Extracting a shared picker _component_. The two pickers differ in ownership (one closes itself,
  one asks its parent to), in what a row means, and in whether entries can be locked out; only the
  keyboard contract is genuinely common, and that is what got extracted.
- Focus restoration on close, APG `role="group"` category wrappers, and repositioning the popovers
  on scroll. All three are real gaps; all three need changes outside these components.

## Decisions

**The native `<select>`s stay native.** Both carry a handful of options and no search. The platform
gives keyboard support, the mobile picker and screen-reader semantics for free; a custom
button-and-menu would be code written to lose all of that in exchange for pixel-identical borders.
They were restyled instead — and the actual user-visible bug, an orange focus ring, was that
`inputMixin`'s `select:focus` rule had never reached them.

**Reach the mixins through their own hooks, not through mirrors.** `inputMixin` matches
`select, input[type='text'], input[type='search'], .input-base`. The picker search inputs carried no
`type` at all, so nothing matched them and the sheet mirrored ~28 declarations instead. Adding
`type="text"` — what the reference component does — deletes the mirror. `type="search"` would also
match, but WebKit's search input adds a clear affordance and an Escape-clears-the-field behaviour
that would fight the dropdown's own Escape handling. The number inputs use `.input-base`, the hook
the mixin exposes for exactly this; widening the mixin to `input[type='number']` would restyle
number inputs in the legend, its settings dialog and the publish modal, which is a separate change.

**Extract the keyboard contract, not the component.** `handleListboxKeydown` in `dropdown-helpers`
takes a thunk for the option list, the current index and a setter, callbacks for select and escape,
and the selector/attribute pair used to find the hovered row. It sits beside `handleDropdownEscape`
and `scrollHighlightedIntoView`, which it uses and which the components were already importing. The
thunk matters: a keystroke that is neither an arrow nor Enter should not pay to re-group the
annotation list or re-walk the value counts, and every previous copy did.

**Hover does not drive the highlight.** The reference had already learned this and says so in a
comment — mirroring hover into the highlight index re-rendered every row the pointer crossed, and
the value picker's list is unvirtualized and as long as the annotation has distinct values. The
consequence is that the pointer and the keyboard can point at different rows, so `Enter` resolves
`:hover` first and falls back to the index. Both render identically, so the user cannot tell.

**Clamp the index rather than synchronising it.** The list shrinks under the stored index in three
different ways, and the value picker's multi-add behaviour makes one of them routine: selecting a
value removes it from the list while the picker stays open. Rather than resetting the index from
each of those places, `handleListboxKeydown` and the render both clamp against the current list.
That is one rule instead of three, and it cannot be forgotten at a fourth call site.

**Sheet order in `controlBarStyles` is load-bearing.** Lit's `finalizeStyles` deduplicates a
flattened style array in reverse and so keeps each sheet's _last_ position. Turning
`queryBuilderStyles` into `[tokens, buttonMixin, inputMixin, dropdownMixin, css…]` therefore moved
those four foundation sheets to wherever `queryBuilderStyles` appears — which was after `iconMixin`
and `layoutStyles`, the two sheets written to override them. `layoutStyles` and `dropdownMixin` both
declare `.filter-container, .export-container` at equal specificity, so the control bar's containers
silently changed from `display: inline-flex` to `display: flex; align-items: center`. Fixed by
listing `queryBuilderStyles` before them, with the constraint written down where it is depended on.

## Risks / Trade-offs

**A shared keyboard handler can become an options soup.** → Mitigated by keeping it to the contract
that is genuinely identical and leaving the differences at the call sites: the closed-trigger
Enter/Space branch, what Escape does, and whether rows can be locked out all stay in the components.
`Home`/`End` are deliberately absent, matching what all three did before.

**Reusing `.dropdown-item` and `.input-base` couples these components to the mixins.** → That is the
point, and it is the direction the rest of the control bar already goes. Both option lists keep
their existing class alongside the shared one, so unit and Playwright selectors are unaffected.

**The popovers still mirror `.dropdown-menu`'s surface.** → They are `position: fixed` at measured
coordinates so they can escape the condition list's scrolling clip context, which `.dropdown-menu`'s
absolute positioning cannot do. `info-popover` solves the identical problem the identical way, so
this is the house mechanism rather than a workaround. After adopting `.dropdown-item` the remaining
mirror is a handful of token references, which is low-drift; an `.is-anchored-fixed` modifier on the
mixin would inherit eight declarations and need four overridden, including a `min-width: 100%` that
resolves against the viewport under `position: fixed`.

## Open Questions

- Should closing a picker return focus to its trigger? It is a WCAG 2.4.3 gap, but fixing it only
  here would leave the reference component inconsistent, and the value picker's trigger belongs to
  its parent.
- Should the grouped option lists adopt APG's `role="group"` wrappers instead of
  `role="presentation"` headers? The current spelling keeps non-option content inside the listbox.
- Should the popovers reposition on scroll, as `info-popover` does? They measure once at open, so
  scrolling the condition list leaves them behind.
