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

test('contributes the send-to-prompt command and keybinding', async () => {
  const all = await vscode.commands.getCommands(true);
  assert.ok(all.includes('uxCompanion.sendToPrompt'), 'uxCompanion.sendToPrompt is not registered');
  assert.ok(all.includes('uxCompanion.copyCaptureToClipboard'), 'clipboard command is not registered');

  const pkg = vscode.extensions.getExtension(EXT_ID).packageJSON;
  const kb = (pkg.contributes.keybindings || []).find((k) => k.command === 'uxCompanion.sendToPrompt');
  assert.ok(kb, 'no keybinding contributed for sendToPrompt');
  assert.strictEqual(kb.mac, 'cmd+alt+p');
});

test('the chat-open command this build depends on exists', async () => {
  // The whole M4 integration rests on workbench.action.chat.open accepting an options bag
  // with attachFiles. If the command vanishes, fail loudly here rather than at send time.
  const all = await vscode.commands.getCommands(true);
  assert.ok(all.includes('workbench.action.chat.open'), 'workbench.action.chat.open is missing');
});

test('send-to-prompt without a panel warns instead of throwing', async () => {
  // Command palette invocation with no panel open must not reject.
  await vscode.commands.executeCommand('uxCompanion.sendToPrompt');
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
