# Cross-language contracts

`shared-constants.json` is the single source of the constants the Python package
(`apps/protspace`) and the web app (`packages/utils`, `packages/core`) must hold the same
value for: the missing-value tokens, the `__NA__` sentinel and its colour, Kelly's colours,
the palette ids, the point shapes, the labels of a boolean column, the column names the web
reader never shows as an annotation and the name of the protein ID column (`protein_id`).

`pnpm shared-constants` writes it into two committed modules, which each side re-exports
under its existing names:

- `packages/utils/src/generated/shared-constants.ts`
- `apps/protspace/src/protspace/_generated/shared_constants.py`. It lives inside the package
  because the PyPI wheel is built from `apps/protspace` alone and cannot read this file.

`pnpm shared-constants:check` fails when either module differs from what the JSON
generates. `pnpm precommit` runs it, and so does `bundle-contract.yml`, which runs on every
pull request. Never edit the generated modules; edit the JSON and regenerate.

## What belongs here

**Values only.** A constant goes here when both languages hold it and a difference would
break a bundle, its settings, or what the user sees. Each entry carries a `doc`: the reason
the value is what it is, written once for both languages.

**Rules do not.** How a cell is matched against the missing-value tokens, how a column is
judged numeric, or which column holds the protein ids is code, and a shared list cannot
keep two implementations of it in step. Those are pinned by running both sides on the same
inputs in the bundle contract suite (`tests/contract`).

The generator also checks invariants between values, for example that every missing-value
token is lower-case and that the numeric default is a gradient palette. Add one there when a
value must satisfy something for the code on either side to work.
