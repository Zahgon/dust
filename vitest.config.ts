import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The exact-output and symlink suites share `/tmp/test_dir*` and
    // `/tmp/unreadable_dir`, which the Rust suite guarded with a `Once`. One
    // fork keeps that guard meaningful and keeps the fixtures from racing.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // A generated data table, not code.
        'src/deps/unicodeWidthTable.ts',
        // Runs on the spinner thread, which the coverage provider cannot
        // instrument. Everything it calls lives in `src/progress.ts`, which is
        // covered directly.
        'src/progressWorker.ts',
      ],
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
