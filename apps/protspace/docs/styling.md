# Annotation Styling

Custom colors, shapes, and legend settings for annotation categories.

**Two approaches:**

- **Web UI** — interactive editing in [ProtSpace Web](https://protspace.app/explore), save to download the updated bundle
- **CLI** — programmatic via `protspace style` (see [CLI Reference](cli.md#protspace-style))

## Workflow

```bash
# 1. Generate a styles template (values listed in frequency order)
protspace style data.parquetbundle --generate-template > styles.json

# 2. Edit styles.json — fill in colors, adjust settings

# 3. Apply styles to produce a new bundle
protspace style data.parquetbundle styled.parquetbundle --annotation-styles styles.json

# 4. Verify stored settings
protspace style styled.parquetbundle --dump-settings
```

## Numeric annotations

**`protspace style` is categorical-only.** Every value is treated as a discrete category, so the workflow above is meant for categorical columns (e.g. `major_group`, `ec`, `superfamily`). Applying it to a **numeric** column (`length`, pLDDT, a score) does not do what you expect:

- `--generate-template` lists **every distinct number as its own category** — hundreds to thousands of rows to hand-color.
- `colors` / `shapes` / `pinnedValues` only match values by exact string, so a range like `"200-300"` or an interpolated `"3.5"` raises `Value '…' does not exist`.
- There is no continuous colormap, binning, or range-legend concept on the CLI side.

`protspace style` now emits a **warning** when it detects a numeric column, naming it and its distinct-value count.

**Two ways to color a numeric column instead:**

1. **Pre-bin into categorical strings** before styling — turn the numbers into range-label strings (e.g. `"100-200"`, or fixed/quantile buckets), then style the binned column like any other categorical.
2. **Use the web app's continuous gradient** — [ProtSpace Web](https://protspace.app/explore) content-sniffs numeric columns and bins them client-side into a sequential gradient (`batlow` default; also viridis / cividis / inferno / plasma). The binning strategy and reverse-gradient toggle live in the UI only.

If you *do* pass CLI styling keys for a numeric column, the web frontend reinterprets them: `colors` / `shapes` / `pinnedValues` are **ignored** (bin IDs never match your per-value keys), `maxVisibleValues` becomes the **target bin count**, and `selectedPaletteId` is reset unless it is one of the five gradient IDs (markers are always circles). See the [ProtSpace Web legend docs](https://github.com/tsenoner/protspace/blob/main/docs/explore/legend.md) for the numeric legend behavior.

## Styles JSON format

Top-level keys are annotation names. Each annotation accepts the keys below.

| Key                 | Type     | Default       | Stored | Description                                                                                      |
| ------------------- | -------- | ------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `colors`            | `{}`     | —             | yes    | `{value: color}` — hex (`#FF0000`) or rgb (`rgb(255,0,0)`). Empty strings are ignored.           |
| `shapes`            | `{}`     | —             | yes    | `{value: shape}` — one of `circle`, `square`, `diamond`, `triangle-up`, `triangle-down`, `plus`. |
| `sortMode`          | string   | `"size-desc"` | yes    | Legend sort: `size-desc`, `size-asc`, `alpha-asc`, `alpha-desc`, `manual`.                       |
| `maxVisibleValues`  | int      | `10`          | yes    | Legend entries shown before the "Other" bucket.                                                  |
| `shapeSize`         | int      | `30`          | yes    | Marker size in the scatter plot.                                                                 |
| `hiddenValues`      | string[] | `[]`          | yes    | Categories hidden from the plot.                                                                 |
| `selectedPaletteId` | string   | `"kellys"`    | yes    | **Categorical** palette for categories without explicit colors — one of the six IDs in [Color palettes](#color-palettes). A gradient or unknown value silently falls back to `kellys`.                    |
| `pinnedValues`      | string[] | —             | no     | Ordered list of values for legend positions 0..N-1. See [Legend ordering](#legend-ordering).     |
| `zOrderSort`        | string   | —             | no     | Sort mode for zOrder assignment only (overrides `sortMode` for zOrder computation).              |

**Stored** keys are persisted in the output bundle. **Non-stored** (processing-only) keys are consumed during generation — only their effects (the resulting categories with `zOrder`, `color`, `shape`) are written.

> **Value keys are display values.** In `colors`/`shapes`/`pinnedValues`/`hiddenValues`, a *value* is the human-readable category as `--generate-template` lists it and as the legend shows it — the percent-decoded name with any `|score` suffix trimmed, not the raw wire cell. A template therefore round-trips even when a name legitimately contains `;`, `|`, or `%` (bundle format v2 percent-encodes those on the wire; see [Annotation Reference](annotations.md#encoding-bundle-format-v2)).

### N/A values

Missing values (`""`, `"<NA>"`, `"NaN"`) are normalized automatically — use any form in the styles file. In the output bundle N/A is stored with the key `__NA__` (the frontend's internal format).

### Example: custom colors and shapes

```json
{
  "major_group": {
    "maxVisibleValues": 6,
    "colors": {
      "Short-chain": "#63CBE5",
      "Long-chain": "#24638F",
      "<NA>": "#C0C0C0"
    },
    "shapes": {
      "Short-chain": "circle",
      "Long-chain": "square"
    }
  }
}
```

## Color palettes

ProtSpace ships eleven built-in palettes, split by data type: **six categorical** palettes (discrete colors, one per category) and **five numeric gradients** (a continuous sequential scale). The two sets do not overlap and are not interchangeable — a numeric column can only use a gradient, and a categorical column can only use a categorical palette.

The palettes are defined in the web frontend, the single source of truth: [`color-scheme.ts`](https://github.com/tsenoner/protspace/blob/main/packages/utils/src/visualization/color-scheme.ts) (`COLOR_SCHEMES`) and [`numeric-binning.ts`](https://github.com/tsenoner/protspace/blob/main/packages/utils/src/visualization/numeric-binning.ts) (`GRADIENT_COLOR_SCHEME_IDS`).

### Categorical palettes (`selectedPaletteId`)

Used for categorical annotations, for the "Other" bucket, and for cluster legends. Settable from the CLI via the `selectedPaletteId` key.

| ID           | Name           | Notes                        |
| ------------ | -------------- | ---------------------------- |
| `kellys`     | Kelly's Colors | Maximum contrast (**default**) |
| `okabeIto`   | Okabe-Ito      | Colorblind-safe              |
| `tolBright`  | Tol Bright     | Colorblind-safe              |
| `set2`       | Set2           | General-purpose categorical  |
| `dark2`      | Dark2          | General-purpose categorical  |
| `tableau10`  | Tableau 10     | General-purpose categorical  |

### Numeric gradients

Used for numeric annotations (see [Numeric annotations](#numeric-annotations)). The frontend bins the numbers and colors the bins along the gradient.

| ID        | Name    | Notes                                    |
| --------- | ------- | ---------------------------------------- |
| `batlow`  | Batlow  | Scientific sequential gradient (**default**) |
| `viridis` | Viridis | Perceptually uniform sequential gradient |
| `cividis` | Cividis | Colorblind-friendly sequential gradient  |
| `inferno` | Inferno | High-contrast sequential gradient        |
| `plasma`  | Plasma  | Vivid sequential gradient                |

> **`selectedPaletteId` behaves differently per column type.** For a **categorical** column it picks the categorical palette, and a gradient or unknown ID silently resets to `kellys`. For a **numeric** column the frontend instead reads `selectedPaletteId` as the gradient: a gradient ID (`batlow` / `viridis` / `cividis` / `inferno` / `plasma`) is used as-is, and a categorical or unknown ID resets to `batlow`. What `protspace style` cannot set for a numeric column is the **binning** — the strategy and reverse-gradient toggle live in the per-annotation `numericSettings` object, which is UI-only. `protspace style` warns when `selectedPaletteId` is a gradient or unknown ID **on a categorical column** (where it would reset to `kellys`).

## Legend ordering

By default (`sortMode: "size-desc"`), legend items are sorted by frequency with N/A sorted by its count like any other category. To control which values appear and in what order, use `pinnedValues` with `sortMode: "manual"`.

### How `pinnedValues` works

- Each value in the list receives a `zOrder` starting from 0. **Only pinned values** are written into the bundle's categories — the frontend treats everything else as "Other".
- `sortMode: "manual"` tells the frontend to sort legend items by `zOrder` (i.e., the order you defined).
- `maxVisibleValues` must match the number of pinned values. Example: 12 families + N/A = 13 entries requires `maxVisibleValues: 13`.
- Colors are auto-assigned from Kelly's 21 Colors of Maximum Contrast when no explicit `colors` are provided. N/A gets a lighter gray (`#DDDDDD`).
- Use `""` for N/A in `pinnedValues`.

### `__REST__` auto-fill marker

Instead of listing every value, use `"__REST__"` as a placeholder that expands to the top values by frequency (sorted by `zOrderSort`), filling up to `maxVisibleValues`.

**Top 9 by frequency + N/A at end** (default `maxVisibleValues=10`):

```json
{
  "ec": {
    "sortMode": "manual",
    "zOrderSort": "size-desc",
    "pinnedValues": ["__REST__", ""]
  }
}
```

**Pin specific values + auto-fill + N/A:**

```json
{
  "protein_families": {
    "maxVisibleValues": 13,
    "sortMode": "manual",
    "zOrderSort": "size-desc",
    "pinnedValues": ["familyA", "familyB", "__REST__", ""]
  }
}
```

Here `familyA` gets zOrder 0, `familyB` zOrder 1, the next 10 top-frequency values fill slots 2–11, and N/A gets slot 12.

### `zOrderSort`

Decouples zOrder assignment from the stored `sortMode`. Useful pattern: `zOrderSort: "size-desc"` computes frequency-based zOrders, while `sortMode: "manual"` tells the frontend to display in that order. Without `zOrderSort`, zOrder assignment falls back to `sortMode`.

## Value preprocessing

Raw annotation values are preprocessed to match the ProtSpace web frontend **before** settings are applied. **All settings (including `pinnedValues`) must use display names** (after preprocessing).

| Delimiter     | Behavior                                                                                                                                          | Example                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pipe `\|`     | Part after `\|` is a source tag — trimmed for display. Multiple raw variants with the same display name merge into one entry with combined count. | `"familyA\|IC"` → `"familyA"`                     |
| Semicolon `;` | Multi-label split — each part becomes a separate entry. The protein counts toward all resulting categories.                                       | `"familyA;familyB"` → `"familyA"` and `"familyB"` |

Combined: `"familyA|IC;familyB|SAM"` → split by `;` → `"familyA|IC"`, `"familyB|SAM"` → trim `|` → `"familyA"`, `"familyB"`.
