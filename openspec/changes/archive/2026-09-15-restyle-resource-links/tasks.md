## 1. Regression Coverage

- [x] 1.1 Extend the component test to assert the full resource row, AlphaFold first, and to
      assert the title carries no `href`.
- [x] 1.2 Cover `RESOURCE_LINKS` order and shape in the header-links unit tests.

## 2. Implementation

- [x] 2.1 Export `RESOURCE_LINKS` from `header-links.ts` beside the URL builders.
- [x] 2.2 Render the row from that list, with a shared external-link indicator.
- [x] 2.3 Move the resource row onto its own line and let CSS place the separators.
- [x] 2.4 Make the header title plain text.

## 3. Verification

- [x] 3.1 Run the affected package tests and the `pnpm precommit` gate.
- [x] 3.2 Update the Explore documentation and regenerate the structure-viewer screenshot.
- [x] 3.3 Verify the rendered row in the running app at full and narrow sidebar widths.
- [x] 3.4 Archive this change before the merge.
