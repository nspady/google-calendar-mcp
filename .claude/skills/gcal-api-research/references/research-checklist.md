# Google Calendar API Implementation Review Checklist

Use this checklist when reviewing PRs or planning new features that involve Google Calendar APIs.

## API Method Selection

### Questions to Ask
- Is the correct API method being used for the operation?
- Are there alternative methods that might be more appropriate?
- Does the method support all the required functionality?

### Common Method Decisions
- **events.insert vs events.quickAdd**: Use `insert` for full control, `quickAdd` for simple natural language events
- **events.update vs events.patch**: Use `update` for complete replacement, `patch` for partial updates
- **events.list vs events.instances**: Use `list` for regular events, `instances` for getting occurrences of recurring events
- **events.delete vs events.update (status=cancelled)**: Hard delete removes event, cancellation preserves history

### Research Steps
1. Search Google Calendar API v3 documentation for the specific feature
2. Check Stack Overflow for "google calendar api [feature]" to find common issues
3. Look for GitHub issues in popular calendar libraries for edge cases
4. Review Google Calendar API sample code for recommended patterns

## Recurring Events

### Critical Checks
- Does the implementation handle single instances vs all instances vs following instances?
- Are recurring event IDs being validated correctly? (format: `eventId_instanceTime`)
- Is the `recurringEventId` field being used when needed?
- Does the code handle exceptions to recurring events?

### Known Issues to Check
- Modifying recurring event instances requires special ID format
- Timezone changes on recurring events can create unexpected behavior
- Deleting "thisAndFollowing" can orphan earlier exceptions
- Some operations aren't supported on recurring event exceptions

### Research Steps
1. Search for "google calendar api recurring event [operation]"
2. Check for issues with "recurring event" + the specific feature
3. Look for discussions about `recurringEventId` edge cases

## Timezone Handling

### Critical Checks
- Is timezone being specified explicitly rather than relying on defaults?
- Are all-day events handled differently from timed events?
- Does the code handle timezone conversions correctly?
- Are ISO 8601 formats being used correctly?

### Common Pitfalls
- Mixing all-day event format (date only) with timed event format (dateTime)
- Not specifying timezone for timed events
- Assuming calendar default timezone matches user's timezone
- Incorrect handling of DST transitions

### Research Steps
1. Search for "google calendar api timezone" best practices
2. Check for issues with specific timezone edge cases
3. Look for ISO 8601 format validation examples

## Batch Operations

### Critical Checks
- Are multiple calendar operations being batched when possible?
- Is the batch size within limits (max 50 requests per batch)?
- Are batch errors being handled individually?
- Is the code using the correct batch request format?

### Performance Considerations
- Batching reduces API calls and improves performance
- Each request in batch can succeed/fail independently
- Batch requests have different rate limits than individual requests

### Research Steps
1. Search "google calendar api batch requests" documentation
2. Check for batch request examples and patterns
3. Look for common batch operation errors

## Multi-Calendar Operations

### Critical Checks
- Does the code handle calendar IDs correctly (including "primary")?
- Are ACL/permissions being checked when accessing multiple calendars?
- Is the code handling calendar-not-found errors gracefully?
- Are results being aggregated correctly across calendars?

### Common Issues
- Assuming all calendars have same permissions
- Not handling "calendar not found" for shared calendars
- Incorrect sorting/merging of events from multiple calendars
- Rate limiting when querying many calendars

### Research Steps
1. Search "google calendar api multiple calendars"
2. Check for calendar list and ACL best practices
3. Look for multi-calendar aggregation patterns

## Error Handling

### Critical Checks
- Are Google API errors being caught and translated appropriately?
- Are rate limit errors (429) being handled with exponential backoff?
- Are quota errors being reported clearly?
- Are transient errors being retried?

### Common Errors to Handle
- 400: Bad request (validation error)
- 401: Unauthorized (auth token issue)
- 403: Forbidden (quota exceeded or insufficient permissions)
- 404: Not found (event/calendar doesn't exist)
- 409: Conflict (concurrent modification)
- 429: Rate limit exceeded
- 500/503: Server errors (should retry)

### Research Steps
1. Search "google calendar api error [code]" for specific errors
2. Check for retry strategies and backoff patterns
3. Look for quota management best practices

## Response Structure

### Critical Checks
- Is the response using structured response types from `src/types/structured-responses.ts`?
- Are all relevant fields being returned to the user?
- Is sensitive information being filtered out?
- Are field masks being used to reduce response size when appropriate?

### Best Practices
- Use field masks to request only needed fields
- Transform Google API responses to MCP-friendly formats
- Include relevant metadata in responses
- Provide clear error messages

### Research Steps
1. Check Google Calendar API field mask documentation
2. Look for examples of response transformation
3. Review existing handlers for response patterns

## Testing Considerations

### Critical Checks
- Can the feature be unit tested with mocks?
- Does the feature require integration testing?
- Are there specific test calendars/events needed?
- What edge cases need explicit test coverage?

### Test Data Considerations
- Use test calendar ID (from TEST_CALENDAR_ID env var)
- Clean up test events after tests
- Handle rate limiting in integration tests
- Test with different timezones

### Research Steps
1. Check for testing patterns in similar Google Calendar implementations
2. Look for test data generation approaches
3. Review integration test examples
