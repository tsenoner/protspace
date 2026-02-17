# Annotation Styling

Custom colors, shapes, and display settings for annotation categories. Two approaches:

1. **Web UI** — interactive editing in [ProtSpace Web](https://protspace.app/explore), save to download the updated bundle
2. **CLI** — programmatic via `protspace-annotation-colors` (see [CLI Reference](cli.md#protspace-annotation-colors))

## Workflow

```bash
# 1. Generate a styles template (values in frequency order)
protspace-annotation-colors data.parquetbundle --generate-template > styles.json

# 2. Edit styles.json — fill in colors, adjust settings

# 3. Apply styles
protspace-annotation-colors data.parquetbundle styled.parquetbundle --annotation_styles styles.json

# 4. Optionally fine-tune in ProtSpace Web and save
```

## Styles JSON Format

Each top-level key is an annotation name. Within each annotation:

| Key                  | Type       | Default       | Description                                  |
| -------------------- | ---------- | ------------- | -------------------------------------------- |
| `colors`             | `{}`       | —             | Map of `value` to color (hex or rgba)        |
| `shapes`             | `{}`       | —             | Map of `value` to shape                      |
| `sortMode`           | `string`   | `"size-desc"` | Legend sort order (see below)                |
| `maxVisibleValues`   | `integer`  | `10`          | Max categories shown in the legend           |
| `shapeSize`          | `integer`  | `30`          | Marker size                                  |
| `hiddenValues`       | `string[]` | `[]`          | Categories hidden from the plot              |
| `selectedPaletteId`  | `string`   | `"kellys"`    | Color palette for unassigned categories      |

Only `colors` and/or `shapes` are required. All other keys are optional.

**Sort modes**: `size-desc` (most frequent first), `size-asc`, `alpha-asc`, `alpha-desc`, `manual`

**Shapes**: `circle`, `square`, `diamond`, `triangle-up`, `triangle-down`, `plus`

**Missing values**: `""`, `"<NA>"`, and `"NaN"` are normalized automatically — use any form in the styles file.

## Example

```json
{
  "major_group": {
    "maxVisibleValues": 6,
    "colors": {
      "Short-chain": "rgba(99, 203, 229, 0.6)",
      "Long-chain": "rgba(36, 99, 143, 0.7)",
      "Plesiotypic": "rgba(103, 189, 69, 0.4)",
      "Non-standard": "rgba(120, 142, 66, 0.9)",
      "Ly-6": "rgba(204, 221, 44, 0.5)",
      "<NA>": "rgba(192, 192, 192, 0.5)"
    },
    "shapes": {
      "Short-chain": "circle",
      "Long-chain": "square"
    }
  }
}
```

Empty color strings (`""`) are ignored — those categories use the web app's palette. Use `--generate-template` to get a pre-filled starting point with all values listed.
