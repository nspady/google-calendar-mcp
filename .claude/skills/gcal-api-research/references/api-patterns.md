# Google Calendar API Patterns and Best Practices

This document outlines common patterns for working with Google Calendar API effectively.

## Event Querying Patterns

### Basic Event Listing
```
events.list({
  calendarId: 'primary',
  timeMin: (new Date()).toISOString(),
  maxResults: 10,
  singleEvents: true,
  orderBy: 'startTime'
})
```

**Key Parameters:**
- `singleEvents: true` - Expands recurring events into individual instances
- `orderBy: 'startTime'` - Only works with singleEvents=true
- `timeMin/timeMax` - Filter events by time range
- `maxResults` - Limit results (max 2500, use pagination for more)
- `pageToken` - For pagination through large result sets

### Recurring Event Instances
```
events.instances({
  calendarId: 'primary',
  eventId: 'recurringEventId',
  timeMin: startDate,
  timeMax: endDate
})
```

**When to Use:**
- Need all instances of a specific recurring event
- Checking for conflicts with recurring event instances
- Analyzing patterns in recurring event modifications

### Free/Busy Queries
```
freebusy.query({
  timeMin: startDate,
  timeMax: endDate,
  items: [{ id: 'calendar1@example.com' }, { id: 'calendar2@example.com' }]
})
```

**Best Practices:**
- More efficient than listing all events when only availability is needed
- Can query up to 50 calendars in one request
- Returns only busy periods, not event details
- Respects event visibility settings

## Event Modification Patterns

### Creating Events with Good Defaults

**Simple Event:**
```
{
  summary: 'Event Title',
  start: { dateTime: '2024-01-15T10:00:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2024-01-15T11:00:00', timeZone: 'America/Los_Angeles' }
}
```

**All-Day Event:**
```
{
  summary: 'All Day Event',
  start: { date: '2024-01-15' },
  end: { date: '2024-01-16' }  // End date is exclusive
}
```

**Event with Attendees:**
```
{
  summary: 'Meeting',
  attendees: [
    { email: 'user@example.com' },
    { email: 'user2@example.com', optional: true }
  ],
  conferenceData: {
    createRequest: {
      requestId: 'unique-string',
      conferenceSolutionKey: { type: 'hangoutsMeet' }
    }
  }
}
```

**Recurring Event:**
```
{
  summary: 'Weekly Standup',
  start: { dateTime: '2024-01-15T10:00:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2024-01-15T10:30:00', timeZone: 'America/Los_Angeles' },
  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10']
}
```

### Updating Events

**Full Update (events.update):**
- Replaces entire event resource
- Requires providing all fields (missing fields are cleared)
- Use when completely replacing an event

**Partial Update (events.patch):**
- Updates only specified fields
- More efficient for small changes
- Safer - won't accidentally clear fields

**Example: Patch vs Update**
```
// Patch - only changes title
events.patch({
  calendarId: 'primary',
  eventId: 'eventId',
  resource: { summary: 'New Title' }
})

// Update - must provide full event or fields get cleared
events.update({
  calendarId: 'primary',
  eventId: 'eventId',
  resource: fullEventObject
})
```

### Modifying Recurring Event Instances

**Single Instance Modification:**
1. Get the instance using events.instances()
2. Create a new event using events.insert() with:
   - `id` set to `recurringEventId_instanceTime`
   - `recurringEventId` field pointing to parent
3. Or use events.update() with the instance ID

**This and Following:**
- Use `recurringEventId` in query
- Update with specific instance start time
- Google API splits the recurrence

## Field Mask Patterns

Field masks reduce response size and improve performance.

### Minimal Event Fields
```
fields: 'items(id,summary,start,end,status)'
```

### Event with Attendees
```
fields: 'items(id,summary,start,end,attendees(email,responseStatus))'
```

### Full Event Details
```
fields: 'items(id,summary,description,start,end,attendees,recurrence,status,location)'
```

**Best Practices:**
- Request only needed fields
- Nested fields use parentheses: `attendees(email,responseStatus)`
- Include pagination tokens when using pagination: `fields: 'items(id,summary),nextPageToken'`

## Batch Request Patterns

### Multiple Operations in One Request
```
const batch = calendar.newBatch();

batch.add(calendar.events.insert({
  calendarId: 'primary',
  resource: event1
}));

batch.add(calendar.events.insert({
  calendarId: 'primary',
  resource: event2
}));

await batch.exec();
```

**When to Batch:**
- Creating multiple events at once
- Updating multiple events
- Querying multiple calendars
- Any set of independent operations

**Limitations:**
- Max 50 requests per batch
- Each request can succeed/fail independently
- Need to handle partial failures

## Conflict Detection Patterns

### Time-Based Conflict Detection
1. Query events in time range using events.list() with timeMin/timeMax
2. Compare with proposed event times
3. Check for overlaps considering:
   - Start/end times
   - Timezone differences
   - All-day vs timed events

### Freebusy-Based Conflict Detection
1. Use freebusy.query() for the time range
2. Check if any busy periods overlap with proposed event
3. More efficient than listing all events
4. Doesn't reveal event details (privacy-preserving)

### Multi-Calendar Conflict Detection
1. Query multiple calendars using batch requests or sequential calls
2. Aggregate busy periods across calendars
3. Consider calendar priorities/importance

## Pagination Patterns

### Listing All Events
```
let pageToken = undefined;
const allEvents = [];

do {
  const response = await calendar.events.list({
    calendarId: 'primary',
    pageToken: pageToken,
    maxResults: 250  // Balance between API calls and response size
  });

  allEvents.push(...response.data.items);
  pageToken = response.data.nextPageToken;
} while (pageToken);
```

**Best Practices:**
- Use reasonable maxResults (100-250 is typical)
- Always check for nextPageToken
- Consider timeMin/timeMax to reduce result set
- Use field masks to reduce response size

## Timezone Handling Patterns

### Explicit Timezone Specification
```
// Good - explicit timezone
{
  start: { dateTime: '2024-01-15T10:00:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2024-01-15T11:00:00', timeZone: 'America/Los_Angeles' }
}

// Avoid - relies on defaults
{
  start: { dateTime: '2024-01-15T10:00:00' },
  end: { dateTime: '2024-01-15T11:00:00' }
}
```

### Getting Calendar Timezone
```
const calendar = await calendar.calendars.get({
  calendarId: 'primary'
});
const timezone = calendar.data.timeZone;
```

### All-Day Event Timezone Handling
```
// All-day events use date format (no timezone)
{
  start: { date: '2024-01-15' },
  end: { date: '2024-01-16' }  // Exclusive end date
}
```

**Key Points:**
- All-day events: use `date` field (YYYY-MM-DD)
- Timed events: use `dateTime` field (ISO 8601) + `timeZone`
- End date for all-day events is exclusive
- When converting between all-day and timed, explicitly handle timezone

## Error Handling Patterns

### Retry with Exponential Backoff
```
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 429 || error.code >= 500) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Specific Error Handling
```
try {
  const result = await calendar.events.insert(...);
} catch (error) {
  if (error.code === 404) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Calendar not found'
    );
  } else if (error.code === 403) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Insufficient permissions or quota exceeded'
    );
  } else if (error.code === 409) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Conflict with existing event'
    );
  }
  throw error;
}
```

## Performance Optimization Patterns

### Reduce API Calls
- Use batch requests for multiple operations
- Use field masks to reduce response size
- Cache calendar timezone lookups
- Use freebusy.query() instead of events.list() when possible

### Efficient Queries
- Always specify timeMin/timeMax when possible
- Use maxResults to limit response size
- Use singleEvents=true for flattened recurring events
- Consider using showDeleted=false to exclude deleted events

### Rate Limiting
- Implement exponential backoff for 429 errors
- Use batch requests to stay under rate limits
- Consider request quotas (default: 1M requests/day, 100 requests/100 seconds per user)

## Authentication and Authorization Patterns

### Required Scopes
- `https://www.googleapis.com/auth/calendar.events` - Read/write events
- `https://www.googleapis.com/auth/calendar` - Full calendar access
- `https://www.googleapis.com/auth/calendar.readonly` - Read-only access

### Token Refresh
- OAuth2 tokens expire after ~1 hour
- Store and use refresh tokens for long-lived access
- Handle 401 errors by refreshing token and retrying

### Multi-Account Support
- Store tokens per account/user
- Use appropriate token for each calendar operation
- Handle account-specific errors appropriately
