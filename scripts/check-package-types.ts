/**
 * Fail when a workspace package's declared type entry points do not match its build output.
 *
 * For every workspace package that declares types (`types`/`typings`, or a `types` condition
 * under `exports`), this asserts, after a build, that
 *
 *   1. every declared declaration file exists, and
 *   2. TypeScript resolves every exported subpath to one of those files, under
 *      `moduleResolution: "bundler"` and under `"node16"` for both ESM and CJS importers.
 *
 * Check 2 is the one that catches the silent failure. A missing `types` target is not an
 * error to TypeScript: it falls through to the `import` condition, resolves the `.mjs` bundle,
 * and types every import from the package as `any`. That is only reported under
 * `noImplicitAny`, which apps/web turns off — so @protspace/core emitted its declarations to
 * dist/src/ while package.json pointed at dist/, and the app type-checked against `any`
 * without a single error.
 *
 * Runs at the end of `pnpm type-check`, after turbo has built the packages.
 *
 * Usage:  pnpm type-check:package-types
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories whose children are workspace packages (see pnpm-workspace.yaml). */
const WORKSPACE_PARENTS = ['packages', 'apps'];

const DECLARATION_FILE = /\.d\.[cm]?ts$/;

type ExportTarget = string | null | ExportTarget[] | { [condition: string]: ExportTarget };

interface PackageJson {
  name?: string;
  types?: string;
  typings?: string;
  exports?: ExportTarget;
}

const RESOLVERS: {
  label: string;
  options: ts.CompilerOptions;
  mode: ts.ResolutionMode;
}[] = [
  {
    label: 'bundler',
    options: { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    mode: undefined,
  },
  {
    label: 'node16 import',
    options: { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 },
    mode: ts.ModuleKind.ESNext,
  },
  {
    label: 'node16 require',
    options: { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 },
    mode: ts.ModuleKind.CommonJS,
  },
];

/** Every `types` target under an export target, in condition order. */
function typesTargets(target: ExportTarget | undefined): string[] {
  if (target === undefined || target === null || typeof target === 'string') return [];
  if (Array.isArray(target)) return target.flatMap(typesTargets);
  return Object.entries(target).flatMap(([condition, value]) =>
    condition === 'types' && typeof value === 'string' ? [value] : typesTargets(value),
  );
}

/** The `exports` field as subpath ('.', './publish', ...) -> target. */
function exportSubpaths(exportsField: ExportTarget | undefined): [string, ExportTarget][] {
  if (exportsField === undefined) return [];
  const isSubpathMap =
    exportsField !== null &&
    typeof exportsField === 'object' &&
    !Array.isArray(exportsField) &&
    Object.keys(exportsField).some((key) => key.startsWith('.'));
  return isSubpathMap ? Object.entries(exportsField) : [['.', exportsField]];
}

function workspacePackageDirs(): string[] {
  return WORKSPACE_PARENTS.flatMap((parent) => {
    const parentDir = join(REPO_ROOT, parent);
    if (!existsSync(parentDir)) return [];
    return readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parentDir, entry.name))
      .filter((dir) => existsSync(join(dir, 'package.json')));
  });
}

/** Problems with one package's declared types; empty when they match the build output. */
function checkPackage(packageDir: string, pkg: PackageJson): string[] {
  const problems: string[] = [];
  const name = pkg.name ?? relative(REPO_ROOT, packageDir);
  const declared: [field: string, path: string][] = [];
  if (pkg.types) declared.push(['types', pkg.types]);
  if (pkg.typings) declared.push(['typings', pkg.typings]);
  const subpaths = exportSubpaths(pkg.exports);
  for (const [subpath, target] of subpaths) {
    for (const path of typesTargets(target)) declared.push([`exports["${subpath}"] types`, path]);
  }

  for (const [field, path] of declared) {
    if (!DECLARATION_FILE.test(path)) {
      problems.push(`${name}: ${field} -> ${path} is not a declaration file`);
    } else if (!existsSync(join(packageDir, path))) {
      problems.push(`${name}: ${field} -> ${path} does not exist (build output does not match)`);
    }
  }

  for (const [subpath, target] of subpaths) {
    if (subpath.includes('*')) continue;
    const expected = new Set(typesTargets(target).map((path) => resolve(packageDir, path)));
    if (expected.size === 0) continue;
    const specifier = subpath === '.' ? name : `${name}${subpath.slice(1)}`;
    // A file inside the package resolves its own name through `exports` (self-reference),
    // so no consumer project or node_modules link is needed.
    const importer = join(packageDir, '__package_types_probe__.ts');
    for (const { label, options, mode } of RESOLVERS) {
      const { resolvedModule } = ts.resolveModuleName(
        specifier,
        importer,
        options,
        ts.sys,
        undefined,
        undefined,
        mode,
      );
      const resolved = resolvedModule
        ? relative(packageDir, resolvedModule.resolvedFileName)
        : 'nothing';
      if (!resolvedModule || !expected.has(resolve(resolvedModule.resolvedFileName))) {
        problems.push(
          `${name}: ${label} resolves "${specifier}" to ${resolved}, not its declared types ` +
            `(${[...expected].map((path) => relative(packageDir, path)).join(', ')})` +
            (resolvedModule && !DECLARATION_FILE.test(resolvedModule.resolvedFileName)
              ? ' — every import from it is typed as `any`'
              : ''),
        );
      }
    }
  }
  return problems;
}

const checked: string[] = [];
const problems: string[] = [];
for (const packageDir of workspacePackageDirs()) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson;
  const declaresTypes =
    Boolean(pkg.types || pkg.typings) ||
    exportSubpaths(pkg.exports).some(([, target]) => typesTargets(target).length > 0);
  if (!declaresTypes) continue;
  checked.push(pkg.name ?? relative(REPO_ROOT, packageDir));
  problems.push(...checkPackage(packageDir, pkg));
}

if (problems.length > 0) {
  console.error(`Declared package types do not match the build output:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nBuild the packages first (pnpm build) if dist/ is missing.`);
  process.exit(1);
}
process.stdout.write(`Package types resolve to their declarations: ${checked.join(', ')}\n`);
