// Standalone fixture API on :4300. The Angular dev server proxies /api here; the React fixture
// mounts the same handler in-process. One implementation, two consumers.
import { createServer } from 'node:http';
import { handleItems } from '../fixtures/shared/items-api.mjs';

export const API_PORT = 4300;

export function startApiServer(port = API_PORT) {
  const srv = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/items')) return handleItems(req, res);
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startApiServer();
  console.log(`[fixtures] items API on :${API_PORT}`);
}
