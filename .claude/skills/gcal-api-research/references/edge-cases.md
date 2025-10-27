# Google Calendar API Edge Cases and Common Pitfalls

This document catalogs known edge cases, gotchas, and common issues when working with Google Calendar API.

## Recurring Events Edge Cases

### Instance ID Format
**Issue:** Recurring event instance IDs have a special format that's easy to get wrong.

**Correct Format:** `{recurringEventId}_{instanceStartTime}`
- Instance time must be in RFC3339 format with 'Z' (UTC): `20240115T100000Z`
- Underscores separate event ID from instance time
- Even if event is in different timezone, instance time uses UTC

**Example:**
```
Recurring event ID: abc123
Instance at 2024-01-15 10:00:00 PST
Correct instance ID: abc123_20240115T180000Z  (converted to UTC)
```

**Common Mistakes:**
- Using local time instead of UTC: `abc123_20240115T100000` ❌
- Using wrong format: `abc123-20240115T100000Z` ❌
- Forgetting the 'Z': `abc123_20240115T180000` ❌

### Modifying "This and Following" Instances
**Issue:** Updating "this and following" instances of a recurring event can orphan earlier exceptions.

**What Happens:**
1. Original recurring event: Every Monday from Jan 1 - Feb 28
2. Exception created: Jan 15 instance moved to Jan 16
3. Update "this and following" from Jan 22 onwards
4. Result: Jan 15 exception may become orphaned or behave unexpectedly

**Recommendation:**
- Warn users when modifying "this and following" with existing exceptions
- Consider querying for exceptions before making changes
- Document that exceptions before the split point may be affected

### Recurring Event Exceptions
**Issue:** Some operations aren't supported on recurring event exceptions.

**Limitations:**
- Can't make an exception recurring (no nested recurrence rules)
- Can't change an exception to a different recurring event
- Deleting parent event may orphan exceptions
- Some fields from parent event can't be overridden in exceptions

**Best Practice:**
- Check if event is an exception: `recurringEventId` field is present
- Validate operation is supported for exceptions before attempting
- Provide clear error messages when operation isn't supported

### Timezone Changes on Recurring Events
**Issue:** Changing timezone on a recurring event can cause instances to shift unexpectedly.

**Scenario:**
1. Recurring event: 10 AM PST every Monday
2. Change timezone to EST
3. All instances shift to 10 AM EST (3-hour change)

**Considerations:**
- DST transitions can cause unexpected shifts
- Existing exceptions may not shift with parent event
- Attendees in different timezones see different relative times

**Best Practice:**
- Warn users when changing timezone on recurring events
- Consider whether intent is to keep local time or absolute time
- Test with events that span DST transitions

## All-Day Event Edge Cases

### End Date is Exclusive
**Issue:** All-day event end dates are exclusive, which is counterintuitive.

**Example:**
```
// A single day all-day event on Jan 15
{
  start: { date: '2024-01-15' },
  end: { date: '2024-01-16' }  // Not '2024-01-15'!
}

// A multi-day event from Jan 15-17 (3 days)
{
  start: { date: '2024-01-15' },
  end: { date: '2024-01-18' }  // Not '2024-01-17'!
}
```

**Common Mistakes:**
- Setting end date same as start date (results in 0-day event) ❌
- Setting end date to last day of event (event appears 1 day short) ❌

### Converting Between All-Day and Timed Events
**Issue:** Converting between all-day and timed events requires format changes.

**All-Day → Timed:**
```
// Before
{ start: { date: '2024-01-15' } }

// After
{ start: { dateTime: '2024-01-15T00:00:00', timeZone: 'America/Los_Angeles' } }
```

**Timed → All-Day:**
```
// Before
{ start: { dateTime: '2024-01-15T10:00:00', timeZone: 'America/Los_Angeles' } }

// After
{ start: { date: '2024-01-15' } }  // Time component removed
```

**Gotcha:** Must add/remove both `date`/`dateTime` AND potentially `timeZone` fields.

### Timezone Handling for All-Day Events
**Issue:** All-day events don't have timezones, but their "start of day" depends on calendar timezone.

**Scenario:**
- Calendar timezone: America/Los_Angeles
- All-day event: 2024-01-15
- Event starts at 2024-01-15 00:00:00 PST (08:00:00 UTC)
- User in New York sees event start at 2024-01-15 00:00:00 EST (different UTC time)

**Best Practice:**
- Don't assume all-day events start at midnight UTC
- Consider calendar timezone when working with all-day events
- Be careful when comparing all-day and timed events

## Attendee and Response Edge Cases

### Attendees on Events You Don't Organize
**Issue:** Adding/removing attendees to events you didn't create has limitations.

**Limitations:**
- May not have permission to modify attendee list
- Can't send notifications if not organizer
- Changes may not sync to organizer's copy
- Some calendar settings prevent non-organizers from adding attendees

**Best Practice:**
- Check if user is organizer before attempting attendee modifications
- Provide clear error when permission is denied
- Consider suggesting user ask organizer to make changes

### Self-Attendee Response
**Issue:** Setting your own response status as an attendee has special handling.

**Scenario:**
- User is invited to event (appears on their calendar)
- User wants to decline
- Need to set their attendee responseStatus to 'declined'

**Gotcha:** Simply declining doesn't remove event from calendar (it's marked declined).

**Alternative:** Delete event from calendar to remove entirely (different from declining).

### Optional vs Required Attendees
**Issue:** "Optional" attendee status is client-side hint, not enforced by API.

**What It Does:**
- Sets `optional: true` field on attendee
- Calendar clients may display differently
- Doesn't affect notifications or permissions

**What It Doesn't Do:**
- Doesn't change whether attendee gets notifications
- Doesn't affect whether attendance is counted for room booking
- Not consistently displayed across all calendar clients

## Conference Data Edge Cases

### Creating Conference Data
**Issue:** Conference data creation requires special request format.

**Correct Format:**
```
{
  conferenceData: {
    createRequest: {
      requestId: 'unique-random-string',  // Must be unique
      conferenceSolutionKey: { type: 'hangoutsMeet' }
    }
  }
}
```

**Required:**
- Must include `conferenceDataVersion: 1` parameter in events.insert/update call
- `requestId` must be unique (recommended: UUID or similar)
- Only works on event creation or with proper parameters on update

**Common Mistakes:**
- Forgetting `conferenceDataVersion: 1` parameter ❌
- Reusing requestId across multiple events ❌
- Trying to modify conference data without proper parameters ❌

### Conference Data Permissions
**Issue:** Creating conference data may require additional permissions.

**Requirements:**
- Calendar API scope is not enough
- May need Google Meet or other conference solution permissions
- Workspace/domain settings may restrict conference creation
- Some conference solutions may not be available in all regions

## Permission and Access Edge Cases

### "primary" Calendar ID
**Issue:** "primary" is a special alias that may behave differently.

**Behaviors:**
- Always refers to user's primary calendar
- Can't be used to access someone else's shared calendar
- May have different permissions than explicitly-specified calendar IDs
- Some operations only work with "primary"

**Best Practice:**
- Accept "primary" as valid calendar ID
- Don't try to validate "primary" as email format
- Consider resolving "primary" to actual calendar ID for consistency

### Shared Calendar Access
**Issue:** Shared calendars may have limited permissions.

**Common Scenarios:**
- Read-only access: Can't create/modify/delete events
- Free/busy only: Can see busy/free, but not event details
- See all event details: Can read but not modify
- Make changes to events: Full access

**Gotcha:** permissions can vary per calendar, need to handle gracefully.

### Calendar List vs Calendar Access
**Issue:** Calendar appearing in user's list doesn't guarantee full access.

**Scenario:**
- Calendar appears in calendarList.list()
- User attempts to modify event
- Gets 403 Forbidden error

**Best Practice:**
- Check accessRole in calendar list
- Provide clear error when insufficient permissions
- Consider checking permissions before attempting operations

## Batch Request Edge Cases

### Partial Failures in Batch
**Issue:** Some requests in batch can succeed while others fail.

**What Happens:**
```
Batch with 5 requests:
- Request 1: Success (201)
- Request 2: Success (200)
- Request 3: Failed (404)
- Request 4: Success (200)
- Request 5: Failed (403)
```

**Implications:**
- Must check status of each response individually
- Can't rollback successful requests if some fail
- Need to communicate partial success to user

**Best Practice:**
- Check each response's status code
- Report which operations succeeded/failed
- Consider whether partial success is acceptable for use case

### Batch Request Size Limits
**Issue:** Batch requests have maximum size limits.

**Limits:**
- Max 50 requests per batch
- Total batch payload size limits (typically ~10MB)
- Individual request timeouts still apply

**Best Practice:**
- Chunk large operations into multiple batches
- Handle batch-level errors separately from request-level errors
- Consider whether batch is worth complexity for small numbers of requests

## Query and Filter Edge Cases

### ShowDeleted Events
**Issue:** Deleted events may appear in query results unless explicitly filtered.

**Default Behavior:**
- `showDeleted: false` by default
- Deleted events have `status: 'cancelled'`
- Cancelled events count toward pagination limits

**Considerations:**
- Need to filter cancelled events client-side if not using showDeleted
- Cancelled events have limited fields available
- Recurring event cancellations vs deletions behave differently

### Time Range Boundary Conditions
**Issue:** Events at exact boundary times may behave unexpectedly.

**Scenario:**
```
Query: timeMin='2024-01-15T10:00:00Z', timeMax='2024-01-15T11:00:00Z'
Event: start='2024-01-15T10:00:00Z', end='2024-01-15T11:00:00Z'
```

**Questions:**
- Is event included if it starts exactly at timeMin? (Yes)
- Is event included if it ends exactly at timeMax? (No, timeMax is exclusive)
- Is event included if it starts before timeMin and ends after? (Yes)

**Best Practice:**
- Be explicit about boundary behavior in documentation
- Test boundary conditions explicitly
- Consider using inclusive/exclusive consistently

### OrderBy Limitations
**Issue:** `orderBy` parameter only works with specific configurations.

**Requirements:**
- Can only use `orderBy: 'startTime'` when `singleEvents: true`
- Can't order by other fields (summary, updated, etc.)
- Recurring events without singleEvents=true can't be ordered

**Workaround:**
- Always use `singleEvents: true` if ordering is needed
- Sort client-side for other sorting requirements

## Rate Limiting and Quota Edge Cases

### Per-User vs Per-Project Quotas
**Issue:** Rate limits apply at multiple levels.

**Quota Types:**
- Per-project quota: 1M requests/day (default)
- Per-user quota: 100 requests/100 seconds per user
- Calendar-specific quotas may also apply

**Gotcha:** Can hit per-user limit even with available project quota.

**Best Practice:**
- Implement exponential backoff for 429 errors
- Consider rate limiting client-side for known intensive operations
- Use batch requests to reduce overall request count

### Free/Busy Query Limits
**Issue:** Freebusy queries have stricter limits than regular queries.

**Limits:**
- Max 50 calendars per freebusy query
- Shorter time ranges recommended for performance
- Higher failure rate under load

**Best Practice:**
- Chunk calendar lists into groups of 50 or fewer
- Use reasonable time ranges (prefer days/weeks over months)
- Implement retry logic for freebusy queries

## Event ID Edge Cases

### Event ID Format Validation
**Issue:** Event IDs have specific format requirements.

**Valid Format:**
- 5-1024 characters
- Lower case letters (a-z), numbers (0-9), underscore (_), and hyphen (-)
- Instance IDs also contain underscore and timestamp

**Invalid Examples:**
- Upper case letters ❌
- Special characters (@, !, etc.) ❌
- Spaces ❌
- Less than 5 characters ❌

**Best Practice:**
- Validate event IDs before using in API calls
- Provide clear error for invalid format
- Consider normalizing IDs (toLowerCase, etc.)

### Client-Assigned Event IDs
**Issue:** Can optionally specify event ID on creation, but has requirements.

**When Useful:**
- Idempotent event creation
- Integrating with external systems that have their own IDs
- Avoiding duplicate event creation

**Gotcha:** If ID already exists, get 409 Conflict error (not duplicate creation).

**Best Practice:**
- Generate IDs that meet format requirements
- Handle 409 errors appropriately (may indicate duplicate)
- Consider whether auto-generated IDs are sufficient

## Multi-Calendar Edge Cases

### Calendar Discovery
**Issue:** Finding all calendars user has access to can be tricky.

**Considerations:**
- calendarList.list() only shows calendars user has explicitly added
- User may have access to calendars not in their list
- Shared calendars may require explicit ID to access
- "primary" calendar always accessible but may not be in list

**Best Practice:**
- Use calendarList.list() as starting point
- Accept calendar IDs directly from user input
- Handle calendar-not-found errors gracefully

### Event Conflicts Across Calendars
**Issue:** User may have overlapping events across multiple calendars.

**Scenarios:**
- Work calendar + personal calendar with conflicting events
- Shared team calendars with overlapping responsibilities
- Different calendar types (event vs task calendars)

**Best Practice:**
- Allow querying multiple calendars for conflicts
- Consider calendar priority/importance in conflict detection
- Let user decide which calendars to check for conflicts

### Calendar-Specific Settings
**Issue:** Each calendar can have different default settings.

**Varies Per Calendar:**
- Default timezone
- Default event duration
- Default notification settings
- Access control (sharing) settings
- Color coding

**Best Practice:**
- Query calendar settings when needed (calendars.get)
- Don't assume all calendars have same defaults
- Cache calendar settings to reduce API calls
