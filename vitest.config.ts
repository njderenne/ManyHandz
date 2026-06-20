import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest — the pure-logic / unit tier (Node). Catches regressions in framework-free code:
 * formatters, utils, referral codes, and the Worker email templates. App libs that touch native
 * modules are stubbed via the `react-native` mock alias. The component + native + E2E (Maestro)
 * tiers layer on top of this — see TESTING.md.
 */
const root = process.cwd()

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      'react-native': path.resolve(root, 'test/mocks/react-native.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/email/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
