import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The suite touches the real filesystem (tmpdir scans, symlink walks,
    // marker files), so its slowest tests are I/O-bound rather than CPU-bound
    // and degrade with the runner, not with the code. On a contended
    // windows-latest runner three unrelated files once blew the 5s default
    // simultaneously — reporting ~28s for tests whose own timer should have
    // fired at 5s, which is worker starvation, not a slow test. Reruns passed
    // unchanged. 15s restores the margin the default never had; anything
    // actually hanging still fails, just not on a busy runner.
    //
    // Load-bearing at ship time: release.yml runs `npm test` immediately before
    // `npm publish`, and a publish cannot be taken back.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/commands/**', 'src/service/**', 'src/ui/**'],
    },
  },
});
