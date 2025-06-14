# GitHub Actions Workflows

This directory contains automated CI/CD workflows for the Google Calendar MCP project.

## Workflows

### 1. `schema-validation.yml` - Schema Validation and Tests
**Triggers**: Push/PR to main or develop branches

Simple workflow focused on schema validation and basic testing:
- Builds the project
- Validates MCP schemas for compatibility
- Runs schema-specific tests
- Runs unit tests via `npm run dev test`

### 2. `ci.yml` - Comprehensive CI Pipeline
**Triggers**: Push/PR to main, develop, or feature branches

Full CI pipeline with multiple jobs running in parallel/sequence:

#### Jobs:
1. **code-quality**: 
   - Checks for console.log statements
   - Ensures code follows best practices

2. **build-and-validate**:
   - Builds the project
   - Validates MCP schemas
   - Uploads build artifacts

3. **unit-tests**:
   - Runs on multiple Node.js versions (18, 20)
   - Executes all unit tests
   - Runs schema compatibility tests

4. **integration-tests** (optional):
   - Only runs on main branch or PRs
   - Executes direct integration tests
   - Continues on error to not block CI

5. **coverage**:
   - Generates test coverage reports
   - Uploads coverage artifacts

## Running Locally

To test workflows locally before pushing:

```bash
# Run schema validation
npm run dev validate-schemas

# Run dev tests (unit tests only)
npm run dev test

# Run all tests
npm test

# Run with coverage
npm run dev coverage
```

## Environment Variables

All workflows set `NODE_ENV=test` to:
- Use test account credentials
- Skip authentication prompts
- Enable test-specific behavior

## Best Practices

1. **Always run `npm run dev test` before pushing** - catches most issues quickly
2. **Schema changes** - Run `npm run validate-schemas` to ensure compatibility
3. **Console statements** - Use `process.stderr.write()` instead of `console.log()`
4. **Integration tests** - These may fail in CI due to API limits; that's OK

## Troubleshooting

### Schema validation fails
- Check for `oneOf`, `anyOf`, `allOf` in tool schemas
- Ensure datetime fields have proper format and timezone info
- Run `npm run dev validate-schemas` locally

### Unit tests fail
- Run `npm run dev test` locally
- Check for recent schema changes that might affect tests
- Ensure all console.log statements are removed

### Integration tests fail
- These are marked as `continue-on-error` in CI
- Usually due to API rate limits or authentication issues
- Can be ignored if unit tests pass

## Adding New Workflows

When adding new workflows:
1. Test locally first
2. Use matrix builds for multiple versions
3. Set appropriate environment variables
4. Consider job dependencies and parallelization
5. Add documentation here