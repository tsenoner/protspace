## Context

`apps/protspace` (Python, shipped to PyPI) writes the bundles and settings that
`@protspace/utils` and `@protspace/core` (TypeScript) read. Several constants are written out
by hand on both sides, and three mechanisms keep them in step today:

1. **Regex over TypeScript source.** `test_style_warnings.py` parses `COLOR_SCHEMES`,
   `GRADIENT_COLOR_SCHEME_IDS` and `DEFAULT_NUMERIC_PALETTE_ID` out of `color-scheme.ts` and
   `numeric-binning.ts`. A prettier reflow or a refactor of those files breaks the test
   without any value changing. The test runs only when `protspace-ci.yml` runs, which is
   why that workflow watches two TypeScript files.
2. **The bundle contract suite** (`tests/contract`, unfiltered `bundle-contract.yml`).
   Python writes its missing-value tokens and its verdicts on probe spellings into the
   manifest, and vitest asserts that TypeScript agrees. It catches drift, but only after both
   files have been edited and CI has run.
3. **Comments**: "same order as the web frontend" on `KELLYS_COLORS`, "frontend internal key"
   on `NA_INTERNAL`, and no pin at all on `NA_PINNED_COLOR`, `ARROW_BOOLEAN_LABELS` or
   `ALLOWED_SHAPES`.

The repo already generates committed files and checks them with `--check`
(`docs/scripts/generate-annotations.mts` → `docs/guide/annotations.md`, run by
`pnpm precommit` and `ci.yml`). This change applies the same pattern to code.

Constraint: the wheel and sdist are built from `apps/protspace` alone, so the Python package
cannot read `packages/` or a repo-root file at build time or at run time.

## Goals / Non-Goals

**Goals:**

- Each shared constant is written once, with its rationale, in a language-neutral file.
- Each language reads it from a committed, generated module. A stale or hand-edited module
  fails `pnpm precommit` and a CI job that runs on every pull request.
- No import site changes. The existing names stay importable from where they are today.
- The regex-over-TypeScript tests are removed.

**Non-Goals:**

- Behaviour rules: how a cell is matched against the tokens, numeric inference, hit
  splitting, and id-column selection. These are code, and the contract suite keeps pinning
  them by running both implementations on the same inputs.
- Format-defining bundle constants: the part delimiter, the footer keys, and the container
  version. Every contract fixture already depends on them end to end, and changing one is a
  format-version event, not an edit.
- Changing any value. This is a pure refactor.

## Decisions

### Inventory: what moves and what stays

| Constant (Python name / TS name)                                                                        | Moves? | Why                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MISSING_VALUE_TOKENS` / same                                                                           | yes    | Wire: both readers' missing spellings                                                                                                     |
| `NA_INTERNAL` / `NA_VALUE` (`__NA__`)                                                                   | yes    | Wire: the settings key for the N/A category                                                                                               |
| `NA_PINNED_COLOR` / `NA_DEFAULT_COLOR` (`#DDDDDD`)                                                      | yes    | UI: Python colours a pinned N/A as the web would                                                                                          |
| `KELLYS_COLORS` / same                                                                                  | yes    | UI: Python assigns the web's slot colours, in order                                                                                       |
| `_CATEGORICAL_PALETTE_IDS`, `_GRADIENT_PALETTE_IDS` / `COLOR_SCHEMES` keys, `GRADIENT_COLOR_SCHEME_IDS` | yes    | Wire: `selectedPaletteId` values                                                                                                          |
| (none) / `DEFAULT_NUMERIC_PALETTE_ID`                                                                   | yes    | Must be a gradient id. Python pinned this by regex; the generator now checks it                                                           |
| `ARROW_BOOLEAN_LABELS` / literal `'true'`/`'false'` in `bundle-writer.ts`                               | yes    | Wire: the v3 label spelling of an Arrow `bool` column                                                                                     |
| `ALLOWED_SHAPES` / `PointShape`                                                                         | yes    | Wire: settings `shape` values (not in the original list, but the same kind of contract)                                                   |
| `CANONICAL_BOOLEANS` (`False`/`True`)                                                                   | no     | Python-only producer vocabulary. The web reads these as ordinary category strings                                                         |
| `NA_COLOR` (`#C0C0C0`), `_NA_LABELS`, `REST_MARKER`                                                     | no     | Python/Dash-only. (`NA_COLOR`'s `setdefault` branch cannot run, since those labels are already rekeyed to `__NA__`; noted as a follow-up) |
| `EVIDENCE_CODE_RE`, `_LEGACY_ID_CANDIDATES`, `ID_CANDIDATES`, sort modes                                | no     | Reader rules, not values. A regex shared as a string also invites dialect bugs                                                            |
| `PARQUET_BUNDLE_DELIMITER`, footer keys, container version                                              | no     | Format-defining, and pinned end to end by the contract fixtures                                                                           |

Of the roughly 19 "mirrors the web" comments under `src/protspace`, most describe behaviour
mirrored from `conversion.ts`/`bundle.ts`, which is the contract suite's territory. The data
ones are the rows marked "yes".

### Source format: JSON with a per-constant `kind` and `doc`

```json
"MISSING_VALUE_TOKENS": { "kind": "set", "doc": ["…"], "value": ["na", "…"] }
```

`kind` is `string`, `list` or `set`. That covers every shared constant and maps onto both
languages without ambiguity:

| kind     | Python      | TypeScript                |
| -------- | ----------- | ------------------------- |
| `string` | `str`       | literal `const`           |
| `list`   | `tuple`     | `readonly [...] as const` |
| `set`    | `frozenset` | `ReadonlySet<string>`     |

`doc` is a list of pre-wrapped lines. It is emitted as `#` comments in Python and as JSDoc in
TypeScript, so the rationale (for example why `__na__` is a token) lives next to the value,
not in one of the two copies.

Alternatives considered: TypeScript as the source, generating only Python. The web would
import the source directly, but the Python module would be generated from code that needs a
TS evaluator, and the source would not be neutral. YAML or TOML would need a parser
dependency, while JSON is native to both Node and Python.

### Palette ids are lists; colours stay in TypeScript except Kelly's

The source holds `CATEGORICAL_PALETTE_IDS` and `GRADIENT_PALETTE_IDS` as ordered lists, plus
`KELLYS_COLORS`. The other palettes' colours are used only by the web, so they stay in
`color-scheme.ts`. `COLOR_SCHEMES` is declared
`as const satisfies Record<PaletteId, readonly string[]>`, so TypeScript rejects both a
missing palette and an id the source does not list. The categorical/gradient split is now
explicit. The web used to define categorical as "every scheme that is not a gradient".

Alternative considered: moving every palette's colours into the source. That would put
about 100 web-only colour values into the Python package and lose the per-colour notes in
`color-scheme.ts`, without pinning anything else that is shared.

### One name per constant; existing names are re-exports

Both generated modules use the same names, taken from the web where the two sides differ
(`NA_VALUE`, `NA_DEFAULT_COLOR`). The old modules keep their names as re-exports
(`NA_INTERNAL = NA_VALUE`, `_GRADIENT_PALETTE_IDS = frozenset(GRADIENT_PALETTE_IDS)`,
`GRADIENT_COLOR_SCHEME_IDS = new Set<string>(GRADIENT_PALETTE_IDS)`,
`type PointShape = (typeof POINT_SHAPES)[number]`). No consumer changes its imports.
`tests/test_shared_constants.py` pins the Python re-exports to the generated module, so a
hand-written copy cannot quietly come back.

### Generator validates content, then writes; `--check` compares

`scripts/shared-constants/generate-shared-constants.mts` (run with `tsx`, linted and
type-checked with the other scripts):

1. Validates the structure: names are `UPPER_SNAKE`, kinds are known, values are strings or
   string arrays with no duplicates, and doc lines are at most 80 characters.
2. Validates invariants: tokens are trimmed and lower-case (the matcher compares
   trimmed, lower-cased cells, so anything else could never match); `NA_VALUE` lower-cased
   is a token; the palette lists are disjoint; `DEFAULT_NUMERIC_PALETTE_ID` is a gradient;
   `ARROW_BOOLEAN_LABELS` has exactly two entries (false, true).
3. Renders TypeScript and runs it through Prettier, using the repo config for that path.
   Renders Python in a fixed, ruff-format-stable style: collections are always exploded
   with a trailing comma, and strings are double-quoted.
4. Writes both files. With `--check`, it compares them instead and exits 1 naming the stale
   file and the command to run.

### Where the check runs

- `pnpm precommit` gains `pnpm shared-constants:check` next to `docs:annotations:check`.
- CI: a step in `bundle-contract.yml`. It is the one workflow with no path filter (it is
  meant to be a required check), so a hand edit to only the Python module fails there.
  `ci.yml` would miss that edit, because it ignores `apps/protspace/**`. `protspace-ci.yml`
  would miss an edit to only the TypeScript module.
- `protspace-ci.yml` drops `color-scheme.ts` and `numeric-binning.ts` from its paths, since
  no Python test reads them any more. A change to the JSON source changes the generated
  Python module, which is under `apps/protspace/**`, so Python CI still runs on it.

### The contract suite keeps its token-set comparison

That check now compares two values generated from one source, so it cannot fail on a
generator-clean tree. It stays anyway because it is the only check on the values each side
actually uses: a re-export replaced by a local literal would pass `--check` and still be
caught there. The verdict table, which tests behaviour, stays for the reason given under
Non-Goals.

## Risks / Trade-offs

- [Generated Python drifts from ruff format as ruff evolves] → The emitted style (exploded
  collections, magic trailing commas, double quotes) is ruff-format's fixed point, and
  `protspace-ci.yml`'s lint job runs `ruff format --check` on it, so a ruff change that
  disagrees fails loudly on the next Python PR instead of drifting.
- [A contributor edits a generated file] → `--check` fails in precommit and in the
  unfiltered CI job, naming the command to run. Each generated file starts with a
  do-not-edit header naming its source.
- [Someone adds a value to a re-export site instead of the source] → TypeScript re-exports
  are bindings, not copies. Python re-exports are pinned by `test_shared_constants.py`, and
  the missing tokens also by the contract suite.
- [The generator becomes the place for behaviour] → `contracts/README.md` states the rule:
  data only, and rules go to `tests/contract`.

## Migration Plan

This is a pure refactor and needs no data or user migration. Rollback is a revert.
Branched on #543, so it lands after it, rebased onto `main`.
