# Advanced Usage Guide

This guide covers advanced features and use cases for the Google Calendar MCP Server.

## Multi-Account Support

The server supports managing multiple Google accounts (e.g., personal and a test calendar).

### Setup Multiple Accounts

```bash
# Authenticate normal account
npm run auth

# Authenticate test account
npm run auth:test

# Check status
npm run account:status
```

### Account Management Commands

```bash
npm run account:clear:normal    # Clear normal account tokens
npm run account:clear:test      # Clear test account tokens
npm run account:migrate         # Migrate from old token format
```

### Using Multiple Accounts

The server intelligently determines which account to use:
- Normal operations use your primary account
- Integration tests automatically use the test account
- Accounts are isolated and secure

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

## Smart Scheduling

### Natural Language Understanding

The server interprets various time expressions:
- "next Tuesday at 2pm"
- "tomorrow morning"
- "in 3 days"
- "end of next week"
- "first Monday of next month"

### Timezone Handling

All times require explicit timezone information:
- Automatic timezone detection based on your calendar settings
- Support for scheduling across timezones
- Proper handling of daylight saving time transitions

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

### Attendee Insights

```
"Who haven't I met with in the last month?"
"Which meetings have the most declined invitations?"
"Show me meetings where I'm optional"
```

## Performance Optimization

### Caching

The server implements intelligent caching:
- Calendar list cached for 5 minutes
- Color definitions cached for session
- Free/busy data cached based on query range

### Rate Limiting

Built-in protection against API limits:
- Automatic retry with exponential backoff
- Batch operations to minimize API calls
- Concurrent request management

## Integration Examples

### Daily Briefing

```
"Give me a summary of today's schedule, highlighting any conflicts, prep time needed, and travel time between locations"
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

- Tokens encrypted at rest
- Automatic token refresh
- Secure credential storage
- No tokens in logs or debug output

## Debugging

### Enable Debug Logging

```bash
DEBUG=mcp:* npm start
```

### Common Issues

1. **Token refresh failures**: Check network connectivity
2. **API quota exceeded**: Implement backoff strategies
3. **Timezone mismatches**: Ensure consistent timezone usage

See [Troubleshooting Guide](troubleshooting.md) for detailed solutions.