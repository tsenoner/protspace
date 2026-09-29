/**
 * Generate `docs/explore/example-datasets.md`, the Example datasets page, from three sources:
 *   - the Import-menu catalog (`apps/web/src/explore/example-datasets.ts`): which examples exist,
 *     their order, insight line, curated default view and large-download note;
 *   - the generated bundle manifest (`apps/web/src/explore/example-manifest.ts`): every fact that
 *     depends on how a bundle was built (protein count, size, columns, separation scores,
 *     releases, ProtSpace version, command);
 *   - the docs-only prose in `example-details.ts`.
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
import {
  EXAMPLE_DATASETS,
  formatMegabytes,
  formatProteinCount,
  type ExampleDataset,
} from '../../apps/web/src/explore/example-datasets.ts';
import { EXAMPLE_MANIFEST } from '../../apps/web/src/explore/example-manifest.ts';
import {
  EXAMPLE_DETAILS,
  INTERIM_CATALOG_IDS,
  THUMBNAILS_PENDING,
  type ExampleDetails,
} from './example-details.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO_ROOT, 'docs/explore/example-datasets.md');
const PUBLIC_DIR = join(REPO_ROOT, 'apps/web/public');
const THUMBNAIL_DIR = join(REPO_ROOT, 'docs/explore/images/examples');

/** A value still to come. Rendered as is; the check refuses it once the catalog swap is done. */
const PENDING = '‹pending build›';
const PLACEHOLDER = /‹[^›]*›/;

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
const EAT_COMPANION = /__pred_(value|confidence|source)$/;

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
  large: ExampleDataset['large'] | 'pending' | undefined;
}

const catalogIds = new Set(EXAMPLE_DATASETS.map((entry) => entry.id));
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
    });
  }
  for (const [id, details] of Object.entries(EXAMPLE_DETAILS)) {
    if (catalogIds.has(id) || !details.beforeSwap) continue;
    cards.push({
      id,
      details,
      entry: undefined,
      record: EXAMPLE_MANIFEST.examples[id],
      insight: details.beforeSwap.insight,
      defaultView: details.beforeSwap.defaultView,
      large: details.beforeSwap.large ? 'pending' : undefined,
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
    } else if (details.beforeSwap) {
      errors.push(
        `"${entry.id}" is in the catalog now: move its beforeSwap fields into the catalog entry.`,
      );
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

  for (const [id, details] of Object.entries(EXAMPLE_DETAILS)) {
    const entry = EXAMPLE_DATASETS.find((candidate) => candidate.id === id);
    if (!entry && !details.beforeSwap) {
      errors.push(
        `docs/scripts/example-details.ts has prose for "${id}", which is not in the catalog.`,
      );
    }
    if (details.beforeSwap && swapped) {
      errors.push(`"${id}": beforeSwap is only allowed until the catalog swap; remove it.`);
    }
    const annotation = (entry ?? details.beforeSwap)?.defaultView.annotation;
    if (annotation && !details.lookAt.includes(code(annotation))) {
      errors.push(`"${id}": lookAt does not name its colour-by annotation ${code(annotation)}.`);
    }
    if (entry?.figure && !details.paper.includes(entry.figure)) {
      errors.push(`"${id}": paper does not mention the catalog's figure "${entry.figure}".`);
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

function annotationReleases(record: BundleRecord): string {
  const entries = Object.entries(record.releases.annotations);
  if (entries.length === 0) return PENDING;
  if (entries.length === 1 && entries[0][0] === 'all') return `UniProt release ${entries[0][1]}`;
  return entries.map(([group, release]) => `${group} ${release}`).join(', ');
}

function annotations(record: BundleRecord): string {
  const columns = record.columns.filter((column) => !EAT_COMPANION.test(column));
  const sources = SOURCE_ORDER.filter((source) =>
    columns.some((column) => ANNOTATION_METADATA[column]?.source === source),
  );
  return `${count(columns.length)} columns from ${list(sources)}; releases: ${annotationReleases(record)}.`;
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

function largeNote(card: Card): string {
  if (card.large === 'pending' || !card.record) return PENDING;
  const { memory, loadTime } = card.large as NonNullable<ExampleDataset['large']>;
  return `a ${formatMegabytes(card.record.bytes)} download that needs ${memory} of browser memory and takes ${loadTime} to load.`;
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
  if (card.large) lines.push(`- **Large:** ${largeNote(card)}`);
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
      'of the ProtSpace paper, plus the small demo ProtSpace starts with. A link of the form ' +
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
      "each section gives the releases. The two EAT examples also keep the paper's transferred " +
      'values.' +
      zenodoSentence(),
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
    'The catalog swap is done, but the page still has ‹…› placeholders; fill in the prose or rebuild the bundles.',
  );
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
