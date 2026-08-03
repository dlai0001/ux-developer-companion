// Single implementation of the fixture API, shared by both fixtures (PLAN §5) so the
// loading / error / empty / list states behave identically for React and Angular tests.
//   ?delay=<ms>  ?fail=<status>  ?empty=1
export function handleItems(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const delay = Number(url.searchParams.get('delay') ?? '0');
  const fail = url.searchParams.get('fail');
  const empty = url.searchParams.get('empty') === '1';

  setTimeout(() => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    if (fail) {
      res.statusCode = Number(fail) || 500;
      res.end(JSON.stringify({ error: 'forced failure' }));
      return;
    }
    res.end(JSON.stringify(empty ? [] : [
      { id: 1, label: 'Alpha' }, { id: 2, label: 'Beta' }, { id: 3, label: 'Gamma' },
    ]));
  }, Number.isFinite(delay) ? Math.max(0, delay) : 0);
}
