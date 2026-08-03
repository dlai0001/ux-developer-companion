import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites each launch a real browser and drive it over CDP. Running two such
    // files concurrently makes them contend and fail non-deterministically, so files run one
    // at a time. Unit tests are fast enough that this costs nothing.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    exclude: ['**/node_modules/**', '**/dist/**', 'spikes/**', 'fixtures/**'],
  },
});
