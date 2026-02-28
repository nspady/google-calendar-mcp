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
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/**/*.ts'
      ],
      exclude: [
        'src/tests/**',
        'build/**',
        'dist/**',
        'scripts/**',
        'website/**',
        '**/node_modules/**',
        '**/.worktrees/**',
        '*.config.*'
      ],
      thresholds: {
        // Global baseline for production source files.
        lines: 60,
        statements: 60,
        functions: 68,
        branches: 55,
        // Folder-level thresholds for key surfaces.
        'src/auth/**/*.ts': {
          lines: 40,
          statements: 40,
          functions: 48,
          branches: 28
        },
        'src/transports/**/*.ts': {
          lines: 3,
          statements: 3,
          functions: 7,
          branches: 2
        },
        'src/handlers/core/**/*.ts': {
          lines: 80,
          statements: 80,
          functions: 85,
          branches: 70
        }
      }
    },
  },
}) 
