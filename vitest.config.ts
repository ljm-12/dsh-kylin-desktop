import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
