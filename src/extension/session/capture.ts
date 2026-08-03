// Capture pipeline (PLAN §4.4): clean screenshot + annotated composite, both written to disk.
// The extension host has no DOM, so compositing happens inside the PAGE via an offscreen
// canvas — the same drawAnnotations() the webview overlay uses, injected as a function body.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CdpSession } from '../browser/cdp.js';
import { AGENT_GLOBAL } from '../../shared/agent-api.js';
import type { Annotation } from '../../shared/annotations.js';

export interface CaptureResult {
  dir: string;
  cleanPath: string;
  annotatedPath: string;
  /** Bytes, for sanity checks and the 30 MB chat-attachment cap. */
  cleanBytes: number;
  annotatedBytes: number;
}


export async function capture(
  cdp: CdpSession,
  annotations: Annotation[],
  outDir: string,
  timestamp: string,
): Promise<CaptureResult> {
  const dir = join(outDir, timestamp);
  mkdirSync(dir, { recursive: true });

  const cleanB64 = await cdp.captureScreenshot();
  const cleanPath = join(dir, 'clean.png');
  const cleanBuf = Buffer.from(cleanB64, 'base64');
  writeFileSync(cleanPath, cleanBuf);

  const annotatedB64 = annotations.length
    ? await composite(cdp, cleanB64, annotations)
    : cleanB64;
  const annotatedPath = join(dir, 'annotated.png');
  const annotatedBuf = Buffer.from(annotatedB64, 'base64');
  writeFileSync(annotatedPath, annotatedBuf);

  return {
    dir, cleanPath, annotatedPath,
    cleanBytes: cleanBuf.byteLength,
    annotatedBytes: annotatedBuf.byteLength,
  };
}

/**
 * Compositing runs inside the page via the injected agent, so the extension host needs no
 * native canvas. Falls back to the clean image when the agent is unavailable (e.g. a page
 * that navigated before the agent installed).
 */
async function composite(cdp: CdpSession, baseB64: string, annotations: Annotation[]): Promise<string> {
  const expression = `(() => { const a = window['${AGENT_GLOBAL}'];
    return a && a.composite ? a.composite(${JSON.stringify(baseB64)}, ${JSON.stringify(annotations)}) : null; })()`;
  const out = await cdp.evaluate<string | null>(expression);
  return out || baseB64;
}
