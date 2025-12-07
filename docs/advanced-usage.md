# Advanced Usage Guide

This guide covers advanced features and use cases for the Google Calendar MCP Server.

## Multi-Account Support

The server allows you to connect multiple Google accounts simultaneously (e.g., personal, work, family) and interact with all of them seamlessly. See [Authentication Guide](authentication.md#managing-multiple-accounts) for setup instructions.

### Using Accounts with Tools

All tools accept an optional `account` parameter. The behavior depends on the tool type:

#### Account Parameter Behavior

| Tool Type | Accepts Arrays? | `account` Omitted | `account: "work"` | `account: ["work", "personal"]` |
|-----------|----------------|-------------------|-------------------|----------------------------------|
| **Read-only** (list-events, list-calendars, get-freebusy) | ✅ Yes | Merges ALL accounts | Single account only | Merges specified accounts |
| **Write** (create-event, update-event, delete-event) | ❌ No | Auto-selects best permission | Uses specified account | ❌ Error (not supported) |
| **Get** (get-event, search-events) | ❌ No | Auto-selects account with access | Uses specified account | ❌ Error (not supported) |

**Auto-selection logic:**
- When `account` is omitted, the server automatically selects the account with appropriate permissions
- Write operations require write/owner access
- Read operations work with any access level (reader, writer, or owner)
- If no account has the required permissions, you'll get a clear error message

#### Examples

```javascript
// Read-only tools: Query all authenticated accounts (auto-merge)
use_tool("list-events", {
  timeMin: "2025-02-01T00:00:00",
  timeMax: "2025-02-01T23:59:59"
  // No account parameter = merges all accounts
});

// Read-only tools: Query specific accounts
use_tool("list-events", {
  account: ["work", "personal"],  // Array supported!
  timeMin: "2025-02-01T00:00:00",
  timeMax: "2025-02-01T23:59:59"
});

// Write tools: Explicitly pick account
use_tool("create-event", {
  calendarId: "team@company.com",
  summary: "Status update",
  account: "work",  // Must be single string, not array
  start: "2025-02-01T10:00:00",
  end: "2025-02-01T11:00:00"
});

// Write tools: Auto-select account (finds account with write access)
use_tool("create-event", {
  calendarId: "team@company.com",
  summary: "Status update",
  // No account parameter = auto-selects account with write permission
  start: "2025-02-01T10:00:00",
  end: "2025-02-01T11:00:00"
});
```

### Calendar Deduplication

The Calendar Registry collects calendars from every account, de-duplicates shared calendars, and tracks the best account to use for read/write operations. Responses include `accountAccess` arrays so you can see every account that can reach a given calendar.

## Batch Operations

### List Events from Multiple Calendars

Request events from several calendars simultaneously:

```
"Show me all events from my work, personal, and team calendars for next week"
```

The server will:
1. Query all specified calendars in parallel
2. Merge and sort results chronologically
3. Handle different timezones correctly

### Batch Event Creation

Create multiple related events:

```
"Schedule a 3-part training series every Monday at 2pm for the next 3 weeks"
```

## Recurring Events

### Modification Scopes

When updating recurring events, you can specify the scope:

1. **This event only**: Modify a single instance
   ```
   "Move tomorrow's standup to 11am (just this one)"
   ```

2. **This and following events**: Modify from a specific date forward
   ```
   "Change all future team meetings to 30 minutes starting next week"
   ```

3. **All events**: Modify the entire series
   ```
   "Update the location for all weekly reviews to Conference Room B"
   ```

### Complex Recurrence Patterns

The server supports all Google Calendar recurrence rules:
- Daily, weekly, monthly, yearly patterns
- Custom intervals (e.g., every 3 days)
- Specific days (e.g., every Tuesday and Thursday)
- End conditions (after N occurrences or by date)

## Timezone Handling

- If no timezone is specified, the server uses your calendar's default timezone
- You can explicitly set a timezone using the `timeZone` parameter
- Proper handling of daylight saving time transitions
- Support for scheduling across timezones

### Availability Checking

Find optimal meeting times:

```
"Find a 90-minute slot next week when both my work and personal calendars are free, preferably in the afternoon"
```

## Working with Images

### Extract Events from Screenshots

```
"Add this event to my calendar [attach screenshot]"
```

Supported formats: PNG, JPEG, GIF

The server can extract:
- Date and time information
- Event titles and descriptions
- Location details
- Attendee lists

### Best Practices for Image Recognition

1. Ensure text is clear and readable
2. Include full date/time information in the image
3. Highlight or circle important details
4. Use high contrast images

## Advanced Search

### Search Operators

- **By attendee**: "meetings with john@example.com"
- **By location**: "events at headquarters"
- **By time range**: "morning meetings this month"
- **By status**: "tentative events this week"

### Complex Queries

Combine multiple criteria:

```
"Find all meetings with the sales team at the main office that are longer than an hour in the next two weeks"
```

## Calendar Analysis

### Meeting Patterns

```
"How much time did I spend in meetings last week?"
"What percentage of my meetings are recurring?"
"Which day typically has the most meetings?"
```
## Performance Optimization

### Rate Limiting

Built-in protection against API limits:
- Automatic retry with exponential backoff in batch operations

## Integration Examples

### Daily Schedule

```
"Show me today's events and check for any scheduling conflicts between all my calendars"
```

### Weekly Planning

```
"Look at next week and suggest the best times for deep work blocks of at least 2 hours"
```

### Meeting Preparation

```
"For each meeting tomorrow, tell me who's attending, what the agenda is, and what materials I should review"
```

## Security Considerations

### Permission Scopes

The server only requests necessary permissions:
- `calendar.events`: Full event management
- Never requests email or profile access
- No access to other Google services

### Token Security

- Tokens stored locally with owner-only permissions (`0600`) in `~/.config/google-calendar-mcp/tokens.json`
- Automatic token refresh with durable multi-account storage
- Credentials never leave your machine (no remote storage)
- No tokens are written to logs or emitted over stdout/stderr

## Debugging

### Common Issues

1. **Token refresh failures**: Check network connectivity
2. **API quota exceeded**: Implement backoff strategies
3. **Timezone mismatches**: Ensure consistent timezone usage
