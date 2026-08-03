// Runs inside the VS Code extension host. Deliberately dependency-free (no mocha) — the suite
// is small and a bespoke runner keeps `test:ext` from pulling a second test framework in.
const assert = require('node:assert');
const vscode = require('vscode');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXT_ID = 'dlaisoft.ux-developer-companion';

test('extension is present and activates', async () => {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  await ext.activate();
  assert.strictEqual(ext.isActive, true, 'extension did not activate');
});

test('contributes the uxCompanion.open command', async () => {
  const all = await vscode.commands.getCommands(true);
  assert.ok(all.includes('uxCompanion.open'), 'uxCompanion.open is not registered');
});

test('uxCompanion.open opens the webview panel', async () => {
  await vscode.commands.executeCommand('uxCompanion.open');
  await sleep(1200); // panel creation + webview boot

  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
  const panel = tabs.find((t) => t.label === 'UX Companion');
  assert.ok(panel, `no tab labelled "UX Companion" (saw: ${tabs.map((t) => t.label).join(', ') || 'none'})`);
});

test('opening twice reveals the existing panel rather than stacking duplicates', async () => {
  await vscode.commands.executeCommand('uxCompanion.open');
  await sleep(600);
  const count = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.label === 'UX Companion').length;
  assert.strictEqual(count, 1, `expected exactly 1 panel, saw ${count}`);
});

exports.run = async function run() {
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push({ name, err });
      console.error(`  ✗ ${name}\n      ${err && err.message}`);
    }
  }
  console.log(`\n[test:ext] ${tests.length - failures.length}/${tests.length} passed`);
  if (failures.length) throw new Error(`${failures.length} extension-host test(s) failed`);
};
