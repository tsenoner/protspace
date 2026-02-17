# Annotation Styling

Custom colors, shapes, and legend settings for annotation categories.

**Two approaches:**

- **Web UI** — interactive editing in [ProtSpace Web](https://protspace.app/explore), save to download the updated bundle
- **CLI** — programmatic via `protspace-annotation-colors` (see [CLI Reference](cli.md#protspace-annotation-colors))

## Workflow

```bash
# 1. Generate a styles template (values listed in frequency order)
protspace-annotation-colors data.parquetbundle --generate-template > styles.json

# 2. Edit styles.json — fill in colors, adjust settings

# 3. Apply styles to produce a new bundle
protspace-annotation-colors data.parquetbundle styled.parquetbundle --annotation_styles styles.json

# 4. Verify stored settings
protspace-annotation-colors styled.parquetbundle --dump-settings
```

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
| `selectedPaletteId` | string   | `"kellys"`    | yes    | Color palette for categories without explicit colors.                                            |
| `pinnedValues`      | string[] | —             | no     | Ordered list of values for legend positions 0..N-1. See [Legend ordering](#legend-ordering).     |
| `zOrderSort`        | string   | —             | no     | Sort mode for zOrder assignment only (overrides `sortMode` for zOrder computation).              |

**Stored** keys are persisted in the output bundle. **Non-stored** (processing-only) keys are consumed during generation — only their effects (the resulting categories with `zOrder`, `color`, `shape`) are written.

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
