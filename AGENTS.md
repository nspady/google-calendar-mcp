# Repository Guidelines

## Project Structure & Modules
- Source: `src/` (entry `index.ts`), builds to `build/` via esbuild.
- Handlers: `src/handlers/core/` (tool implementations), utilities in `src/handlers/utils/`.
- Schemas: `src/schemas/` (Zod definitions shared between server and tests).
- Services: `src/services/` (conflict detection, helpers), transports in `src/transports/`.
- Auth: `src/auth/`, OAuth helper `src/auth-server.ts`.
- Tests: `src/tests/unit/` and `src/tests/integration/`.
- Docs: `docs/` (auth, testing, deployment, architecture).

## Build, Test, and Dev
- `npm run build`: Bundle to `build/index.js` and `build/auth-server.js` (Node 18 ESM).
- `npm start`: Run stdio transport (for Claude Desktop). Example: `npx @cocal/google-calendar-mcp`.
- `npm run start:http`: HTTP transport on `:3000` (use `start:http:public` for `0.0.0.0`).
- `npm test`: Vitest unit tests. `npm run test:integration` for Google/LLM integration.
- `npm run dev`: Helper menu (auth, http, docker, targeted test runs).
- `npm run auth`: Launch local OAuth flow (stores tokens in `~/.config/google-calendar-mcp`).

## Coding Style & Naming
- TypeScript, strict typing (avoid `any`). 2‑space indentation.
- Files: PascalCase for handlers/services (e.g., `GetEventHandler.ts`), camelCase for functions/vars.
- ESM modules with `type: module`; prefer named exports.
- Validation with Zod in `src/schemas/`; validate inputs at handler boundaries.
- Linting: `npm run lint` (TypeScript no‑emit checks).

## Testing Guidelines
- Framework: Vitest with V8 coverage (`npm run test:coverage`).
- Unit test names: `*.test.ts` mirroring source paths (e.g., `src/tests/unit/handlers/...`).
- Integration requires env: `GOOGLE_OAUTH_CREDENTIALS`, `TEST_CALENDAR_ID`; authenticate with `npm run dev auth:test`.
- Use `src/tests/integration/test-data-factory.ts` utilities; ensure tests clean up created events.

## Commit & PRs
- Commits: Imperative mood, concise subject, optional scope. Examples:
  - `Fix timezone handling for list-events`
  - `services(conflict): improve duplicate detection`
- Reference issues/PRs with `(#NN)` when applicable.
- PRs: clear description, rationale, screenshots/log snippets when debugging; link issues; list notable env/config changes.
- Required before PR: `npm run lint && npm test && npm run build` (and relevant integration tests if affected).

## Security & Config
- Keep credentials out of git; use `.env` and `GOOGLE_OAUTH_CREDENTIALS` path.
- Test vs normal accounts controlled via `GOOGLE_ACCOUNT_MODE`; prefer `test` for integration.
- Tokens stored locally in `~/.config/google-calendar-mcp/tokens.json`.

## Adding New Tools (MCP)
- Implement handler in `src/handlers/core/YourToolHandler.ts` extending `BaseToolHandler`.
- Define/extend Zod schema in `src/schemas/` and add unit + integration tests.
- Handlers are auto‑registered; update docs if adding public tool names.

