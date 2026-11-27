import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5313, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 600 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as never);
