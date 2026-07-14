# Importing Data

ProtSpace uses `.parquetbundle` files containing protein embeddings and annotations.

## Drag and Drop (Recommended)

The easiest way to load data:

1. Locate your `.parquetbundle` file on your computer
2. Drag it onto the scatterplot canvas
3. Drop when you see the drop indicator
4. Data loads automatically

::: tip Drop Anywhere
You can drop the file anywhere on the scatterplot area - it doesn't need to be a specific location.
:::

## Import Button

Alternatively, use the **Import** button in the control bar:

1. Click the **Import** button in the top-right corner
2. Select your `.parquetbundle` file from the file picker
3. Click **Open**

## Example Datasets

Don't have data yet? Download example `.parquetbundle` files from the [GitHub data folder](https://github.com/tsenoner/protspace/tree/main/apps/web/public/data).

## What Happens When You Load Data

After successfully loading a file:

1. **Scatterplot populates**: All proteins appear as colored points
2. **View restored or initialized**: ProtSpace restores the requested URL annotation and projection when they exist in the dataset; otherwise it falls back to the first available options
3. **Settings restored**: Previously saved or bundled customizations are applied
4. **Legend appears**: Shows all categories with color assignments
5. **Ready to explore**: You can now pan, zoom, and interact with the data

::: info Loading Time
Small datasets (< 10K proteins) load instantly. Larger datasets may take a few seconds to process and render.
:::

## Data & Settings Persistence

All persistence is local to your browser — **your data is never sent to a server**.

- **Your dataset is remembered**: The last imported file is saved in your browser's Origin Private File System (OPFS) and automatically restored when you revisit ProtSpace. Switching to the demo dataset clears the stored file.
- **Settings persist per dataset**: Legend customizations (colors, shapes, hidden categories, sort order) and export options are saved in browser storage for each dataset. When you reload or revisit the same dataset, your settings are restored.
- **Annotation and projection persist in the URL**: ProtSpace keeps the currently selected annotation and projection in the page URL as query parameters (`annotation=...` and `projection=...`). Refreshing the page, using the browser's back/forward buttons, or sharing the link will restore the same view when those options exist in the active dataset. A bare `/explore` URL stays unchanged on first load; ProtSpace only writes view params after you change the selection or when it needs to normalize an invalid URL value.
- **File-embedded settings take priority**: If a `.parquetbundle` includes saved settings (via the export dialog's "Include legend/export settings" options), those are applied on import, replacing any previously stored settings for that dataset.
- **Starting fresh**: To reset all settings for a dataset, re-import a `.parquetbundle` that has embedded settings, or clear site data in your browser settings.

::: info URL-backed view state
If the URL points to an annotation or projection that does not exist in the currently loaded dataset, ProtSpace falls back to the closest valid view and updates the URL to match.
:::

::: warning Automatic dataset restore requires OPFS
ProtSpace uses the Origin Private File System (OPFS) to restore your last imported dataset after a page reload.

OPFS may be unavailable in private/incognito browsing mode, when browser storage is restricted, or in older browsers that do not support it.

ProtSpace still works normally without OPFS. Your dataset loads for the current session, but you will need to import it again after reloading the page.
:::

## When a Previous Load Crashed

If a previous session failed to finish loading a dataset (browser crash, tab closed mid-load, or a corrupt file), ProtSpace shows a recovery banner above the scatterplot when you return. The banner names the file that didn't finish and offers three actions:

- **Try again** — re-attempts the load from the stored copy. Useful if the previous failure was transient (network hiccup, momentary browser stall).
- **Load default** — replaces the stored file with the demo dataset. Use this if you don't need to recover the specific file.
- **Clear stored data** — deletes the stored file without loading anything. Choose this if the file is corrupt or you'd rather import a fresh copy yourself.

After three failed retries the banner shifts tone, recommending you clear or load the demo rather than continue retrying.

::: info Why a banner instead of just retrying?
Auto-retry would loop forever on a genuinely broken file. The banner makes the failure visible and lets you choose the recovery path that fits the situation.
:::

## Need a Data File?

To create your own `.parquetbundle` files:

- **[Using Google Colab](/guide/data-preparation)** - No installation required (recommended)
- **[Using Python CLI](/guide/python-cli)** - For local processing or automation

Or download example datasets from the [GitHub data folder](https://github.com/tsenoner/protspace/tree/main/apps/web/public/data).
