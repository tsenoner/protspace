# Navigating the Scatterplot

The scatterplot is the main visualization area where proteins appear as points. Learn how to navigate, select, and explore your data.

## Quick Reference

| Action              | How                                      |
| ------------------- | ---------------------------------------- |
| Zoom in/out         | Mouse wheel or pinch gesture             |
| Pan                 | Click + drag on background               |
| Reset view          | Double-click on background               |
| Select one          | Click a point                            |
| Add to selection    | **⌘/Ctrl** + click another point         |
| Box select          | Click **Select**, then drag a rectangle  |
| Lasso select        | Switch to lasso tool, then draw freeform |
| Clear selection     | Press **Escape** or click **Clear**      |
| Exit selection mode | Press **Escape** (when no selection)     |
| Focus search        | **⌘/Ctrl + K**                           |

## Navigation

![Zooming and panning](./images/zoom.gif)

- **Zoom**: Scroll wheel or pinch gesture
- **Pan**: Click and drag on the background
- **Reset**: Double-click the scatterplot to fit all proteins

## Selection

### Single & Multi-Select

![Single selection](./images/select-single.gif)

- **Click** a point to select it
- **⌘ + click** (Mac) or **Ctrl + click** (Windows) to add to selection
- Click the same point again to deselect it

### Box Selection

![Box selection](./images/select-box.gif)

1. Click the **Select** button in the control bar
2. Drag to draw a rectangle
3. All proteins inside are selected

### Lasso Selection

1. Click **Select** to enter selection mode
2. Click the **lasso** icon in the tool picker that appears
3. Click and drag to draw a freeform outline around proteins
4. Release to select all enclosed proteins

The lasso requires at least 3 points to form a valid selection area. Switch back to the **rectangle** icon at any time.

::: tip Additive Mode
When the **Select** button is active, all selections (clicks, box drags, and lasso draws) are additive. Without it, each new selection replaces the previous one.
:::

### Clearing

- Press **Escape** to clear selections (first press), then exit selection mode (second press)
- Click the **Clear** button

## Understanding the Display

### Point Position

Points close together have similar embeddings - often indicating similar structure, function, or evolutionary history.

### Point Colors

- **Categorical** (reviewed, protein family, species): Unique color per category
- **Multi-label** (EC numbers, domains): Pie charts showing multiple values

### Protein Tooltip

Hover over a point to see a tooltip with details about that protein:

- **Protein ID** and **UniProtKB ID** (if available)
- **Protein name** and **Gene name** (if available)
- **Annotation values** for the currently selected annotation
- **Scores** (for InterPro domain annotations, e.g., E-values) or **evidence codes** (for GO terms, subcellular location, etc., e.g., EXP, IDA)

Protein name, gene name, and UniProtKB ID are tooltip-only and don't appear in the [Annotation dropdown](/explore/control-bar#_2-annotation-selector).

### Duplicate Points

When multiple proteins share the exact same coordinates, a **count badge** appears on the point (when enabled in the legend settings). Click a stacked point to expand it into a spider layout showing each individual protein.

![Duplicate-count badges persist across projections](./images/duplicate-badges.gif)
