const vscode = require('vscode');
function activate(ctx) {
  ctx.subscriptions.push(vscode.commands.registerCommand('uxProbe.hello', () => {
    vscode.window.showInformationMessage(
      `UX Probe OK — VSCode ${vscode.version}, Node ${process.version}, lm=${typeof vscode.lm}, ` +
      `dataPart.image=${typeof vscode.LanguageModelDataPart?.image}`);
  }));
  vscode.window.showInformationMessage('UX Probe activated — run "UX Probe: Hello" from the Command Palette.');
}
exports.activate = activate;
