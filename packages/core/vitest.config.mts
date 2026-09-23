import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupEnv.ts'],
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});