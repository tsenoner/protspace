/**
 * Generate `docs/guide/annotations.md` from two sources that share one set of column names:
 *   - the canonical runtime registry in `@protspace/utils` (`ANNOTATION_METADATA`) — friendly label,
 *     source, predicted flag, and the BRIEF description shown in the in-app info popover; and
 *   - the docs-only `annotation-details.ts` module — the LONG-FORM explanation and authoritative
 *     source link rendered only on the documentation page (never shipped to the app bundle).
 *
 * The popover and the docs page therefore stay in sync on the brief text while the docs add depth.
 *
 * Usage:
 *   tsx docs/scripts/generate-annotations.mts          # write the page
 *   tsx docs/scripts/generate-annotations.mts --check  # fail if the committed page is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ANNOTATION_METADATA,
  compareTaxonomyRank,
  type AnnotationSource,
} from '../../packages/utils/src/visualization/annotation-metadata.ts';
import { ANNOTATION_DETAILS, SOURCE_INTROS } from './annotation-details.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../guide/annotations.md');

const SOURCE_ORDER: AnnotationSource[] = [
  'Biocentral',
  'UniProt',
  'InterPro',
  'Taxonomy',
  'TED',
  'Other',
];

const SOURCE_HEADINGS: Record<AnnotationSource, string> = {
  Biocentral: 'Predicted (Biocentral)',
  UniProt: 'UniProt',
  InterPro: 'InterPro',
  Taxonomy: 'Taxonomy',
  TED: 'TED Domains',
  Other: 'Other',
};

// Fallback one-liners used only when `annotation-details.ts` has no expanded intro for a source.
const SOURCE_BLURB: Record<AnnotationSource, string> = {
  Biocentral:
    'Machine-learning predictions (not experimentally curated). Marked with a ⚡ Predicted badge in the app.',
  UniProt: 'Curated annotations from the UniProt knowledgebase.',
  InterPro: 'Signature-database matches aggregated by InterPro.',
  Taxonomy: 'Taxonomic lineage of the source organism.',
  TED: 'Structure-based domains from TED (AlphaFold).',
  Other: 'Other annotations.',
};

/**
 * Guard against drift between the docs-only details module and the runtime registry: every details
 * key must name a real annotation column (catches typos/renames). Missing details are a non-fatal
 * warning so the page still builds while content is being filled in.
 */
function validateDetailKeys(): void {
  const unknown = Object.keys(ANNOTATION_DETAILS).filter((column) => !ANNOTATION_METADATA[column]);
  if (unknown.length > 0) {
    console.error(
      `✖ annotation-details.ts has ${unknown.length} key(s) not present in the annotation registry:\n` +
        unknown.map((k) => `    - ${k}`).join('\n') +
        '\n  Fix the column name(s) or remove the stale entry.',
    );
    process.exit(1);
  }
  const missing = Object.keys(ANNOTATION_METADATA).filter((column) => !ANNOTATION_DETAILS[column]);
  if (missing.length > 0) {
    console.warn(
      `⚠ ${missing.length} registry column(s) have no entry in annotation-details.ts (brief-only):\n` +
        missing.map((k) => `    - ${k}`).join('\n'),
    );
  }
}

function build(): string {
  const lines: string[] = [];
  lines.push('<!--');
  lines.push('  AUTO-GENERATED — do not edit by hand.');
  lines.push('  Brief text + metadata: packages/utils/src/visualization/annotation-metadata.ts');
  lines.push('  Detailed text + source links: docs/scripts/annotation-details.ts');
  lines.push('  Regenerate: pnpm docs:annotations');
  lines.push('-->');
  lines.push('');
  lines.push('# Annotation Reference');
  lines.push('');
  lines.push('## Annotation Value Format (v2 Encoding)');
  lines.push('');
  lines.push(
    'As of bundle format v2, annotation values containing special characters use percent-encoding ' +
      'to ensure reliable parsing across sources. When reading the per-column descriptions below, ' +
      'note these encoding rules:',
  );
  lines.push('');
  lines.push('- **Reserved characters** (`%`, `;`, `|`, control chars) are percent-encoded as `%XX` (uppercase hex)');
  lines.push('  - `%` → `%25` (for names/labels containing percent signs)');
  lines.push('  - `;` → `%3B` (field separator)');
  lines.push('  - `|` → `%7C` (score/evidence separator)');
  lines.push('  - Control chars (newline, tab, etc.) → `%0A`, `%09`, etc.');
  lines.push('- **Literal characters** (`,`, `(`, `)`) remain unencoded for readability');
  lines.push('');
  lines.push(
    'Example: `PF00001 (Kinase, serine)|425.5` stores the comma in the name literally, ' +
      'but if a name contained a semicolon like "Superfamily; old", it would encode as ' +
      '`PF00001 (Superfamily%3B old)|425.5`.',
  );
  lines.push('');
  lines.push(
    'Format version 2 is marked in the parquet metadata of the `selected_annotations` table ' +
      'under the key `protspace_format_version`. Bundles without this key or with version < 2 ' +
      'are rendered using the legacy parser. See [Data Format Reference](/guide/data-format#encoding-format-v2) ' +
      'for more detail.',
  );
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  lines.push(
    'ProtSpace annotations come from several sources. **Computational predictions** — from a ' +
      'machine-learning model, sequence topology, or 3D structure (Biocentral, the Phobius ' +
      '`signal_peptide`, and TED) — are flagged with a ⚡ Predicted badge in the app; reference ' +
      'signature matches (Pfam, CATH-Gene3D, …) and curated or factual data (UniProt, Taxonomy) ' +
      'are not. For each annotation, the **bold lead line** is the same short summary shown in the ' +
      "app's info popover, and the paragraph beneath it is a fuller explanation — what the value " +
      'means, how it is produced, and what it looks like — with a link to the authoritative source.',
  );
  lines.push('');

  const entries = Object.entries(ANNOTATION_METADATA);

  for (const source of SOURCE_ORDER) {
    // Taxonomy reads best by rank depth (general → specific); every other source is alphabetical.
    const inSource = entries
      .filter(([, meta]) => meta.source === source)
      .sort(([a], [b]) => (source === 'Taxonomy' ? compareTaxonomyRank(a, b) : a.localeCompare(b)));
    if (inSource.length === 0) continue;

    lines.push(`## ${SOURCE_HEADINGS[source]}`);
    lines.push('');
    lines.push(SOURCE_INTROS[source] ?? SOURCE_BLURB[source]);
    lines.push('');

    for (const [column, meta] of inSource) {
      // Use an explicit custom anchor ({#column}) so the heading id is exactly the column name
      // (underscores preserved). VitePress's default slugify would convert `_` to `-`, which would
      // not match the `#<column>` anchors stored in the registry's `docsUrl`.
      lines.push(`### \`${column}\` {#${column}}`);
      lines.push('');
      lines.push(`**${meta.label}**${meta.isPredicted ? ' · ⚡ Predicted' : ''}`);
      lines.push('');
      lines.push(meta.description);
      lines.push('');
      const detail = ANNOTATION_DETAILS[column];
      if (detail) {
        lines.push(detail.detailsMarkdown);
        lines.push('');
      }
    }
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

validateDetailKeys();

const content = build();
const check = process.argv.includes('--check');

if (check) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    current = '';
  }
  if (current !== content) {
    console.error(
      '✖ docs/guide/annotations.md is out of sync with the annotation registry / details.\n' +
        '  Run `pnpm docs:annotations` and commit the result.',
    );
    process.exit(1);
  }
  console.log('✓ docs/guide/annotations.md is up to date.');
} else {
  writeFileSync(OUTPUT, content, 'utf8');
  console.log(`✓ Wrote ${OUTPUT}`);
}
