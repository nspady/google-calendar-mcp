# Example: PR Review Research Output

**PR:** #119 - Support converting between timed and all-day events in update-event

**Research Date:** October 2024

**Researched By:** gcal-api-research skill

---

## API Research Findings

### Implementation Approach ✅

The PR uses the correct API method (`events.update`) for modifying event time formats. The implementation properly handles the transition between:
- **Timed events** (`dateTime` + `timeZone` fields)
- **All-day events** (`date` field only)

**API Method Validation:**
- ✅ Using `events.update` (correct for modifying existing events)
- ✅ Properly clears `dateTime`/`timeZone` when converting TO all-day
- ✅ Properly clears `date` when converting TO timed events
- ✅ Uses field masks to specify exactly what's changing

**Reference:** See `references/api-patterns.md` → "Event Modification Patterns" → "Converting Event Types"

### Edge Cases to Consider

Based on `references/edge-cases.md` → "All-Day Event Edge Cases", the following scenarios require special attention:

#### 1. Timezone Preservation (CRITICAL) ⚠️
**Issue:** When converting all-day → timed, the implementation must determine what timezone to use.

**Current Status:** ✅ Implementation uses explicit `timeZone` parameter or falls back to calendar's default timezone

**Recommendation:** Add integration test verifying timezone behavior:
```typescript
// Test case: Convert all-day event to timed event
// Verify: Uses calendar's default timezone when timeZone not specified
```

#### 2. Multi-Day All-Day Events (MEDIUM) ⚠️
**Issue:** All-day events spanning multiple days use `start.date` and `end.date` with exclusive end dates.

**Example:**
- Event from Jan 1-3 has `start.date: "2024-01-01"`, `end.date: "2024-01-04"` (exclusive)
- Converting to timed event: what times should be used?

**Current Status:** ⚠️ Needs validation - check if implementation handles multi-day events appropriately

**Recommendation:**
- Add test case for multi-day all-day event conversion
- Document expected behavior: should it convert to start of first day and end of last day?
- Consider: Should multi-day all-day → timed conversion be blocked?

#### 3. Recurring All-Day Events (HIGH) ⚠️
**Issue:** Converting a recurring all-day event instance to timed can create unexpected behavior across the series.

**Known Problem from Stack Overflow:**
> "When you convert one instance of a recurring all-day event to a timed event, the instance becomes an exception. However, Google Calendar may show inconsistent times across different timezones for that exception."

**Current Status:** ⚠️ Check if implementation validates recurring event scope (`thisEventOnly`, `thisAndFollowing`, `all`)

**Recommendation:**
- Require explicit scope when modifying recurring event instances
- Add test case: Convert single instance of recurring all-day event
- Add test case: Attempt to convert entire recurring series
- Consider warning users about recurring event complications

#### 4. Attendee Notifications (MEDIUM) 💬
**Issue:** Converting event formats triggers attendee notifications by default.

**Current Status:** ⚠️ Check if `sendUpdates` parameter is exposed

**Recommendation:**
- Expose `sendUpdates` parameter (`all`, `externalOnly`, `none`)
- Default to `externalOnly` (notifies external attendees only)
- Document in tool description that format changes trigger notifications

### Suggested Improvements

#### Code Changes

1. **Add Recurring Event Validation** (src/handlers/core/UpdateEventHandler.ts):
```typescript
// Before converting event type, check if it's a recurring instance
if (event.recurringEventId && !args.modificationScope) {
  throw new McpError(
    ErrorCode.InvalidParams,
    "Converting event format for recurring event instances requires 'modificationScope' parameter"
  );
}
```

2. **Add Multi-Day Detection** (src/handlers/core/UpdateEventHandler.ts):
```typescript
// Detect multi-day all-day events
if (event.start.date && event.end.date) {
  const daysDiff = calculateDaysDifference(event.start.date, event.end.date);
  if (daysDiff > 1) {
    // Log warning or require confirmation
    console.warn(`Converting multi-day all-day event (${daysDiff} days) to timed event`);
  }
}
```

3. **Expose sendUpdates Parameter** (src/tools/registry.ts):
```typescript
sendUpdates: z.enum(['all', 'externalOnly', 'none'])
  .optional()
  .describe('Whether to send notifications to attendees. Default: externalOnly'),
```

#### Documentation Updates

**Add to tool description:**
```
Note: Converting between timed and all-day events may trigger attendee notifications.
For recurring events, specify 'modificationScope' to control which instances are affected.
```

### Testing Recommendations

Add these test cases to `src/tests/integration/direct-integration.test.ts`:

```typescript
describe('Event Type Conversion', () => {
  it('should convert timed event to all-day event', async () => {
    // Create timed event
    // Convert to all-day
    // Verify: date field present, dateTime/timeZone absent
  });

  it('should convert all-day event to timed event with explicit timezone', async () => {
    // Create all-day event
    // Convert to timed with timeZone specified
    // Verify: dateTime/timeZone present, date absent, correct timezone
  });

  it('should convert all-day event to timed using calendar default timezone', async () => {
    // Create all-day event
    // Convert to timed WITHOUT timeZone parameter
    // Verify: Uses calendar's default timezone
  });

  it('should handle multi-day all-day event conversion', async () => {
    // Create 3-day all-day event
    // Convert to timed
    // Verify: Appropriate start/end times
  });

  it('should require modificationScope for recurring event instance conversion', async () => {
    // Create recurring all-day event
    // Attempt to convert single instance without scope
    // Verify: Error thrown with clear message
  });

  it('should convert recurring event instance with proper scope', async () => {
    // Create recurring all-day event
    // Convert single instance with modificationScope: 'thisEventOnly'
    // Verify: Only that instance is converted
  });
});
```

### Community-Reported Issues

**From Stack Overflow (search: "google calendar api convert all-day timed"):**

1. **Timezone Confusion:** Multiple developers report unexpected timezone shifts when converting events
   - **Solution:** Always specify timezone explicitly when converting TO timed events
   - **Status:** ✅ Implementation handles this correctly

2. **Missing dateTime Field:** Common error when converting without properly clearing the `date` field
   - **Solution:** Use field masks to explicitly clear old fields
   - **Status:** ✅ Implementation uses field masks appropriately

3. **Recurring Event Exceptions:** Converting recurring instances can create orphaned exceptions
   - **Solution:** Validate recurring event modifications carefully
   - **Status:** ⚠️ Add validation as suggested above

### API Quotas & Performance

**Quota Impact:**
- Each conversion requires 1 API call (events.update)
- No batch optimization available for conversions (events are modified individually)
- Within typical quota limits (10,000 requests/day for free tier)

**Performance Considerations:**
- Conversion is synchronous (immediate)
- No special caching needed
- Field masks optimize payload size ✅

---

## Summary

**Overall Assessment:** ✅ APPROVED with suggested improvements

The PR uses the correct API approach and handles the basic conversion correctly. However, three areas need attention:

**Critical (Must Fix):**
- ⚠️ Add validation for recurring event conversions (require `modificationScope`)

**Recommended (Should Fix):**
- ⚠️ Add test coverage for multi-day all-day event conversions
- ⚠️ Expose `sendUpdates` parameter for notification control

**Nice to Have (Optional):**
- Consider adding warnings for multi-day event conversions
- Add inline code comments referencing edge cases

**Test Coverage:** Expand integration tests to cover 6 new scenarios listed above.

**Documentation:** Update tool description to mention notification behavior and recurring event requirements.
