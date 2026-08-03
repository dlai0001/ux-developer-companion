import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Shared fixture API handler. Query params: ?delay=<ms> ?fail=<status> ?empty=1
 * Mounted in-process by the React fixture's Vite config and by the standalone :4300 server
 * the Angular fixture proxies to.
 */
export declare function handleItems(req: IncomingMessage, res: ServerResponse): void;
