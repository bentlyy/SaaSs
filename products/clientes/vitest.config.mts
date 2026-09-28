import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // El setup fija CORE_DB_PATH antes de que se cargue la config del Core.
    // Sin esto, los tests que migran datos escribirian en el core.sqlite real.
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      // Un solo fork: los tests de migracion comparten el handle singleton del
      // Core, y con varios procesos cada uno tendria el suyo contra el mismo
      // archivo. El aislamiento se hace borrando la base entre tests.
      forks: { singleFork: true },
    },
  },
});
