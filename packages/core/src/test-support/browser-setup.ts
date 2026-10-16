// Lit's dev build, served to the browser project, prints "Lit is in dev mode" in every test file.
// Lit skips a warning whose code is already listed, so mark that notice as issued; its other dev
// warnings still print.
const lit = globalThis as { litIssuedWarnings?: Set<string> };
(lit.litIssuedWarnings ??= new Set()).add('dev-mode');
export {};
