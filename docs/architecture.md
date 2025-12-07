# Architecture Overview

## Transport Layer

- **stdio** (default): Direct process communication for Claude Desktop
- **HTTP**: RESTful API with SSE for remote deployment

## Authentication System

OAuth 2.0 with refresh tokens, multi-account support, secure storage in `~/.config/google-calendar-mcp/tokens.json`.

## Handler Architecture

- `src/handlers/core/` - Individual tool handlers extending `BaseToolHandler`
- `src/tools/registry.ts` - Auto-registration, schemas (Zod), and type definitions

## Request Flow

```
Client → Transport → Schema Validation → Handler → Google API → Response
```

## MCP Tools

The server provides calendar management tools that LLMs can use for calendar operations:

### Available Tools

- `list-calendars` - List all available calendars
- `list-events` - List events with date filtering  
- `search-events` - Search events by text query
- `create-event` - Create new calendar events
- `update-event` - Update existing events
- `delete-event` - Delete events
- `get-freebusy` - Check availability across calendars
- `list-colors` - List available event colors
- `get-current-time` - Get current system time and timezone information

## Key Features

- **Auto-registration**: Handlers automatically discovered
- **Multi-account**: Normal/test account support  
- **Rate limiting**: Respects Google Calendar quotas
- **Batch operations**: Efficient multi-calendar queries
- **Recurring events**: Advanced modification scopes
- **Contextual resources**: Real-time date/time information