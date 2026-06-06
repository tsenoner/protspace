/**
 * Generate `docs/guide/annotations.md` from the canonical annotation-metadata registry in
 * `@protspace/utils`, so the documentation page and the in-app descriptions share one source and
 * cannot drift.
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
  type AnnotationSource,
} from '../../packages/utils/src/visualization/annotation-metadata.ts';

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

const SOURCE_BLURB: Record<AnnotationSource, string> = {
  Biocentral:
    'Machine-learning predictions (not experimentally curated). Marked with a ⚡ Predicted badge in the app.',
  UniProt: 'Curated annotations from the UniProt knowledgebase.',
  InterPro: 'Signature-database matches aggregated by InterPro.',
  Taxonomy: 'Taxonomic lineage of the source organism.',
  TED: 'Structure-based domains from TED (AlphaFold).',
  Other: 'Other annotations.',
};

function build(): string {
  const lines: string[] = [];
  lines.push('<!--');
  lines.push('  AUTO-GENERATED — do not edit by hand.');
  lines.push('  Source: packages/utils/src/visualization/annotation-metadata.ts');
  lines.push('  Regenerate: pnpm docs:annotations');
  lines.push('-->');
  lines.push('');
  lines.push('# Annotation Reference');
  lines.push('');
  lines.push(
    'ProtSpace annotations come from several sources. Predicted (machine-learning) annotations ' +
      'are flagged with a ⚡ Predicted badge in the app; everything else is experimental or ' +
      'curated. The descriptions below are the same text shown in the in-app information popovers.',
  );
  lines.push('');

  const entries = Object.entries(ANNOTATION_METADATA);

  for (const source of SOURCE_ORDER) {
    const inSource = entries
      .filter(([, meta]) => meta.source === source)
      .sort(([a], [b]) => a.localeCompare(b));
    if (inSource.length === 0) continue;

    lines.push(`## ${SOURCE_HEADINGS[source]}`);
    lines.push('');
    lines.push(SOURCE_BLURB[source]);
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
    }
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

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
      '✖ docs/guide/annotations.md is out of sync with the annotation-metadata registry.\n' +
        '  Run `pnpm docs:annotations` and commit the result.',
    );
    process.exit(1);
  }
  console.log('✓ docs/guide/annotations.md is up to date.');
} else {
  writeFileSync(OUTPUT, content, 'utf8');
  console.log(`✓ Wrote ${OUTPUT}`);
}
