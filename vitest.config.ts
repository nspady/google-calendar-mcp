import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig({
  test: {
    globals: true, // Use Vitest globals (describe, it, expect) like Jest
    environment: 'node', // Specify the test environment
    // Load environment variables from .env file
    env: loadEnv('', process.cwd(), ''),
    // Increase timeout for AI API calls
    testTimeout: 30000,
    // If using ESM, ensure module resolution is handled correctly
    // You might not need alias if your tsconfig paths work, but it can be explicit:
    // alias: {
    //   '^(\\.{1,2}/.*)\\.js$': '$1',
    // },
    // Enable coverage
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
    },
  },
}) 