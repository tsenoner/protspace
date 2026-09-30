/**
 * Generate `docs/explore/example-datasets.md`, the Example datasets page, from three sources:
 *   - the Import-menu catalog (`apps/web/src/explore/example-datasets.ts`): which examples exist,
 *     their order, insight line, curated default view and large-download note;
 *   - the generated bundle manifest (`apps/web/src/explore/example-manifest.ts`): every fact that
 *     depends on how a bundle was built (protein count, size, columns, separation scores,
 *     releases, ProtSpace version, command);
 *   - the docs-only prose in `example-details.ts`.
 *
 * Until the catalog swap, the final examples the app does not serve yet get their cards from the
 * catalog's `FINAL_EXAMPLE_SPECS`, with ‹pending build› where the manifest has no record yet.
 *
 * The app links each example's info popover to `#<id>` on this page, and VitePress never checks
 * anchors, so `apps/web/src/explore/example-datasets-docs.test.ts` pins them.
 *
 * Usage:
 *   tsx docs/scripts/generate-examples.mts          # write the page
 *   tsx docs/scripts/generate-examples.mts --check  # fail if the page is stale or a source disagrees
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import {
  ANNOTATION_METADATA,
  type AnnotationSource,
} from '../../packages/utils/src/visualization/annotation-metadata.ts';
import { isAutoClusterColumnName } from '../../packages/utils/src/visualization/annotation-statistics.ts';
import {
  EXAMPLE_DATASETS,
  FINAL_CATALOG_IS_LIVE,
  FINAL_EXAMPLE_SPECS,
  formatMegabytes,
  formatProteinCount,
  type ExampleDataset,
} from '../../apps/web/src/explore/example-datasets.ts';
import { EXAMPLE_MANIFEST } from '../../apps/web/src/explore/example-manifest.ts';
import {
  EXAMPLE_DETAILS,
  INTERIM_CATALOG_IDS,
  NO_BIOCENTRAL,
  THUMBNAILS_PENDING,
  type ExampleDetails,
} from './example-details.ts';
import { MACHINE_PATH } from './machine-path.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO_ROOT, 'docs/explore/example-datasets.md');
const PUBLIC_DIR = join(REPO_ROOT, 'apps/web/public');
const THUMBNAIL_DIR = join(REPO_ROOT, 'docs/explore/images/examples');
/**
 * Hand-written pages that state facts about the examples. Their ‹…› placeholders wait for the
 * rebuilt bundles like the generated page's, so the check refuses them after the swap too.
 */
const PAGES_WITH_EXAMPLE_FACTS = ['docs/explore/eat.md', 'docs/explore/importing-data.md'];

/** A value still to come. Rendered as is; the check refuses it once the catalog swap is done. */
const PENDING = '‹pending build›';
const PLACEHOLDER = /‹[^›]*›/;
/** A UniProt release name, e.g. `2026_03`. */
const UNIPROT_RELEASE = /^\d{4}_\d{2}$/;

const PREPRINT_DOI = '10.64898/2026.05.04.722720';

/** Annotation sources in the order the page names them (the registry's `Other` is left out). */
const SOURCE_ORDER: readonly AnnotationSource[] = [
  'UniProt',
  'Taxonomy',
  'InterPro',
  'TED',
  'Biocentral',
];

const EAT_VALUE_SUFFIX = '__pred_value';
/** The columns Biocentral's predictions fill (`predicted_subcellular_location`, …). */
const BIOCENTRAL_PREFIX = 'predicted_';
const EAT_COMPANION = /__pred_(value|confidence|source)$/;
/**
 * UniProt fields the tooltip header reads. They come from UniProt with the annotations but are not
 * in the annotation registry, so they are counted as UniProt's here rather than as the build's own.
 */
const UNIPROT_HEADER_COLUMNS: ReadonlySet<string> = new Set(['protein_name', 'uniprot_kb_id']);

/**
 * The release groups of a bundle's provenance (`releases.annotations` in the manifest) that hold
 * its fetched annotations. Another group is named by `RELEASE_GROUP_NAMES` when its release
 * differs, and the check refuses a group that is in neither, so none reaches the page as a bare key.
 */
const MAIN_RELEASE_GROUPS: readonly string[] = ['all', 'refreshed'];
const RELEASE_GROUP_NAMES: Readonly<Record<string, string>> = {
  source: 'the columns kept from the source bundle',
  'withheld-truth': 'the withheld hold-out labels',
};

type BundleRecord = (typeof EXAMPLE_MANIFEST)['examples'][string];

/** Everything one card is rendered from. */
interface Card {
  id: string;
  details: ExampleDetails;
  /** The catalog entry; `undefined` for a card still waiting for the catalog swap. */
  entry: ExampleDataset | undefined;
  record: BundleRecord | undefined;
  insight: string;
  defaultView: ExampleDataset['defaultView'];
  large: ExampleDataset['large'];
  figure: string | undefined;
}

const catalogIds = new Set(EXAMPLE_DATASETS.map((entry) => entry.id));
/** Final examples the app does not serve yet: their cards come from the final catalog. */
const pendingSpecs = FINAL_CATALOG_IS_LIVE
  ? []
  : FINAL_EXAMPLE_SPECS.filter((spec) => !catalogIds.has(spec.id));
const interimIds = new Set(INTERIM_CATALOG_IDS);
/** The catalog swap is done once no interim entry is left; from then on every rule applies. */
const swapped = INTERIM_CATALOG_IDS.length === 0;

const code = (name: string) => `\`${name}\``;
const count = (n: number) => n.toLocaleString('en-US');
const thumbnailPath = (id: string) => join(THUMBNAIL_DIR, `${id}.png`);
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Catalog entries with prose, in menu order, then the cards still waiting for the swap. */
function collectCards(): Card[] {
  const cards: Card[] = [];
  for (const entry of EXAMPLE_DATASETS) {
    const details = EXAMPLE_DETAILS[entry.id];
    if (!details) continue;
    cards.push({
      id: entry.id,
      details,
      entry,
      record: EXAMPLE_MANIFEST.examples[entry.id],
      insight: entry.insight,
      defaultView: entry.defaultView,
      large: entry.large,
      figure: entry.figure,
    });
  }
  for (const spec of pendingSpecs) {
    const details = EXAMPLE_DETAILS[spec.id];
    if (!details) continue;
    cards.push({
      id: spec.id,
      details,
      entry: undefined,
      record: EXAMPLE_MANIFEST.examples[spec.id],
      insight: spec.insight,
      defaultView: spec.defaultView,
      large: spec.large,
      figure: spec.figure,
    });
  }
  return cards;
}

/** Every disagreement between the sources, as messages naming what to change. */
function validate(): string[] {
  const errors: string[] = [];

  for (const entry of EXAMPLE_DATASETS) {
    const details = EXAMPLE_DETAILS[entry.id];
    if (interimIds.has(entry.id)) {
      if (details) {
        errors.push(`"${entry.id}" has prose but is also in INTERIM_CATALOG_IDS; drop one.`);
      }
    } else if (!details) {
      errors.push(`Catalog entry "${entry.id}" has no prose in docs/scripts/example-details.ts.`);
    }

    // The label is derived from the manifest; this catches a hand edit of the derivation.
    const record = EXAMPLE_MANIFEST.examples[entry.id];
    const size = formatMegabytes(record.bytes);
    const proteins = formatProteinCount(record.proteins);
    if (entry.sizeBytes !== record.bytes || !entry.label.endsWith(` · ${proteins} · ${size}`)) {
      errors.push(
        `"${entry.id}": the label "${entry.label}" or size ${entry.sizeBytes} B disagrees with the manifest (${proteins} proteins, ${record.bytes} B = ${size}).`,
      );
    }
  }

  for (const id of INTERIM_CATALOG_IDS) {
    if (!catalogIds.has(id)) {
      errors.push(`INTERIM_CATALOG_IDS names "${id}", which is not in the catalog; remove it.`);
    }
  }

  // The swap flips FINAL_CATALOG_IS_LIVE, so every final example needs its card beforehand.
  for (const spec of pendingSpecs) {
    if (!EXAMPLE_DETAILS[spec.id]) {
      errors.push(
        `Final example "${spec.id}" has no prose in docs/scripts/example-details.ts; write its card before the swap.`,
      );
    }
  }

  for (const [id, details] of Object.entries(EXAMPLE_DETAILS)) {
    const entry = EXAMPLE_DATASETS.find((candidate) => candidate.id === id);
    const spec = pendingSpecs.find((candidate) => candidate.id === id);
    if (!entry && !spec) {
      errors.push(
        `docs/scripts/example-details.ts has prose for "${id}", which is in neither the catalog nor the final catalog.`,
      );
    }
    const listed = entry ?? spec;
    const annotation = listed?.defaultView.annotation;
    if (annotation && !details.lookAt.includes(code(annotation))) {
      errors.push(`"${id}": lookAt does not name its colour-by annotation ${code(annotation)}.`);
    }
    if (listed?.figure && !details.paper.includes(listed.figure)) {
      errors.push(`"${id}": paper does not mention the catalog's figure "${listed.figure}".`);
    }
    if (listed && id !== 'demo' && !listed.figure && !details.builtToShow) {
      errors.push(
        `"${id}" is not one of the paper's datasets: say what it was built to show (builtToShow).`,
      );
    }

    const hasThumbnail = existsSync(thumbnailPath(id));
    if (THUMBNAILS_PENDING.includes(id)) {
      if (hasThumbnail) {
        errors.push(`"${id}" has its thumbnail now; remove it from THUMBNAILS_PENDING.`);
      }
    } else if (!hasThumbnail) {
      errors.push(
        `"${id}": docs/explore/images/examples/${id}.png is missing; capture it with the examples-live Playwright project.`,
      );
    }
  }

  for (const id of THUMBNAILS_PENDING) {
    if (!EXAMPLE_DETAILS[id]) {
      errors.push(`THUMBNAILS_PENDING names "${id}", which has no card; remove it.`);
    }
  }
  if (swapped && THUMBNAILS_PENDING.length > 0) {
    errors.push(
      `The catalog swap is done, but THUMBNAILS_PENDING still lists ${THUMBNAILS_PENDING.join(', ')}; capture their thumbnails with the examples-live Playwright project and empty it.`,
    );
  }

  // After the swap every stated release must be a real one. A note such as
  // "2025_04 (inferred; confirm …)" stamped into a bundle by the build is not a
  // ‹…› placeholder, so the placeholder check below would let it through.
  if (swapped) {
    for (const entry of EXAMPLE_DATASETS) {
      const { releases } = EXAMPLE_MANIFEST.examples[entry.id];
      const stated = [
        ['membership', releases.membership],
        ...Object.entries(releases.annotations),
      ] as const;
      for (const [group, release] of stated) {
        if (release !== null && !UNIPROT_RELEASE.test(release)) {
          errors.push(
            `"${entry.id}": the ${group} release "${release}" is not a UniProt release (YYYY_MM); confirm it (tasks 7.1), rebuild the bundle and rerun write_manifest.py.`,
          );
        }
      }
      for (const group of Object.keys(releases.annotations)) {
        if (!MAIN_RELEASE_GROUPS.includes(group) && !(group in RELEASE_GROUP_NAMES)) {
          errors.push(
            `"${entry.id}": its manifest names the release group "${group}", which the page cannot name; add it to RELEASE_GROUP_NAMES in docs/scripts/generate-examples.mts.`,
          );
        }
      }
    }
  }

  // A section whose bundle has no Biocentral predictions says so and why (the spec's Example
  // datasets page requirement). The cards describe the final bundles, so this applies to their
  // records, which exist once the final catalog is live (before that the demo's is the old one).
  if (FINAL_CATALOG_IS_LIVE) {
    for (const [id, details] of Object.entries(EXAMPLE_DETAILS)) {
      const record = EXAMPLE_MANIFEST.examples[id];
      if (!record) continue;
      const predicted = record.columns.some((column) => column.startsWith(BIOCENTRAL_PREFIX));
      const noted = details.notes?.includes(NO_BIOCENTRAL) ?? false;
      if (!predicted && !noted) {
        errors.push(
          `"${id}": its bundle has no Biocentral predictions (no ${code(`${BIOCENTRAL_PREFIX}*`)} column); add NO_BIOCENTRAL to its notes in docs/scripts/example-details.ts.`,
        );
      } else if (predicted && noted) {
        errors.push(
          `"${id}": its bundle has Biocentral predictions, but its notes say it has none; drop NO_BIOCENTRAL.`,
        );
      }
    }
  }

  for (const [id, record] of Object.entries(EXAMPLE_MANIFEST.examples)) {
    if (record.command && MACHINE_PATH.test(record.command)) {
      errors.push(
        `"${id}": the manifest's build command names a path of the build machine; rebuild with a redacted command (build_command in build_showcase.py).`,
      );
    }
  }

  // Repo-hosted bundles (the startup demo) are served from the repository as committed, so their
  // bytes must be the ones the manifest, and therefore this page, describes.
  for (const [id, record] of Object.entries(EXAMPLE_MANIFEST.examples)) {
    if (record.hosting !== 'repo') continue;
    const path = join(PUBLIC_DIR, record.file);
    if (!existsSync(path)) {
      errors.push(`"${id}": apps/web/public/${record.file} is missing.`);
      continue;
    }
    const data = readFileSync(path);
    if (data.byteLength !== record.bytes || sha256(data) !== record.sha256) {
      errors.push(
        `"${id}": apps/web/public/${record.file} differs from its manifest record; rerun write_manifest.py --refresh.`,
      );
    }
  }

  return errors;
}

function opensOn(view: Card['defaultView']): string {
  const tooltip = view.tooltip?.length ? `; the tooltip adds ${list(view.tooltip.map(code))}` : '';
  return `${code(view.projection)}, coloured by ${code(view.annotation)}${tooltip}.`;
}

/**
 * "fetched at UniProt release 2026_03", plus each other group whose release differs: "…, except
 * the columns kept from the source bundle (2026_01)".
 */
function annotationReleases(record: BundleRecord): string {
  const entries = Object.entries(record.releases.annotations);
  if (entries.length === 0) return `fetched at UniProt release ${PENDING}`;
  const main = entries.find(([group]) => MAIN_RELEASE_GROUPS.includes(group))?.[1] ?? entries[0][1];
  const exceptions = entries
    .filter(([group, release]) => !MAIN_RELEASE_GROUPS.includes(group) && release !== main)
    .map(([group, release]) => `${RELEASE_GROUP_NAMES[group] ?? group} (${release})`);
  const fetched = `fetched at UniProt release ${main}`;
  return exceptions.length > 0 ? `${fetched}, except ${list(exceptions)}` : fetched;
}

/**
 * The columns by origin: those the annotation sources supply, those the build derived itself (the
 * three-finger toxins' classes and hold-out, say), and the K-means clusters `protspace stats` adds.
 */
function annotations(record: BundleRecord): string {
  const columns = record.columns.filter((column) => !EAT_COMPANION.test(column));
  const clusters = columns.filter(isAutoClusterColumnName);
  const sourced = columns.filter(
    (column) => ANNOTATION_METADATA[column] !== undefined || UNIPROT_HEADER_COLUMNS.has(column),
  );
  const derived = columns.filter(
    (column) => !isAutoClusterColumnName(column) && !sourced.includes(column),
  );
  const sources = SOURCE_ORDER.filter(
    (source) =>
      (source === 'UniProt' && sourced.some((column) => UNIPROT_HEADER_COLUMNS.has(column))) ||
      sourced.some((column) => ANNOTATION_METADATA[column]?.source === source),
  );
  const parts = [
    `${count(sourced.length)} columns from ${list(sources)}, ${annotationReleases(record)}`,
  ];
  if (derived.length > 0) {
    parts.push(`${count(derived.length)} the build derived (${list(derived.map(code))})`);
  }
  if (clusters.length > 0) {
    // Not named by pattern: prettier's markdown printer turns a code span ending in `_*` into
    // emphasis when a `2026_03` precedes it on the line.
    parts.push(
      `${count(clusters.length)} K-means [cluster columns](/explore/separation-scores#cluster-annotations) that \`protspace stats\` computed`,
    );
  }
  if (parts.length === 1) return `${parts[0]}.`;
  return `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}.`;
}

function extras(record: BundleRecord): string {
  const transferred = record.columns
    .filter((column) => column.endsWith(EAT_VALUE_SUFFIX))
    .map((column) => code(column.slice(0, -EAT_VALUE_SUFFIX.length)));
  const parts: string[] = [];
  if (transferred.length > 0) {
    parts.push(`[transferred annotations (EAT)](/explore/eat) for ${list(transferred)}`);
  }
  if (record.statistics) parts.push('[separation scores](/explore/separation-scores)');
  if (parts.length === 0) return 'None.';
  const text = list(parts);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function builtWith(record: BundleRecord): string {
  if (!record.protspaceVersion) return PENDING;
  const sha = record.gitSha ? ` (git ${record.gitSha.slice(0, 7)})` : '';
  const date = record.builtAt ? `, ${record.builtAt.slice(0, 10)}` : '';
  return `ProtSpace ${record.protspaceVersion}${sha}${date}.`;
}

function largeNote(large: NonNullable<Card['large']>, record: BundleRecord | undefined): string {
  const size = record ? formatMegabytes(record.bytes) : PENDING;
  return `a ${size} download that needs ${large.memory} of browser memory and takes ${large.loadTime} to load.`;
}

const downloadHref = (record: BundleRecord) =>
  record.hosting === 'repo' ? `/${record.file}` : `/examples/${record.file}`;

function renderCard(card: Card): string[] {
  const { id, details, record } = card;
  const lines = [`## ${details.title} {#${id}}`, ''];
  if (!THUMBNAILS_PENDING.includes(id)) {
    lines.push(`![${details.title}: ${card.insight}](./images/examples/${id}.png)`, '');
  }
  lines.push(`_${details.tagline}_`, '', `**${card.insight}**`, '');
  lines.push(`${details.lookAt} ${details.tryNext}`, '');

  lines.push(`- **Opens on:** ${opensOn(card.defaultView)}`);
  lines.push(`- **Source:** ${details.source}`);
  const membership = record?.releases.membership ?? PENDING;
  lines.push(
    `- **Proteins:** ${record ? count(record.proteins) : PENDING}, from UniProt release ${membership}.`,
  );
  lines.push(`- **Embedding:** ${details.embedding}`);
  lines.push(`- **Projections:** ${details.projections}`);
  lines.push(`- **Annotations:** ${record ? annotations(record) : PENDING}`);
  lines.push(`- **Extras:** ${record ? extras(record) : PENDING}`);
  lines.push(`- **Built with:** ${record ? builtWith(record) : PENDING}`);
  lines.push(`- **In the paper:** ${details.paper}`);
  if (card.large) lines.push(`- **Large:** ${largeNote(card.large, record)}`);
  lines.push('');

  for (const note of details.notes ?? []) lines.push(note, '');

  // Raw <a>: a markdown link to /explore?… or to a bundle fails `docs:build` as a dead link.
  const open = card.entry
    ? `<a href="/explore?dataset=${id}" target="_self">Open in ProtSpace</a>`
    : `Open in ProtSpace: ${PENDING}`;
  const download = record
    ? `<a href="${downloadHref(record)}" download>Download the bundle (${formatMegabytes(record.bytes)})</a>`
    : `Download: ${PENDING}`;
  lines.push(`${open} · ${download}`, '');

  lines.push('::: details How this bundle was built', '');
  lines.push(...(record?.command ? ['```sh', record.command, '```'] : [PENDING]));
  lines.push('', ':::', '');
  return lines;
}

function renderSummary(cards: readonly Card[]): string[] {
  const lines = ['| Example | Proteins | Download | Opens on |', '| --- | --- | --- | --- |'];
  for (const card of cards) {
    const proteins = card.record ? count(card.record.proteins) : PENDING;
    const size = card.record ? formatMegabytes(card.record.bytes) : PENDING;
    const view = `${code(card.defaultView.projection)} · ${code(card.defaultView.annotation)}`;
    lines.push(`| [${card.details.title}](#${card.id}) | ${proteins} | ${size} | ${view} |`);
  }
  lines.push('');
  return lines;
}

function renderPage(cards: readonly Card[]): string {
  const body = [...renderSummary(cards), ...cards.flatMap(renderCard)];
  const lines = [
    '<!--',
    '  AUTO-GENERATED: do not edit by hand.',
    '  Catalog (menu names, insight, curated view): apps/web/src/explore/example-datasets.ts',
    '  Bundle facts and provenance: apps/web/src/explore/example-manifest.ts',
    '  Prose: docs/scripts/example-details.ts',
    '  Regenerate: pnpm docs:examples',
    '-->',
    '',
    '# Example Datasets',
    '',
    "The **Import** menu's **Examples** section opens these datasets: the ones behind the figures " +
      'of the ProtSpace paper, the small demo ProtSpace starts with' +
      showcaseClause(cards) +
      '. A link of the form ' +
      "`/explore?dataset=<id>` opens one directly, as each section's **Open in ProtSpace** link " +
      'does. An example opens on a view chosen to show its structure straight away.',
    '',
    'Examples always reopen in that curated view, so changes you make to one, such as legend ' +
      'colours, hidden categories or tooltip fields, are not kept between visits. To keep them, ' +
      'export the example as a `.parquetbundle` with its legend settings included and import that ' +
      'file. Keep the file: your copy counts as the same dataset as the example, so opening the ' +
      "example again resets the copy's saved settings until you import the file again. See " +
      '[Data & Settings Persistence](/explore/importing-data#data-settings-persistence).',
    '',
    "The paper's datasets keep the paper's proteins and projection coordinates, so their layouts " +
      'match the figures, while their annotations were fetched again with a current ProtSpace; ' +
      'each section gives the releases.' +
      zenodoSentence(),
    '',
    'Every example has a UMAP, which it opens on because UMAP draws clusters most clearly, and a ' +
      'PCA, a linear projection that keeps the coarse geometry UMAP distorts and stacks identical ' +
      'sequences on one point. Switching between the two shows how much of a picture belongs to ' +
      'the proteins and how much to the layout.',
    '',
    'Figure numbers refer to the ProtSpace web-server paper and may differ from its preprint ' +
      `([doi:${PREPRINT_DOI}](https://doi.org/${PREPRINT_DOI})). To cite ProtSpace, see ` +
      '[How do I cite ProtSpace?](/guide/faq#how-do-i-cite-protspace). Protein data from ' +
      '[UniProt](https://www.uniprot.org) is used under the ' +
      '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license.',
    '',
  ];
  if (PLACEHOLDER.test(body.join('\n'))) {
    lines.push('::: warning Values still to come');
    lines.push(
      'Values in ‹angle quotes› are filled in when the rebuilt bundles and the last author facts ' +
        'land.' +
        (swapped
          ? ''
          : ' Until then, the Import menu also lists test bundles that have no section here.'),
    );
    lines.push(':::', '');
  }
  lines.push(...body);
  lines.push('## Next Steps', '');
  lines.push(
    '- [Importing Data](/explore/importing-data) - open your own `.parquetbundle` or FASTA file',
  );
  lines.push(
    '- [Using Python CLI](/guide/python-cli) - build a bundle like these from your own proteins',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * ", and one example built for the web to show …: <link>" for the examples that are neither the
 * demo nor a paper dataset, or nothing when there are none.
 */
function showcaseClause(cards: readonly Card[]): string {
  const showcases = cards.filter((card) => card.details.builtToShow);
  if (showcases.length === 0) return '';
  const names = showcases.map((card) => `[${card.details.title}](#${card.id})`);
  const purposes = [...new Set(showcases.map((card) => card.details.builtToShow as string))];
  const count = showcases.length === 1 ? 'one example' : `${showcases.length} examples`;
  return `, and ${count} built for the web to show ${list(purposes)}: ${list(names)}`;
}

function zenodoSentence(): string {
  const dois = [
    ...new Set(
      Object.values(EXAMPLE_MANIFEST.examples)
        .map((record) => record.zenodoDoi)
        .filter((doi): doi is string => Boolean(doi)),
    ),
  ];
  if (dois.length === 0) return '';
  const links = dois.map((doi) => `[doi:${doi}](https://doi.org/${doi})`);
  return ` The paper's exact files are archived on Zenodo (${list(links)}).`;
}

const cards = collectCards();
const errors = validate();
const unformatted = renderPage(cards);
if (swapped && PLACEHOLDER.test(unformatted)) {
  errors.push(
    'The catalog swap is done, but the page still has ‹…› placeholders; fill in the prose or the catalog, or rebuild the bundles.',
  );
}
if (swapped) {
  for (const page of PAGES_WITH_EXAMPLE_FACTS) {
    if (PLACEHOLDER.test(readFileSync(join(REPO_ROOT, page), 'utf8'))) {
      errors.push(
        `The catalog swap is done, but ${page} still has ‹…› placeholders; fill them in from the built bundles.`,
      );
    }
  }
}
if (errors.length > 0) {
  console.error(
    `✖ The Example datasets page cannot be generated:\n${errors.map((error) => `    - ${error}`).join('\n')}`,
  );
  process.exit(1);
}

const prettierOptions = (await prettier.resolveConfig(OUTPUT)) ?? {};
const content = await prettier.format(unformatted, { ...prettierOptions, filepath: OUTPUT });

if (process.argv.includes('--check')) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== content) {
    console.error(
      '✖ docs/explore/example-datasets.md is out of sync with the catalog, the manifest or\n' +
        '  docs/scripts/example-details.ts. Run `pnpm docs:examples` and commit the result.',
    );
    process.exit(1);
  }
  console.log('✓ docs/explore/example-datasets.md is up to date.');
} else {
  writeFileSync(OUTPUT, content, 'utf8');
  console.log(`✓ Wrote ${OUTPUT}`);
}
