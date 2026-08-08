## Why

The preparation notebook keeps three dimensionality-reduction parameter cards on one row after their slider tracks have run out of usable width. Opening Colab's terminal or otherwise narrowing the notebook can therefore collapse each track to nearly zero pixels, making the controls difficult or impossible to use.

## What Changes

- Make parameter cards wrap before their slider tracks collapse under a compressed notebook viewport.
- Add a focused regression check for the minimum responsive card basis used by the preparation notebook.
- Verify the current-main reproduction at desktop and compressed widths with rendered `ipywidgets` controls.

## Capabilities

### New Capabilities

- `colab-preparation-controls`: Responsive layout requirements for dimensionality-reduction parameter controls in the Colab preparation notebook.

### Modified Capabilities

None.

## Impact

- `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`
- Focused Python regression coverage for the notebook layout contract
- No API, dependency, bundle-format, or application-runtime changes
