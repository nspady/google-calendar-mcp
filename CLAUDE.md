# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Google Calendar MCP Server - A Model Context Protocol (MCP) server providing Google Calendar integration for AI assistants. Built with TypeScript, supports both stdio and HTTP transports, with OAuth 2.0 authentication.

## Development Commands

```bash
npm install              # Install dependencies
npm run build            # Build with esbuild (outputs to build/)
npm run dev              # Show interactive development menu with all commands
npm run lint             # TypeScript type checking (no emit)

# Testing - Quick Start
npm test                             # Unit tests only (no auth required)
npm run test:watch                   # Unit tests in watch mode
npm run dev test:integration:direct  # Direct integration tests (recommended for dev)
npm run dev coverage                 # Generate test coverage report

# Testing - Full Suite (rarely needed, incurrs LLM usage costs)
npm run dev test:integration:claude  # Claude + MCP integration (requires CLAUDE_API_KEY)
npm run dev test:integration:openai  # OpenAI + MCP integration (requires OPENAI_API_KEY)
npm run dev test:integration:all     # All integration tests (requires all API keys)

# Authentication
npm run auth                # Authenticate main account
npm run dev auth:test       # Authenticate test account (for integration tests)
npm run dev account:status  # Check authentication status

# Running the server
npm start                        # Start with stdio transport
npm run dev http                 # Start HTTP server on localhost:3000
npm run dev http:public          # HTTP server accessible from any host
```

## Architecture

### Handler Architecture

All MCP tools follow a consistent handler pattern:

1. **Handler Registration**: Handlers are auto-registered via `src/tools/registry.ts`
2. **Base Class**: All handlers extend `BaseToolHandler` from `src/handlers/core/BaseToolHandler.ts`
3. **Schema Definition**: Input schemas defined in `src/tools/registry.ts` using Zod
4. **Handler Implementation**: Core logic in `src/handlers/core/` directory

**Request Flow:**
```
Client → Transport Layer → Schema Validation (Zod) → Handler → Google Calendar API → Response
```

### Adding New Tools

1. Create handler class in `src/handlers/core/YourToolHandler.ts`:
   - Extend `BaseToolHandler`
   - Implement `runTool(args, oauth2Client)` method
   - Use `this.getCalendar(oauth2Client)` to get Calendar API client
   - Use `this.handleGoogleApiError(error)` for error handling

2. Define schema in `src/tools/registry.ts`:
   - Add to `ToolSchemas` object with Zod schema
   - Add to `ToolRegistry.tools` array with name, description, handler class

3. Add tests:
   - Unit tests in `src/tests/unit/handlers/YourToolHandler.test.ts`
   - Integration tests in `src/tests/integration/` if needed

**No manual registration needed** - handlers are auto-discovered by the registry system.

### Authentication System

- **OAuth 2.0** with refresh token support
- **Multi-account**: Supports `normal` (default) and `test` accounts via `GOOGLE_ACCOUNT_MODE` env var
- **Token Storage**: `~/.config/google-calendar-mcp/tokens.json` (platform-specific paths)
- **Token Validation**: Automatic refresh on expiry
- **Components**:
  - `src/auth/client.ts` - OAuth2Client initialization
  - `src/auth/server.ts` - Auth server for OAuth flow
  - `src/auth/tokenManager.ts` - Token management and validation

### Transport Layer

- **stdio** (default): Process communication for Claude Desktop
- **HTTP**: RESTful API with SSE for remote deployment
- **Configuration**: `src/config/TransportConfig.ts`
- **Handlers**: `src/transports/stdio.ts` and `src/transports/http.ts`

### Testing Strategy

**Unit Tests** (`src/tests/unit/`):
- No external dependencies (mocked)
- Schema validation, error handling, datetime logic
- Run with `npm test` (no setup required)

**Integration Tests** (`src/tests/integration/`):

Three types of integration tests, each with different requirements:

1. **Direct Integration** (most commonly used):
   - File: `direct-integration.test.ts`
   - Tests real Google Calendar API calls
   - **Setup Required**:
     ```bash
     # 1. Set credentials path
     export GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json

     # 2. Set test calendar (use "primary" or a specific calendar ID)
     export TEST_CALENDAR_ID=primary

     # 3. Authenticate test account
     npm run dev auth:test

     # 4. Run tests
     npm run dev test:integration:direct
     ```

2. **LLM Integration** (rarely needed):
   - Files: `claude-mcp-integration.test.ts`, `openai-mcp-integration.test.ts`
   - Tests end-to-end MCP protocol with AI models
   - **Additional Setup** (beyond direct integration setup):
     ```bash
     # For Claude tests
     export CLAUDE_API_KEY=sk-ant-...
     npm run dev test:integration:claude

     # For OpenAI tests
     export OPENAI_API_KEY=sk-...
     npm run dev test:integration:openai

     # For both
     npm run dev test:integration:all
     ```
   - ⚠️ Consumes API credits and takes 2-5 minutes

**Quick Setup Summary:**
```bash
# Minimal setup for development (direct integration tests only):
export GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json
export TEST_CALENDAR_ID=primary
npm run dev auth:test
npm run dev test:integration:direct
```

### Key Services

**Conflict Detection** (`src/services/conflict-detection/`):
- `ConflictAnalyzer.ts` - Detects scheduling conflicts
- `EventSimilarityChecker.ts` - Identifies duplicate events
- `ConflictDetectionService.ts` - Main service coordinating conflict checks
- Used by `create-event` and `update-event` handlers

**Structured Responses** (`src/types/structured-responses.ts`):
- TypeScript interfaces for consistent response formats
- Used across handlers for type safety

**Utilities**:
- `src/utils/field-mask-builder.ts` - Builds Google API field masks
- `src/utils/event-id-validator.ts` - Validates Google Calendar event IDs
- `src/utils/response-builder.ts` - Formats MCP responses
- `src/handlers/utils/datetime.ts` - Timezone and datetime utilities

## Important Patterns

### Timezone Handling

- **Preferred Format**: ISO 8601 without timezone (e.g., `2024-01-01T10:00:00`)
  - Uses `timeZone` parameter or calendar's default timezone
- **Also Supported**: ISO 8601 with timezone (e.g., `2024-01-01T10:00:00-08:00`)
- **All-day Events**: Date only format (e.g., `2024-01-01`)
- **Helper**: `getCalendarTimezone()` method in `BaseToolHandler`

### Multi-Calendar Support

- `list-events` accepts single calendar ID or JSON array: `'["cal1", "cal2"]'`
- Batch requests handled by `BatchRequestHandler.ts`
- Maximum 50 calendars per request

### Recurring Events

- Modification scopes: `thisEventOnly`, `thisAndFollowing`, `all`
- Handled by `RecurringEventHelpers.ts`
- Special validation in `update-event` schema

### Error Handling

- Use `McpError` from `@modelcontextprotocol/sdk/types.js`
- `BaseToolHandler.handleGoogleApiError()` for consistent Google API error handling
- Maps HTTP status codes to appropriate MCP error codes

### Structured Output Migration

The codebase uses a structured response format for tool outputs. Recent commits (see git status) show migration to structured outputs using types from `src/types/structured-responses.ts`. When updating handlers, ensure responses conform to these structured formats.

### MCP Structure

MCP tools return errors as successful responses with error content, not as thrown exceptions. Integration tests must validate result.content[0].text for error messages, while unit tests of handlers directly can still catch thrown McpError exceptions before the MCP transport layer wraps them.

## Code Quality

- **TypeScript**: Strict mode, avoid `any` types
- **Formatting**: Use existing patterns in handlers
- **Testing**: Add unit tests for all new handlers
- **Error Messages**: Clear, actionable error messages referencing Google Calendar concepts

## Google Calendar API

- **Version**: v3 (`googleapis` package)
- **Timeout**: 3 seconds per API call (configured in `BaseToolHandler`)
- **Rate Limiting**: Google Calendar API has quotas - integration tests may hit limits
- **Scopes Required**:
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar`

## Deployment

- **npx**: `npx @cocal/google-calendar-mcp` (requires `GOOGLE_OAUTH_CREDENTIALS` env var)
- **Docker**: See `docs/docker.md` for Docker deployment with stdio and HTTP modes
- **Claude Desktop Config**: See README.md for local stdio configuration

### Deployment Modes

**Local Development (Claude Desktop):**
- Use **stdio mode** (default)
- No server or domain required
- Direct process communication
- See README.md for setup

**Key Differences:**
- **stdio**: For Claude Desktop only, local machine
- **HTTP**: For testing, development, debugging (local only)

