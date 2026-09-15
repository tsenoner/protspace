## Context

`add-ted-link` added TED beside UniProt and InterPro and explicitly deferred "replace all links
with a resource-descriptor array" as scope creep. That deferral assumed the row would stay as it
was. This change alters the row itself — a fourth entry, a shared affordance, a separator rule,
and wrapping — so the duplication now has to be edited four times to make one decision.

The header currently holds four things on one line with no hierarchy between them: a title that
is secretly an AlphaFold link, a muted accession, three muted links that look exactly like the
accession, and a close button.

## Goals / Non-Goals

**Goals:**

- One definition per destination: label, tooltip, and URL builder, in source order.
- Every destination presented identically, including AlphaFold.
- A visible signal that these links leave ProtSpace.
- A row that wraps instead of growing monolithically.

**Non-Goals:**

- Checking whether a destination has an entry for the selected protein. Destinations stay
  deterministic and unconditional; see "Why availability is still not checked".
- Changing any destination URL, the `target`/`rel` safety attributes, or the accession
  normalization in `header-links.ts`.
- Restyling anything else in the viewer.

## Decisions

### Define the row as an ordered descriptor list

Export `RESOURCE_LINKS` from `header-links.ts`, beside the builders it references, and render it
with one `.map()`. The module already owns per-resource knowledge; the template should not hold a
second, hand-maintained copy of it.

Alternatives considered:

- **Keep four hand-written anchors.** This is what `add-ted-link` chose, correctly, for a change
  that added one entry to a three-entry row. Here every anchor would have to gain the same
  affordance markup and the same separator handling, so the copies stop being incidental.

### Let CSS place the separators, trailing rather than leading

`.header-link:not(:last-child)::after` puts the middle dot after each link but the last, replacing
the hand-placed `<span class="header-link-separator">` elements. The separator stops being
something a future edit can forget or misplace.

It has to trail its link rather than lead the next one. The first attempt used
`.header-link + .header-link::before`, which reads more naturally, but a pseudo-element is part of
its own element's inline box: when the row wraps, a leading dot wraps with the link it precedes
and lands at the start of the new line. Confirmed in the running app at a 220 px sidebar, where
the second line began `· InterPro`. With `::after` the dot stays at the end of the line it belongs
to and a wrapped line starts on a label.

### Underline the label, not the anchor

`text-decoration` set on the anchor propagates into its descendants and cannot be cancelled by
them, so underlining `.header-link` drew the line under the external-link arrow and the separator
as well. The label gets its own `.header-link-label` span and carries the underline; the anchor
carries only colour. This is also what the row test asserts against, which is more precise than
stripping the decorative arrow out of `textContent`.

### Promote AlphaFold out of the title

The title becomes plain text and AlphaFold becomes the first entry in the row. A heading that is
also a link has no affordance and is not where anyone looks for a cross-reference; as a row entry
it is discoverable and consistent with its three peers.

### Why availability is still not checked

Unchanged from `add-ted-link`, and measured rather than assumed. The three probe endpoints are
all CORS-open and fast (`alphafold.ebi.ac.uk/api/domains` ~96 ms, `rest.uniprot.org` ~281 ms,
`ebi.ac.uk/interpro/api` ~217 ms), so feasibility is not the objection. Three arguments are:

- Links would settle ~250 ms after each selection, and ProtSpace users click through proteins
  quickly — the row would flicker continuously.
- A network failure is indistinguishable from "no entry", so an unreliable connection would hide
  links that work.
- ProtSpace never validates that a protein ID is a UniProt accession, so for a bundle with
  non-UniProt identifiers no probe makes any of these links meaningful.

Recorded because it is cheap to revisit: bundles carrying a `ted_domains` annotation already hold
TED presence per protein in memory, and the viewer already knows whether AlphaFold resolved. Both
are free signals if this is ever reopened.

## Risks / Trade-offs

- **A second row costs vertical space in a narrow sidebar** → The row is `0.75rem` text with no
  box model of its own; it replaces space the links already occupied on the title line.
- **`RESOURCE_LINKS` invites unrelated entries** → It is typed and ordered, and the row test
  asserts the full expected sequence, so an addition has to be deliberate.

## Migration Plan

None. No stored state, no URLs, and no public component API change.

## Open Questions

None.
