// `chrome-remote-interface` ships no types. Rather than `declare module … : any`, bind it to the
// OFFICIAL protocol types from `devtools-protocol` so commands and their payloads are checked.
//
// CRI adds sugar the raw protocol types do not model: alongside each domain's commands it
// exposes every EVENT as a method — `Page.loadEventFired()` returns a promise resolving on the
// next event, and `Page.screencastFrame(cb)` subscribes. Both forms are declared below.
declare module 'chrome-remote-interface' {
  import type ProtocolProxyApi from 'devtools-protocol/types/protocol-proxy-api.js';
  import type ProtocolMapping from 'devtools-protocol/types/protocol-mapping.js';

  interface CDPOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    target?: string | ((targets: unknown[]) => unknown);
    local?: boolean;
  }

  type EventName = keyof ProtocolMapping.Events;
  type EventLeaf<K, D extends string> = K extends `${D}.${infer E}` ? E : never;

  /** Event-as-method sugar for one domain: `client.Page.loadEventFired()` / `(cb)`. */
  type EventSugar<D extends string> = {
    [K in Extract<EventName, `${D}.${string}`> as EventLeaf<K, D>]: (
      listener?: (params: ProtocolMapping.Events[K][0]) => void,
    ) => Promise<ProtocolMapping.Events[K][0]>;
  };

  export type CDPClient = {
    [D in keyof ProtocolProxyApi.ProtocolApi]: ProtocolProxyApi.ProtocolApi[D] & EventSugar<D & string>;
  } & {
    on<E extends EventName>(event: E, listener: (params: ProtocolMapping.Events[E][0]) => void): CDPClient;
    removeListener<E extends EventName>(event: E, listener: (params: ProtocolMapping.Events[E][0]) => void): CDPClient;
    close(): Promise<void>;
  };

  function CDP(options?: CDPOptions): Promise<CDPClient>;
  export default CDP;
}
