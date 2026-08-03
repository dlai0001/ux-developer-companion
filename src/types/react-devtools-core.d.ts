// react-devtools-core ships no types. Only the backend entry is used, and only `initialize`
// (which installs the global hook). The renderer interface is reached through the hook at
// runtime — see src/page-agent/adapters/react.ts.
declare module 'react-devtools-core/backend' {
  export function initialize(settings?: unknown): void;
  export function connectToDevTools(options?: unknown): void;
  export function connectWithCustomMessagingProtocol(options: {
    onSubscribe(listener: (msg: unknown) => void): void;
    onUnsubscribe(listener: (msg: unknown) => void): void;
    onMessage(event: string, payload: unknown): void;
    onSettingsUpdated?(settings: unknown): void;
  }): () => void;
}
