# Architecture Overview

## Transport Layer

- **stdio** (default): Direct process communication for Claude Desktop
- **HTTP**: RESTful API with SSE for remote deployment

## Authentication System

OAuth 2.0 with refresh tokens, multi-account support, secure storage in `~/.config/google-calendar-mcp/tokens.json`.

## Handler Architecture

- `src/handlers/core/` - Individual tool handlers extending `BaseToolHandler`
- `src/tools/registry.ts` - Auto-registration system discovers and registers handlers
- `src/schemas/` - Input validation and type definitions

## Request Flow

```
Client → Transport → Schema Validation → Handler → Google API → Response
```

## MCP Resources

The server provides contextual resources that LLMs can access for enhanced calendar operations:

### DateTime Resource (`datetime://current`)

Provides real-time date/time context including:
- ISO 8601 timestamp with timezone
- User's local timezone 
- Human-readable local time
- Day of week, week number, quarter
- Weekend detection
- Unix timestamp

This helps Claude understand temporal context when creating, updating, or interpreting calendar events.

## Key Features

- **Auto-registration**: Handlers automatically discovered
- **Multi-account**: Normal/test account support  
- **Rate limiting**: Respects Google Calendar quotas
- **Batch operations**: Efficient multi-calendar queries
- **Recurring events**: Advanced modification scopes
- **Contextual resources**: Real-time date/time information