// Bundle the shared fixture against each pinned React version, in DEVELOPMENT mode
// (production builds strip the devtools hook integration — that's the S3.5 negative case).
import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';

const S = new URL('./', import.meta.url).pathname;

for (const [ver, mode] of [['r18', 'development'], ['r19', 'development'], ['r19', 'production']]) {
  const outName = mode === 'production' ? `${ver}-prod` : ver;
  await esbuild.build({
    entryPoints: [`${S}fixtures/app.jsx`],
    bundle: true,
    outfile: `${S}fixtures/${ver}/bundle-${mode}.js`,
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    minify: mode === 'production',
    // nodePaths is only a FALLBACK — esbuild still prefers normal resolution from the entry's
    // directory, which silently pulled in a second React copy (symptoms: "Objects are not valid
    // as a React child" on 18, null dispatcher on 19). Explicit aliases are the reliable fix.
    alias: {
      react: `${S}fixtures/${ver}/node_modules/react`,
      'react-dom': `${S}fixtures/${ver}/node_modules/react-dom`,
    },
    jsx: 'automatic',
    logLevel: 'error',
  });
  writeFileSync(
    `${S}fixtures/${ver}/index-${mode}.html`,
    `<!doctype html><meta charset=utf-8><title>S3 ${outName}</title>
<body><div id="root"></div><script src="bundle-${mode}.js"></script></body>`,
  );
  console.log('built', ver, mode);
}
