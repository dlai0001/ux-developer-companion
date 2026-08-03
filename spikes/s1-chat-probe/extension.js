// Throwaway spike probe for S1 (image into native Copilot chat) and S2 (vscode.lm image parts).
// Writes findings to spikes/_out/probe-results.json. No UI polish by design.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '..', '_out');
const PNG = path.join(OUT, 'codeword.png');
const RESULTS = path.join(OUT, 'probe-results.json');

const results = { startedAt: new Date().toISOString(), env: {}, phases: {} };
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
const errStr = (e) => ({ name: e?.name, message: String(e?.message ?? e), code: e?.code });

async function phaseA() {
  const all = await vscode.commands.getCommands(true);
  const rx = /chat|copilot|attach/i;
  results.phases.A_commands = {
    total: all.length,
    matching: all.filter((c) => rx.test(c)).sort(),
    hasChatOpen: all.includes('workbench.action.chat.open'),
    hasAttachFile: all.includes('workbench.action.chat.attachFile'),
    hasAttachContext: all.includes('workbench.action.chat.attachContext'),
  };
  results.env = {
    vscode: vscode.version,
    node: process.version,
    appName: vscode.env.appName,
    apis: {
      lm: typeof vscode.lm,
      selectChatModels: typeof vscode.lm?.selectChatModels,
      LanguageModelDataPart: typeof vscode.LanguageModelDataPart,
      dataPartImageFn: typeof vscode.LanguageModelDataPart?.image,
      chatCreateParticipant: typeof vscode.chat?.createChatParticipant,
      invokeTool: typeof vscode.lm?.invokeTool,
      registerTool: typeof vscode.lm?.registerTool,
      tools: Array.isArray(vscode.lm?.tools) ? vscode.lm.tools.length : null,
    },
  };
  save();
}

// S2 core: can a selectable model actually READ our PNG? Ask it to echo the codeword.
async function phaseB() {
  const out = { models: [], imageTests: [] };
  results.phases.B_lm = out; // assign up front so incremental save()s capture partial progress
  save();

  // FINDING: selectChatModels() can hang indefinitely (never resolves, never rejects) when the
  // Copilot chat extension has not activated. Force activation, then time-box every call.
  const withTimeout = (p, ms, label) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);

  out.copilotExtensions = vscode.extensions.all
    .filter((e) => /copilot/i.test(e.id))
    .map((e) => ({ id: e.id, version: e.packageJSON?.version, isActive: e.isActive }));
  for (const id of ['GitHub.copilot-chat', 'GitHub.copilot']) {
    const ext = vscode.extensions.getExtension(id);
    if (!ext) continue;
    try { await withTimeout(ext.activate(), 30000, `activate ${id}`); out[`activated_${id}`] = true; }
    catch (e) { out[`activated_${id}`] = errStr(e); }
  }
  out.copilotExtensionsAfter = vscode.extensions.all
    .filter((e) => /copilot/i.test(e.id))
    .map((e) => ({ id: e.id, isActive: e.isActive }));
  save();

  let models = [];
  for (const sel of [{ vendor: 'copilot' }, undefined]) {
    try {
      models = await withTimeout(vscode.lm.selectChatModels(sel), 20000, `selectChatModels(${JSON.stringify(sel)})`);
      out.selectorUsed = sel ?? 'no-selector';
      if (models.length) break;
    } catch (e) {
      out.selectError = { ...(out.selectError || {}), [JSON.stringify(sel ?? 'none')]: errStr(e) };
    }
  }
  out.modelCount = models.length;
  for (const m of models) {
    out.models.push({
      id: m.id, name: m.name, vendor: m.vendor, family: m.family, version: m.version,
      maxInputTokens: m.maxInputTokens,
      // Does the CONSUMER-side object expose capabilities at runtime, even though
      // @types/vscode 1.125 only declares them on the provider-side interface?
      ownKeys: Object.keys(m),
      protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(m) || {}),
      capabilities: m.capabilities ?? null,
    });
  }
  save();

  if (!fs.existsSync(PNG)) { out.imageTestSkipped = 'codeword.png missing'; results.phases.B_lm = out; save(); return; }
  const bytes = new Uint8Array(fs.readFileSync(PNG));

  // CONTROL: text-only request first. If this also hangs, the blocker is consent/auth,
  // NOT image support — without this control the image results are uninterpretable.
  if (models.length) {
    const c = { model: models[0].id, kind: 'text-only-control' };
    try {
      const t0 = Date.now();
      const resp = await Promise.race([
        models[0].sendRequest([vscode.LanguageModelChatMessage.User('Reply with exactly: PONG')], {},
          new vscode.CancellationTokenSource().token),
        new Promise((_, rej) => setTimeout(() => rej(new Error('text-only sendRequest did not settle in 45s')), 45000)),
      ]);
      let text = '';
      for await (const frag of resp.text) text += frag;
      c.reply = text.trim().slice(0, 120);
      c.elapsedMs = Date.now() - t0;
      c.ok = true;
    } catch (e) { c.ok = false; c.error = errStr(e); }
    out.control = c;
    save();
  }

  for (const m of models) {
    const rec = { model: m.id, family: m.family };
    try {
      const msg = vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart(
          'Reply with ONLY the large pink code word shown in this image, nothing else.'),
        vscode.LanguageModelDataPart.image(bytes, 'image/png'),
      ]);
      // FINDING: the FIRST sendRequest from an unconsented extension shows a modal consent
      // prompt and the promise neither resolves nor rejects until the user answers it.
      // Product must time-box this and fall back, or the send flow hangs silently.
      const t0 = Date.now();
      const resp = await Promise.race([
        m.sendRequest([msg], {}, new vscode.CancellationTokenSource().token),
        new Promise((_, rej) => setTimeout(() => rej(new Error('sendRequest did not settle in 45s — likely awaiting user consent modal')), 45000)),
      ]);
      let text = '';
      for await (const frag of resp.text) text += frag;
      rec.elapsedMs = Date.now() - t0;
      rec.reply = text.trim().slice(0, 200);
      rec.sawCodeword = /MAGENTA-?7734/i.test(text);
      rec.ok = true;
    } catch (e) {
      rec.ok = false;
      rec.error = errStr(e);
    }
    out.imageTests.push(rec);
    results.phases.B_lm = out;
    save();
  }
  results.phases.B_lm = out;
  save();
}

function registerParticipant() {
  try {
    const p = vscode.chat.createChatParticipant('spike.ux', async (request, context, stream, token) => {
      // Dump the runtime shape of what a participant actually receives — especially
      // whether user-attached images arrive, and in what form.
      const refs = (request.references || []).map((r) => ({
        id: r.id,
        name: r.name,
        valueType: r.value?.constructor?.name,
        valueKeys: r.value && typeof r.value === 'object' ? Object.keys(r.value).slice(0, 20) : null,
        isUri: !!(r.value && r.value.scheme),
        uri: r.value?.scheme ? r.value.toString() : undefined,
        mimeType: r.mimeType ?? r.value?.mimeType,
        byteLength: r.value?.data?.byteLength ?? r.value?.byteLength,
      }));
      results.phases.C_participant = {
        invokedAt: new Date().toISOString(),
        prompt: request.prompt,
        command: request.command,
        requestKeys: Object.keys(request),
        modelId: request.model?.id,
        modelCapabilities: request.model?.capabilities ?? null,
        referenceCount: refs.length,
        references: refs,
        toolInvocationToken: typeof request.toolInvocationToken,
        availableTools: Array.isArray(vscode.lm?.tools) ? vscode.lm.tools.map((t) => t.name).slice(0, 40) : null,
        contextHistoryLength: context?.history?.length ?? null,
        streamKeys: Object.keys(Object.getPrototypeOf(stream) || {}),
      };
      save();
      stream.markdown(`Spike participant received ${refs.length} reference(s). Written to probe-results.json.`);
    });
    return { ok: true, id: p.id };
  } catch (e) {
    return { ok: false, error: errStr(e) };
  }
}

// S1 core: land the PNG in the native chat input via the documented options bag.
async function openChatWith(mode) {
  const rec = { mode, attempts: [] };
  const uri = vscode.Uri.file(PNG);
  // Target the spike participant so that when the user hits Enter, the participant handler
  // records EXACTLY what arrived (references + their types) — turning "does an image really
  // attach?" from a visual judgement into recorded data.
  // Route to the REAL agent (no @participant): if Copilot answers with the code word, the
  // attachment demonstrably reached a vision model in agent mode. That is S1's GO criterion,
  // and it is a functional check rather than a judgement about what the UI looked like.
  const q = 'What is the large pink code word in the attached image? Reply with ONLY that word.';
  const variants = [
    { label: 'attachFiles+mode+query', args: { query: q, attachFiles: [uri], mode } },
    { label: 'attachFiles only', args: { query: q, attachFiles: [uri] } },
  ];
  for (const v of variants) {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', v.args);
      rec.attempts.push({ variant: v.label, threw: false });
      break; // first success is enough; leave chat in that state for visual inspection
    } catch (e) {
      rec.attempts.push({ variant: v.label, threw: true, error: errStr(e) });
    }
  }
  results.phases[`D_open_${mode}`] = rec;
  save();
}

async function activate(ctx) {
  fs.mkdirSync(OUT, { recursive: true });
  results.phases.participantRegistration = registerParticipant();
  ctx.subscriptions.push(
    vscode.commands.registerCommand('s1.enumerate', async () => { await phaseA(); await phaseB(); vscode.window.showInformationMessage('S1 probe: phases A+B written'); }),
    vscode.commands.registerCommand('s1.attachAgent', () => openChatWith('agent')),
    vscode.commands.registerCommand('s1.attachAsk', () => openChatWith('ask')),
  );
  try {
    await phaseA();
    await phaseB();
    // Leave the chat open in agent mode with the PNG attached, ready for one Enter press.
    await openChatWith('agent');
  } catch (e) {
    results.fatal = errStr(e);
    save();
  }
  results.finishedAt = new Date().toISOString();
  save();
}

function deactivate() {}
module.exports = { activate, deactivate };
