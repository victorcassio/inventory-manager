import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  plugins: [],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    css: true,
  },
})
