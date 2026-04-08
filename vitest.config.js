import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  // Avoid pre-bundling monaco-editor during test runs; it has unusual package entries
  // that can cause Vite's dep resolution to fail. Excluding it prevents Vite from
  // attempting to resolve the package entry during optimizeDeps.
  optimizeDeps: {
    exclude: ['monaco-editor']
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.test.js'
      ]
    }
  },
  resolve: {
    // Use array form so we can add a test-time alias for monaco-editor.
    alias: [
      // Redirect all monaco-editor imports to a lightweight stub during tests.
      { find: /^monaco-editor(\/.*)?$/, replacement: path.resolve(__dirname, 'src/test-utils/monaco-stub.js') },
      { find: '@', replacement: path.resolve(__dirname, './src') }
    ]
  }
});
