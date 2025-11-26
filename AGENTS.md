# Agent Guidelines

This document provides instructions for AI agents interacting with the Google Calendar MCP server.

## Multi-Account Handling

This server supports connecting to multiple Google accounts simultaneously (e.g., "work", "personal").

### Detecting Accounts
You can list available accounts using the `list-calendars` tool. The tool will return calendars from all connected accounts.

### Using the `account` Parameter
Most tools accept an optional `account` parameter.

- **If `account` is OMITTED**:
    - Read operations (like `list-events`) will query **all** accounts and merge results.
    - Write operations (like `create-event`) will try to intelligently select the best account based on permissions.

- **If `account` is SPECIFIED**:
    - The operation is restricted to that specific account (or list of accounts).
    - Use this when the user explicitly asks to "check my work calendar" or "add this to my personal schedule".

### Example: Listing Events
```json
{
  "name": "list-events",
  "arguments": {
    "timeMin": "2023-10-27T00:00:00Z",
    "account": ["work"]
  }
}
```

### Example: Creating Events
```json
{
  "name": "create-event",
  "arguments": {
    "summary": "Meeting",
    "start": "...",
    "end": "...",
    "account": "work"
  }
}
```

## Calendar Deduplication
The server automatically handles shared calendars. If a calendar is shared between "work" and "personal", it will appear as a single unified calendar in `list-calendars`. You generally don't need to worry about duplicates.
