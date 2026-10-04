import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    setupFiles: ['server/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 4,
    testTimeout: 15000,
  },
});
