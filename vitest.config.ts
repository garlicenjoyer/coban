import { defineConfig } from 'vitest/config';

// Several tests simulate minutes of game time; give them room when the machine is busy.
export default defineConfig({
  test: { dir: 'tests', testTimeout: 30_000 },
});
