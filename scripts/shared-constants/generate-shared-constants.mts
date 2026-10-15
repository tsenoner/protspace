/**
 * Generate the two shared-constants modules from `contracts/shared-constants.json`:
 *   - `packages/utils/src/generated/shared-constants.ts`, for the web packages; and
 *   - `apps/protspace/src/protspace/_generated/shared_constants.py`, for the Python package.
 *
 * Both are committed. The PyPI wheel is built from `apps/protspace` alone, so the Python package
 * cannot read the JSON at build or run time. The source is validated first (structure, then the
 * invariants the code on either side relies on), and nothing is written when it fails.
 *
 * Usage:
 *   tsx scripts/shared-constants/generate-shared-constants.mts          # write both modules
 *   tsx scripts/shared-constants/generate-shared-constants.mts --check  # fail if either is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = resolve(ROOT, 'contracts/shared-constants.json');
const TS_OUT = resolve(ROOT, 'packages/utils/src/generated/shared-constants.ts');
const PY_OUT = resolve(ROOT, 'apps/protspace/src/protspace/_generated/shared_constants.py');

const KINDS = ['string', 'list', 'set'] as const;
type Kind = (typeof KINDS)[number];
interface Constant {
  kind: Kind;
  doc: string[];
  value: string | string[];
}
type Constants = Map<string, Constant>;

const NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
// Both languages' comments carry the doc verbatim; 80 leaves room for the comment prefix
// under prettier's 100 and ruff's 88 columns.
const MAX_DOC_LINE = 80;
const ENTRY_KEYS = new Set(['kind', 'doc', 'value']);

const rel = (path: string) => relative(ROOT, path);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The source's constants, in file order, or every structural problem found. */
function parse(raw: unknown, errors: string[]): Constants {
  const constants: Constants = new Map();
  const entries = (raw as { constants?: unknown } | null)?.constants;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    errors.push('top level: `constants` must be an object');
    return constants;
  }
  for (const [name, entry] of Object.entries(entries)) {
    const where = `constants.${name}`;
    if (!NAME_RE.test(name)) errors.push(`${where}: names are UPPER_SNAKE_CASE`);
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${where}: must be an object with kind, doc and value`);
      continue;
    }
    const { kind, doc, value } = entry as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
    }
    if (!KINDS.includes(kind as Kind)) {
      errors.push(`${where}.kind: must be one of ${KINDS.join(', ')}`);
      continue;
    }
    if (!isStringArray(doc) || doc.length === 0) {
      errors.push(`${where}.doc: must be a non-empty list of lines`);
      continue;
    }
    doc.forEach((line, i) => {
      if (line.length > MAX_DOC_LINE) {
        errors.push(`${where}.doc[${i}]: ${line.length} characters, the limit is ${MAX_DOC_LINE}`);
      }
      if (line !== line.trimEnd()) errors.push(`${where}.doc[${i}]: trailing whitespace`);
      if (line.includes('*/')) errors.push(`${where}.doc[${i}]: "*/" would end the TS comment`);
    });
    if (kind === 'string') {
      if (typeof value !== 'string')
        errors.push(`${where}.value: a string constant needs a string`);
    } else if (!isStringArray(value) || value.length === 0) {
      errors.push(`${where}.value: a ${kind} constant needs a non-empty list of strings`);
      continue;
    } else {
      const duplicates = value.filter((item, i) => value.indexOf(item) !== i);
      if (duplicates.length > 0) errors.push(`${where}.value: duplicates ${duplicates.join(', ')}`);
    }
    constants.set(name, { kind: kind as Kind, doc, value: value as string | string[] });
  }
  return constants;
}

/** The relationships between values that the code on either side relies on. */
function checkInvariants(constants: Constants, errors: string[]): void {
  const get = <K extends Kind>(name: string, kind: K) => {
    const constant = constants.get(name);
    if (constant?.kind === kind) return constant.value as K extends 'string' ? string : string[];
    errors.push(`constants.${name}: required, as a ${kind}`);
    return undefined;
  };

  const tokens = get('MISSING_VALUE_TOKENS', 'set');
  for (const token of tokens ?? []) {
    if (token === '' || token !== token.trim().toLowerCase()) {
      errors.push(
        `MISSING_VALUE_TOKENS: "${token}" is not trimmed and lower-case; both readers compare ` +
          'the trimmed, lower-cased cell, so it could never match',
      );
    }
  }
  const naValue = get('NA_VALUE', 'string');
  if (tokens && naValue !== undefined && !tokens.includes(naValue.toLowerCase())) {
    errors.push(
      `MISSING_VALUE_TOKENS: must hold "${naValue.toLowerCase()}" (NA_VALUE lower-cased), or a ` +
        'category spelled like the sentinel is dropped on export',
    );
  }

  const categorical = get('CATEGORICAL_PALETTE_IDS', 'list');
  const gradient = get('GRADIENT_PALETTE_IDS', 'list');
  for (const id of categorical?.filter((item) => gradient?.includes(item)) ?? []) {
    errors.push(`palettes: "${id}" is both categorical and gradient`);
  }
  const categoricalDefault = get('DEFAULT_CATEGORICAL_PALETTE_ID', 'string');
  if (
    categorical &&
    categoricalDefault !== undefined &&
    !categorical.includes(categoricalDefault)
  ) {
    errors.push(
      `DEFAULT_CATEGORICAL_PALETTE_ID: "${categoricalDefault}" is not a categorical palette`,
    );
  }
  const numericDefault = get('DEFAULT_NUMERIC_PALETTE_ID', 'string');
  if (gradient && numericDefault !== undefined && !gradient.includes(numericDefault)) {
    errors.push(`DEFAULT_NUMERIC_PALETTE_ID: "${numericDefault}" is not a gradient palette`);
  }

  const booleanLabels = get('ARROW_BOOLEAN_LABELS', 'list');
  const shown = [String(false), String(true)];
  if (booleanLabels && booleanLabels.join() !== shown.join()) {
    errors.push(
      `ARROW_BOOLEAN_LABELS: must be ${JSON.stringify(shown)}, how the web shows a v2 bool cell`,
    );
  }
}

const GENERATED_BY = [
  'Generated by scripts/shared-constants/generate-shared-constants.mts from',
  'contracts/shared-constants.json. Do not edit: change the JSON, run',
  '`pnpm shared-constants` and commit both generated modules.',
  '`pnpm shared-constants:check` fails while they disagree.',
];

async function renderTypeScript(constants: Constants): Promise<string> {
  const blocks = [...constants].map(([name, { kind, doc, value }]) => {
    const comment = ['/**', ...doc.map((line) => (line ? ` * ${line}` : ' *')), ' */'];
    const items = Array.isArray(value) ? value.map((item) => JSON.stringify(item)).join(', ') : '';
    const declaration = {
      string: `export const ${name} = ${JSON.stringify(value)};`,
      list: `export const ${name} = [${items}] as const;`,
      set: `export const ${name}: ReadonlySet<string> = new Set([${items}]);`,
    }[kind];
    return [...comment, declaration].join('\n');
  });
  const header = GENERATED_BY.map((line) => `// ${line}`).join('\n');
  const source = `${header}\n\n${blocks.join('\n\n')}\n`;
  return format(source, { ...(await resolveConfig(TS_OUT)), filepath: TS_OUT });
}

/**
 * Python in the one layout `ruff format` leaves alone: double quotes (JSON string literals are
 * valid Python), and every collection exploded with a trailing comma, which ruff keeps exploded.
 */
function renderPython(constants: Constants): string {
  const blocks = [...constants].map(([name, { kind, doc, value }]) => {
    const comment = doc.map((line) => (line ? `# ${line}` : '#'));
    const items = Array.isArray(value) ? value.map((item) => JSON.stringify(item)) : [];
    const declaration = {
      string: [`${name} = ${JSON.stringify(value)}`],
      list: [`${name} = (`, ...items.map((item) => `    ${item},`), ')'],
      set: [
        `${name} = frozenset(`,
        '    {',
        ...items.map((item) => `        ${item},`),
        '    }',
        ')',
      ],
    }[kind];
    return [...comment, ...declaration].join('\n');
  });
  const docstring = [
    '"""Constants the protspace package shares with the ProtSpace web app.',
    '',
    ...GENERATED_BY.map((line) => line.replace(/`/g, '``')),
    '"""',
  ].join('\n');
  return `${docstring}\n\n${blocks.join('\n\n')}\n`;
}

const errors: string[] = [];
const constants = parse(JSON.parse(readFileSync(SOURCE, 'utf8')), errors);
if (errors.length === 0) checkInvariants(constants, errors);
if (errors.length > 0) {
  console.error(
    `✖ ${rel(SOURCE)} is invalid; nothing was written:\n` +
      errors.map((error) => `    - ${error}`).join('\n'),
  );
  process.exit(1);
}

const outputs: Array<[string, string]> = [
  [TS_OUT, await renderTypeScript(constants)],
  [PY_OUT, renderPython(constants)],
];

if (process.argv.includes('--check')) {
  const stale = outputs.filter(([path, content]) => {
    try {
      return readFileSync(path, 'utf8') !== content;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(
      stale.map(([path]) => `✖ ${rel(path)} is out of date with ${rel(SOURCE)}.`).join('\n') +
        '\n  Run `pnpm shared-constants` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`✓ The shared-constants modules match ${rel(SOURCE)}.`);
} else {
  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    console.log(`✓ Wrote ${rel(path)}`);
  }
}
