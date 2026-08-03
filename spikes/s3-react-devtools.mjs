// S3 — react-devtools-core backend over CDP.
//
// Tests the CHEAPER path first: inject the backend (which installs the global hook and
// attaches a *renderer interface* per React root), then call renderer-interface methods
// DIRECTLY via Runtime.evaluate — no Bridge, no Store, no wall, no protocol decoding.
// PLAN §4.3 assumes a host-side Bridge/Store from "the frontend package"; that package
// (react-devtools-shared) is not published to npm, so this path matters a lot.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import CDP from 'chrome-remote-interface';
import { launchBrowser } from './lib/launch.mjs';

const S = new URL('./', import.meta.url).pathname;
const OUT = S + '_out/';
mkdirSync(OUT, { recursive: true });

const results = { startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(OUT + 's3-results.json', JSON.stringify(results, null, 2));

// The backend bundle is a UMD that expects `self`; it exposes initialize/connect* on the global.
const backendSrc = readFileSync(S + 'node_modules/react-devtools-core/dist/backend.js', 'utf8');

// Injected at document-start, BEFORE React loads — required so the hook exists when React
// registers its renderer (PLAN §4.3 is right about this part).
const INJECT = `
(function(){
  try {
    var module = { exports: {} }, exports = module.exports;
    ${backendSrc}
    var api = module.exports && module.exports.initialize ? module.exports
            : (self.ReactDevToolsBackend || {});
    window.__uxBackendApi = api;
    if (api.initialize) { api.initialize(); window.__uxHookInstalled = true; }
  } catch (e) { window.__uxInjectError = String(e && e.stack || e); }
})();
`;

function serve(root, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript' };
  const srv = createServer((req, res) => {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]));
    try {
      const body = readFileSync(p);
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

async function runCase({ label, dir, page, port }) {
  const rec = { label, steps: {} };
  const srv = await serve(dir, port);
  const b = await launchBrowser({ userDataDir: `${OUT}s3-profile-${port}` });
  const client = await CDP({ port: b.port });
  const { Page, Runtime } = client;
  await Page.enable();
  await Runtime.enable();

  const consoleErrors = [];
  Runtime.exceptionThrown((p) => consoleErrors.push(p.exceptionDetails?.text + ' ' + (p.exceptionDetails?.exception?.description || '')));

  await Page.addScriptToEvaluateOnNewDocument({ source: INJECT });
  await Page.navigate({ url: `http://127.0.0.1:${port}/${page}` });
  await Page.loadEventFired();
  await new Promise((r) => setTimeout(r, 800)); // let React mount + hook attach

  const ev = async (expression) => {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) return { __error: exceptionDetails.text + ' ' + (exceptionDetails.exception?.description || '') };
    return result.value;
  };

  // 1. Did the hook install and did React register a renderer?
  rec.steps.hook = await ev(`(() => {
    const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    return {
      injectError: window.__uxInjectError || null,
      hookInstalled: !!window.__uxHookInstalled,
      apiKeys: Object.keys(window.__uxBackendApi || {}),
      hookPresent: !!h,
      rendererCount: h ? h.renderers.size : 0,
      rendererIDs: h ? Array.from(h.renderers.keys()) : [],
      rendererInterfaceIDs: h && h.rendererInterfaces ? Array.from(h.rendererInterfaces.keys()) : null,
      reactVersion: h && h.renderers.size ? Array.from(h.renderers.values())[0].version : null,
    };
  })()`);

  // 2. Map a DOM node -> devtools element id, and read props/hooks via inspectElement.
  rec.steps.resolve = await ev(`(() => {
    const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!h || !h.rendererInterfaces) return { error: 'no rendererInterfaces' };
    const rid = Array.from(h.rendererInterfaces.keys())[0];
    const ri = h.rendererInterfaces.get(rid);
    const node = document.getElementById('uc-name'); // inside UserCard
    const methods = Object.keys(ri).filter(k => typeof ri[k] === 'function');
    let id = null, how = null;
    if (ri.getElementIDForHostInstance) { id = ri.getElementIDForHostInstance(node); how = 'getElementIDForHostInstance'; }
    let inspected = null;
    if (id != null && ri.inspectElement) {
      const r = ri.inspectElement(null, id, null, false);
      const v = r && r.value;
      inspected = v ? {
        type: r.type,
        displayName: v.displayName,
        props: v.props,
        hooks: v.hooks,
        canEditFunctionProps: v.canEditFunctionProps,
        canEditHooks: v.canEditHooks,
      } : { rawType: r && r.type };
    }
    return { rid, elementId: id, how, methodCount: methods.length,
             hasOverrideValueAtPath: typeof ri.overrideValueAtPath === 'function',
             methods: methods.sort(), inspected };
  })()`);

  // 3. WRITE #1 — override a prop (compact: false -> true).
  rec.steps.overrideProp = await ev(`(async () => {
    const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const rid = Array.from(h.rendererInterfaces.keys())[0];
    const ri = h.rendererInterfaces.get(rid);
    const id = ri.getElementIDForHostInstance(document.getElementById('uc-name'));
    const before = document.getElementById('uc-compact').textContent;
    // POSITIONAL (type, id, hookID, path, value) — the {…} object form is what the Bridge
    // sends over the wall; calling the renderer interface directly requires positional args
    // and fails SILENTLY (console.warn only) if you pass an object.
    ri.overrideValueAtPath('props', id, null, ['compact'], true);
    await new Promise(r => setTimeout(r, 250));
    const after = document.getElementById('uc-compact').textContent;
    return { before, after, changed: before !== after,
             className: document.getElementById('usercard').className };
  })()`);

  // 4. WRITE #2 — override hook state (count 0 -> 42). Hook index 0 = useState(0).
  rec.steps.overrideHook = await ev(`(async () => {
    const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const rid = Array.from(h.rendererInterfaces.keys())[0];
    const ri = h.rendererInterfaces.get(rid);
    const id = ri.getElementIDForHostInstance(document.getElementById('uc-name'));
    const before = document.getElementById('uc-count').textContent;
    // hookID is its own argument; path is relative to the hook's value (empty for useState).
    ri.overrideValueAtPath('hooks', id, 0, [], 42);
    await new Promise(r => setTimeout(r, 250));
    const after = document.getElementById('uc-count').textContent;
    return { before, after, changed: before !== after };
  })()`);

  // 5. resolveAt(x,y) semantics + component NAME (ComponentInfo.name / source locator input).
  rec.steps.resolveAt = await ev(`(() => {
    const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const rid = Array.from(h.rendererInterfaces.keys())[0];
    const ri = h.rendererInterfaces.get(rid);
    const r = document.getElementById('uc-name').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + 5, r.top + 5);
    const id = ri.getElementIDForHostInstance(el);
    let hosts = null;
    try { hosts = (ri.findHostInstancesForElementID(id) || []).map(n => n.tagName + (n.id ? '#' + n.id : '')); } catch (e) { hosts = String(e); }
    return {
      pointTag: el && el.tagName,
      elementId: id,
      displayName: ri.getDisplayNameForElementID ? ri.getDisplayNameForElementID(id) : null,
      hostInstances: hosts,
      ownersList: ri.getOwnersList ? (ri.getOwnersList(id) || []).map(o => o.displayName) : null,
    };
  })()`);

  rec.consoleErrors = consoleErrors.slice(0, 5);
  await client.close();
  b.kill();
  srv.close();
  results.cases.push(rec);
  save();
  return rec;
}

const CASES = [
  { label: 'React 18.3.1 dev', dir: S + 'fixtures/r18', page: 'index-development.html', port: 5311 },
  { label: 'React 19.2.0 dev', dir: S + 'fixtures/r19', page: 'index-development.html', port: 5312 },
  { label: 'React 19.2.0 PROD', dir: S + 'fixtures/r19', page: 'index-production.html', port: 5313 },
];

for (const c of CASES) {
  try {
    const r = await runCase(c);
    console.log(`\n### ${c.label}`);
    console.log(' hook:', JSON.stringify(r.steps.hook));
    console.log(' resolve.elementId:', r.steps.resolve?.elementId, 'overrideFn:', r.steps.resolve?.hasOverrideValueAtPath);
    console.log(' prop override:', JSON.stringify(r.steps.overrideProp));
    console.log(' hook override:', JSON.stringify(r.steps.overrideHook));
  } catch (e) {
    console.log(`\n### ${c.label} FAILED:`, e.message);
    results.cases.push({ label: c.label, fatal: String(e.stack || e) });
    save();
  }
}
console.log('\nwrote', OUT + 's3-results.json');
