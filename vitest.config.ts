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
    // Use forks pool for cleaner process termination (prevents orphaned workers)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Use single fork to minimize process spawning
      },
    },
    // Ensure proper cleanup on exit
    teardownTimeout: 5000,
    include: [
      'src/tests/**/*.test.ts'
    ],
    // Exclude integration tests by default (they require credentials)
    exclude: ['**/node_modules/**'],
    // Enable coverage
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        'src/tests/integration/**',
        'build/**',
        'scripts/**',
        '*.config.*'
      ],
    },
  },
}) 