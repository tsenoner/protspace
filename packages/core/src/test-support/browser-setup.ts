// The app ships Inter (apps/web/src/main.tsx); without it the kit falls back to system-ui, which is
// SF Pro on macOS and a far wider face on Linux CI, so layout tests measured different text.
import '@fontsource-variable/inter';

// Lit's dev build, served to the browser project, prints "Lit is in dev mode" in every test file.
// Lit skips a warning whose code is already listed, so mark that notice as issued; its other dev
// warnings still print.
const lit = globalThis as { litIssuedWarnings?: Set<string> };
(lit.litIssuedWarnings ??= new Set()).add('dev-mode');

// Load every subset before a test measures text, so no test lays out in the fallback first.
await Promise.all(
  [...document.fonts].filter((face) => face.family.includes('Inter')).map((face) => face.load()),
);
