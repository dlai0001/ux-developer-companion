import { describe, expect, it } from 'vitest';
import { discoverBrowser } from '../../src/extension/browser/launch.js';

describe('discoverBrowser', () => {
  it('honours an explicitly configured path that exists', async () => {
    // Any existing file proves the setting short-circuits discovery.
    await expect(discoverBrowser(process.execPath)).resolves.toBe(process.execPath);
  });

  it('falls through to auto-discovery when the configured path is missing', async () => {
    // Must NOT throw just because the setting points at a stale path.
    await expect(discoverBrowser('/nope/does/not/exist')).resolves.toMatch(/Edge|Chrome|Chromium/i);
  });

  it('finds a browser on this machine', async () => {
    await expect(discoverBrowser()).resolves.toBeTruthy();
  });
});
