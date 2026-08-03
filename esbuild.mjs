// Three bundles, three targets (PLAN §2):
//   host       -> CommonJS for the VS Code extension host, `vscode` external
//   webview    -> IIFE for the browser context inside the webview
//   page-agent -> IIFE injected into the user's page via addScriptToEvaluateOnNewDocument
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: !prod,
  minify: prod,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // `vscode` is injected by the extension host and must never be bundled.
    // bufferutil / utf-8-validate are OPTIONAL native accelerators for `ws` (via
    // chrome-remote-interface). ws loads them in a try/catch and falls back to its JS
    // implementation, so leaving them unbundled is correct — they are not a missing dependency.
    external: ['vscode', 'bufferutil', 'utf-8-validate'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.tsx'],
    outfile: 'out/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
  },
  {
    ...common,
    entryPoints: ['src/page-agent/index.ts'],
    outfile: 'out/page-agent.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    // Runs inside the user's app. Must not leak globals beyond its namespace.
    footer: { js: '' },
  },
];

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[esbuild] watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log('[esbuild] built host + webview + page-agent');
}
