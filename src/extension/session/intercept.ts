// Request interception (PLAN §4.6 state lab): rules table -> Fetch.requestPaused ->
// fulfill / fail / continue.
import type Protocol from 'devtools-protocol';
import type { CdpSession } from '../browser/cdp.js';

export interface InterceptRule {
  id: string;
  /** Empty means any method. */
  method?: string;
  /** Substring match against the URL. */
  urlContains: string;
  action:
    | { kind: 'fail'; status: number }
    | { kind: 'delay'; ms: number }
    | { kind: 'mock'; status?: number; body: string; contentType?: string };
  enabled: boolean;
}

export const THROTTLE_PRESETS = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  'slow-3g': { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
  'fast-3g': { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
} as const;

export type ThrottlePreset = keyof typeof THROTTLE_PRESETS;

export function matches(rule: InterceptRule, method: string, url: string): boolean {
  if (!rule.enabled) return false;
  if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) return false;
  return url.includes(rule.urlContains);
}

/** Owns Fetch.enable and the paused-request handler. */
export class InterceptController {
  private rules: InterceptRule[] = [];
  private active = false;

  constructor(private readonly cdp: CdpSession) {}

  get ruleCount(): number { return this.rules.filter((r) => r.enabled).length; }

  async setRules(rules: InterceptRule[]): Promise<void> {
    this.rules = rules;
    const want = rules.some((r) => r.enabled);
    if (want && !this.active) await this.enable();
    else if (!want && this.active) await this.disable();
  }

  private async enable(): Promise<void> {
    this.active = true;
    await this.cdp.fetchEnable();
    this.cdp.onRequestPaused((ev) => { void this.handle(ev); });
  }

  private async disable(): Promise<void> {
    this.active = false;
    await this.cdp.fetchDisable();
  }

  private async handle(ev: Protocol.Fetch.RequestPausedEvent): Promise<void> {
    const rule = this.rules.find((r) => matches(r, ev.request.method, ev.request.url));
    if (!rule) { await this.cdp.continueRequest(ev.requestId); return; }

    switch (rule.action.kind) {
      case 'fail':
        // A status-shaped failure is more useful than a network error: apps show their
        // error banner rather than a generic fetch rejection.
        await this.cdp.fulfillRequest(ev.requestId, rule.action.status,
          [{ name: 'content-type', value: 'application/json' }],
          Buffer.from(JSON.stringify({ error: `forced ${rule.action.status}` })).toString('base64'));
        return;
      case 'delay':
        await new Promise((r) => setTimeout(r, rule.action.kind === 'delay' ? rule.action.ms : 0));
        await this.cdp.continueRequest(ev.requestId);
        return;
      case 'mock':
        await this.cdp.fulfillRequest(ev.requestId, rule.action.status ?? 200,
          [{ name: 'content-type', value: rule.action.contentType ?? 'application/json' }],
          Buffer.from(rule.action.body).toString('base64'));
        return;
    }
  }
}
