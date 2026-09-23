# Contributing

Thanks for contributing. This file covers the checks a PR must pass and the full checklist for the most common change: adding a tool.

## Setup

```bash
npm install
npm run build
npm run lint     # TypeScript type-check
npm test         # Unit tests (no Google credentials needed)
```

Node 20 or newer is required. CI runs lint, build, and the unit suite on Node 20, 22, and 24. See [docs/development.md](docs/development.md) and [docs/testing.md](docs/testing.md) for integration tests, which need a Google account.

## Before opening a PR

- `npm run lint` and `npm test` pass locally.
- New behavior has unit tests. Coverage thresholds are enforced in CI.
- User-visible changes (new tools, new env vars, changed behavior) are reflected in README.md and the relevant page in `docs/`.
- No `console.log`/`console.warn`/etc. in `src/` (MCP stdio uses stdout for protocol messages). Log to stderr with `process.stderr.write`; a unit test enforces this.

## Adding a tool

Registration is manual. Nothing is auto-discovered, so every step below is required:

1. **Handler**: create `src/handlers/core/YourToolHandler.ts` extending `BaseToolHandler`. Implement `runTool(args, accounts)`, use `this.getCalendar(...)` for the API client and `this.handleGoogleApiError(error)` for errors, and return a structured response via `createStructuredResponse()` (types in `src/types/structured-responses.ts`).
2. **Schema**: add a Zod schema to the `ToolSchemas` object in `src/tools/registry.ts`, and export its input type next to the others (`export type YourToolInput = ToolInputs['your-tool']`).
3. **Registration**: add an entry to the `ToolRegistry.tools` array in `src/tools/registry.ts` with `name`, `title`, `description`, `annotations` (pick one of the `*_ANNOTATIONS` constants: read-only tools use `READ_ONLY_ANNOTATIONS`; tools that modify or delete existing data must be destructive), `schema`, and `handler`. Import the handler at the top of the file.
4. **Unit tests**: add `src/tests/unit/handlers/YourToolHandler.test.ts`. The registration and docs-sync tests pick up the new tool automatically; do not add it to hardcoded lists.
5. **README tools table**: add a row under "Available Tools" in README.md.
6. **README tool names list**: add the name to the "**Available tool names:**" line in the Tool Filtering section (used to build `ENABLED_TOOLS` whitelists).
7. **Architecture doc**: add the tool to the "Available Tools" list in `docs/architecture.md`.
8. **Integration tests** (optional but encouraged): add coverage to `src/tests/integration/direct-integration.test.ts` if the tool calls the Google API in a non-trivial way.

`src/tests/unit/docs/docs-sync.test.ts` fails if steps 5-7 are skipped.

## Adding an environment variable

Read it in one place (see `src/config/`), document it in the README "Configuration" section, and fail with a clear error on malformed values rather than silently falling back.

## Commit messages

This repo uses [release-please](https://github.com/googleapis/release-please), so PR titles and squash-merge commits should follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`...).
