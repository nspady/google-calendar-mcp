---
name: test-unit
description: Vitest process to run unit tests with proper worker cleanup to avoid orphaned processes
allowed-tools: Bash(pnpm:*), Bash(pkill:*), Bash(ps:*)
---

# Unit Test Runner

Run Vitest unit tests with proper process management to prevent orphaned worker processes.

## Why This Skill Exists

Vitest uses a "forks" pool that spawns multiple Node worker processes (one per CPU core). When test output is piped through commands like `head` or the parent process is interrupted, workers can become orphaned and continue consuming 4+ GB of memory each.

**Note on Vitest 4.x:** While Vitest 4.0.1+ improved worker cleanup for normal termination scenarios (GitHub issue #8800), SIGPIPE from output truncation (`| head`) still abruptly terminates the parent process without signaling workers. The guidelines below remain necessary for any scenario involving output piping or process interruption.

## Usage

Arguments:
- No args: Run all unit tests
- `--ci`: Run in CI mode (no watch, exits on completion)
- `--coverage`: Include coverage report
- `--file <path>`: Run specific test file
- `--grep <pattern>`: Filter tests by name pattern

## Execution Steps

1. **Kill any existing orphaned Vitest workers** before starting:
   ```bash
   pkill -f "vitest.*forks" 2>/dev/null || true
   ```

2. **Run tests without output truncation** - never pipe through `head` or `tail`:

   For CI/single run:
   ```bash
   pnpm run test:unit:ci
   ```

   For specific file:
   ```bash
   pnpm run test:unit:ci -- <filepath>
   ```

   For pattern matching:
   ```bash
   pnpm run test:unit:ci -- --grep "<pattern>"
   ```

3. **Verify worker cleanup** after tests complete:
   ```bash
   sleep 2 && ps aux | grep -c "vitest.*forks" | grep -q "^0$" || (echo "Warning: Orphaned workers detected, cleaning up..." && pkill -f "vitest.*forks")
   ```

## Important Rules

- **NEVER** pipe test output through `head`, `tail`, or other truncating commands
- **NEVER** use timeout commands that might kill the parent process
- **ALWAYS** let tests run to natural completion
- If tests are taking too long, run a specific file or use `--grep` to filter

## Performance & Memory Options

### Limit Worker Count

Reduce memory usage by limiting parallel workers:
```bash
pnpm run test:unit:ci -- --maxWorkers=4
```

Or with forks-specific syntax:
```bash
pnpm run test:unit:ci -- --pool=forks --poolOptions.forks.maxForks=4
```

### Alternative Pool: Threads

For projects without native module issues, the `threads` pool can be faster:
```bash
pnpm run test:unit:ci -- --pool=threads
```

**Tradeoffs:**
- `forks` (default): Better compatibility, handles native modules, avoids segfaults
- `threads`: Faster for large projects, but may have "Failed to terminate worker" issues with some libraries

### Disable File Parallelism

Run test files sequentially to reduce startup overhead:
```bash
pnpm run test:unit:ci -- --no-file-parallelism
```

Useful when the test suite has few files or when debugging worker issues.