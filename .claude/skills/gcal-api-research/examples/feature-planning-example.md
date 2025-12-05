# Example: Feature Planning Research Output

**Feature:** Add `respond-to-event` tool for accepting/declining calendar invitations

**Research Date:** October 2024

**Researched By:** gcal-api-research skill

---

## Google Calendar API Research

### Recommended Approach

**Primary API Method:** `events.patch` or `events.update`

The Google Calendar API doesn't have a dedicated "respond to invitation" method. Instead, attendee responses are updated by modifying the event's `attendees` array.

**Key Implementation Pattern:**
1. Retrieve the event using `events.get`
2. Find the user's attendee entry in `event.attendees[]`
3. Update their `responseStatus` field
4. Use `events.patch` to send the minimal update
5. Set `sendUpdates: 'all'` to notify organizer and other attendees

**Reference Sources:**
- Official API: [events.patch documentation](https://developers.google.com/calendar/api/v3/reference/events/patch)
- `references/api-patterns.md` → "Event Modification Patterns" → "Updating Attendee Response"

### Required Functionality

#### Core Parameters

```typescript
interface RespondToEventParams {
  calendarId: string;          // Calendar containing the event
  eventId: string;             // Event to respond to
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  comment?: string;            // Optional response comment
  sendUpdates?: 'all' | 'externalOnly' | 'none';  // Default: 'all'
}
```

#### API Limitations

**1. Self-Identification Challenge** ⚠️
- The API requires you to know which attendee entry is "you"
- Must match authenticated user's email with an entry in `event.attendees[]`
- Edge case: User might be invited with alias email

**2. Organizer Cannot "Respond"** ⚠️
- Event organizers don't have a `responseStatus` (they're automatically attending)
- Must detect if user is organizer and handle appropriately

**3. Response Status Values**
- `needsAction` - No response yet (default)
- `declined` - Declined the invitation
- `tentative` - Maybe attending
- `accepted` - Confirmed attendance

**4. Recurring Events Complexity** ⚠️
- User can respond to individual instances differently
- Must support `modificationScope` for recurring events:
  - `thisEventOnly` - Respond to single instance
  - `thisAndFollowing` - Respond to this and future instances
  - `all` - Respond to entire series

### Edge Cases to Handle

Based on `references/edge-cases.md` → "Attendee Edge Cases":

#### 1. User Not Found in Attendees List (HIGH PRIORITY) 🚨
**Scenario:** User tries to respond to event where they're not an attendee

**Causes:**
- Event was forwarded to them (not officially invited)
- User was removed from attendees after initial invite
- User email doesn't match any attendee entry

**Recommended Handling:**
```typescript
const userEmail = await getUserEmail(oauth2Client);
const userAttendee = event.attendees?.find(a => a.email === userEmail);

if (!userAttendee) {
  throw new McpError(
    ErrorCode.InvalidRequest,
    `You are not listed as an attendee for this event. You may have been forwarded this invitation. Contact the organizer to be added.`
  );
}
```

#### 2. User Is Organizer (MEDIUM PRIORITY) ⚠️
**Scenario:** User tries to "respond" to their own event

**Recommended Handling:**
```typescript
if (event.organizer?.email === userEmail) {
  throw new McpError(
    ErrorCode.InvalidRequest,
    `You are the organizer of this event and cannot respond to it. Organizers are automatically marked as attending.`
  );
}
```

#### 3. Optional vs Required Attendees (LOW PRIORITY) ℹ️
**Scenario:** Attendee object has `optional: true` flag

**Behavior:**
- Optional attendees can still respond (accepted/declined/tentative)
- Flag is separate from response status
- No special handling needed, but could be surfaced in response

#### 4. Response Comments Not Always Preserved (MEDIUM PRIORITY) ⚠️
**Known Issue from GitHub Issues:**
> "Google Calendar API's `attendees[].comment` field is inconsistently preserved. Some clients don't display attendee comments, and comments may be lost on event updates."

**Recommended Handling:**
- Support `comment` parameter but document that it may not appear in all clients
- Consider omitting comment feature in v1, add in v2 if requested

#### 5. Recurring Event Instance Response (HIGH PRIORITY) 🚨
**Scenario:** User responds differently to different instances

**Example:**
- Accept first occurrence
- Decline second occurrence
- Tentative for remaining occurrences

**API Behavior:**
- Each instance modification creates an exception
- Must use instance-specific event IDs (format: `{recurringEventId}_{instanceTime}`)
- Response to base recurring event applies to all future instances

**Recommended Handling:**
```typescript
// Detect recurring event
if (event.recurrence || event.recurringEventId) {
  // Require explicit scope
  if (!args.modificationScope) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Responding to recurring events requires 'modificationScope' parameter ('thisEventOnly', 'thisAndFollowing', or 'all')"
    );
  }
}
```

#### 6. Delegation and Resource Calendars (LOW PRIORITY) 📅
**Scenario:** Responding on behalf of a resource (conference room) or delegated calendar

**Behavior:**
- User must have write access to the calendar
- Response shows the calendar owner's email, not the responder
- No additional handling needed (OAuth handles permissions)

### Good Defaults with Flexibility

**Recommended Default Values:**

```typescript
const defaults = {
  sendUpdates: 'all',           // Notify everyone (organizer + attendees)
  modificationScope: undefined  // Require explicit scope for recurring events
};
```

**Rationale:**
- `sendUpdates: 'all'` is polite (lets everyone know your response)
- Requiring explicit `modificationScope` prevents accidental series-wide responses
- No default for `comment` (optional parameter)

**Flexibility:**
- Allow `sendUpdates: 'none'` for silent responses (testing, batch operations)
- Allow `sendUpdates: 'externalOnly'` to notify only external attendees
- Support all `modificationScope` options for power users

### Implementation Complexity

**Estimated Complexity: MEDIUM** ⭐⭐⭐☆☆

**Low Complexity:**
- ✅ Single API method (`events.patch`)
- ✅ Simple parameter validation
- ✅ Clear success/failure states

**Medium Complexity:**
- ⚠️ User email identification (requires additional API call or token introspection)
- ⚠️ Attendee lookup logic
- ⚠️ Recurring event handling

**Complexity Drivers:**
1. **User Identification:** Need to determine authenticated user's email
   - Option A: Call `calendar.calendarList.get('primary')` to get user email
   - Option B: Parse email from OAuth token (more complex)
   - **Recommendation:** Use Option A (1 additional API call)

2. **Error Messaging:** Many edge cases require clear, actionable error messages

3. **Recurring Events:** Requires same complexity as other recurring event operations

**Estimated Development Time:** 4-6 hours (including tests)

### Implementation Plan

#### Step 1: Schema Definition (src/tools/registry.ts)
```typescript
'respond-to-event': z.object({
  calendarId: z.string()
    .describe('Calendar ID containing the event (use "primary" for main calendar)'),
  eventId: z.string()
    .describe('Event ID to respond to'),
  response: z.enum(['accepted', 'declined', 'tentative', 'needsAction'])
    .describe('Your response to the invitation'),
  modificationScope: z.enum(['thisEventOnly', 'thisAndFollowing', 'all'])
    .optional()
    .describe('For recurring events: which instances to respond to. Required for recurring events.'),
  sendUpdates: z.enum(['all', 'externalOnly', 'none'])
    .default('all')
    .describe('Whether to send notification emails. Default: all (notify organizer and attendees)'),
}).strict()
```

#### Step 2: Handler Implementation (src/handlers/core/RespondToEventHandler.ts)
```typescript
export class RespondToEventHandler extends BaseToolHandler {
  async runTool(args: RespondToEventParams, oauth2Client: OAuth2Client) {
    const calendar = this.getCalendar(oauth2Client);

    // 1. Get authenticated user's email
    const userEmail = await this.getUserEmail(oauth2Client);

    // 2. Retrieve the event
    const event = await calendar.events.get({
      calendarId: args.calendarId,
      eventId: args.eventId,
    });

    // 3. Validate user is an attendee (not organizer)
    if (event.data.organizer?.email === userEmail) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'You are the organizer of this event and cannot respond to it.'
      );
    }

    const userAttendee = event.data.attendees?.find(a => a.email === userEmail);
    if (!userAttendee) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'You are not an attendee of this event. Contact the organizer to be added.'
      );
    }

    // 4. Handle recurring events
    if (event.data.recurrence || event.data.recurringEventId) {
      if (!args.modificationScope) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Recurring events require 'modificationScope' parameter"
        );
      }
    }

    // 5. Update attendee response
    userAttendee.responseStatus = args.response;

    // 6. Patch the event
    const updated = await calendar.events.patch({
      calendarId: args.calendarId,
      eventId: args.eventId,
      sendUpdates: args.sendUpdates || 'all',
      requestBody: {
        attendees: event.data.attendees,
      },
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          eventId: updated.data.id,
          response: args.response,
          eventSummary: updated.data.summary,
        }, null, 2),
      }],
    };
  }

  private async getUserEmail(oauth2Client: OAuth2Client): Promise<string> {
    const calendar = this.getCalendar(oauth2Client);
    const calendarList = await calendar.calendarList.get({
      calendarId: 'primary',
    });
    return calendarList.data.id!;
  }
}
```

#### Step 3: Testing Strategy

**Unit Tests** (src/tests/unit/handlers/RespondToEventHandler.test.ts):
- ✅ Valid response updates attendee status
- ✅ Throws error when user is organizer
- ✅ Throws error when user not in attendees list
- ✅ Requires modificationScope for recurring events
- ✅ Handles all response types (accepted/declined/tentative/needsAction)

**Integration Tests** (src/tests/integration/direct-integration.test.ts):
- ✅ Accept invitation to single event
- ✅ Decline invitation with sendUpdates: 'none'
- ✅ Tentative response to recurring event instance
- ✅ Error handling for non-attendee
- ✅ Error handling for organizer attempting response

### Alternative Approaches Considered

#### Alternative 1: Separate Tools Per Response Type
```
accept-event, decline-event, tentative-event
```
**Pros:** Simpler per-tool implementation, more discoverable
**Cons:** Code duplication, harder to maintain
**Decision:** ❌ Not recommended - single tool is more flexible

#### Alternative 2: Use events.update Instead of events.patch
**Pros:** More explicit, full event data sent
**Cons:** Larger payload, potential to overwrite concurrent changes
**Decision:** ❌ Not recommended - patch is more efficient and safer

#### Alternative 3: Auto-Detect modificationScope
**Pros:** Fewer parameters, easier to use
**Cons:** Unexpected behavior (user might not realize they're responding to all instances)
**Decision:** ❌ Not recommended - explicit is better than implicit for recurring events

### Community Issues Found

**From Stack Overflow (search: "google calendar api respond to invitation"):**

1. **"How to accept calendar invitation via API"** (47 upvotes)
   - Solution: Update attendee response status via events.patch
   - Status: ✅ Addressed in implementation plan

2. **"Calendar API attendee response not updating"** (23 upvotes)
   - Cause: Not setting `sendUpdates` parameter
   - Solution: Always specify `sendUpdates`
   - Status: ✅ Included in schema with default value

3. **"Cannot find my email in attendees array"** (15 upvotes)
   - Cause: Email alias mismatch
   - Solution: Check OAuth token email vs attendee emails
   - Status: ⚠️ Consider fuzzy matching (user@gmail.com vs user@domain.com)

4. **"Recurring event response applies to all instances"** (31 upvotes)
   - Cause: Using base event ID instead of instance ID
   - Solution: Require explicit modificationScope
   - Status: ✅ Handled in implementation plan

### API Quotas & Performance

**Quota Impact:**
- Each response requires **2 API calls**:
  1. `events.get` (to retrieve current attendees)
  2. `events.patch` (to update response)
- Additional 1 call for user email lookup (can be cached)

**Optimization Opportunities:**
- Cache user email across multiple responses (session-level)
- Consider batching multiple responses (if tool is called multiple times)

**Rate Limits:**
- Well within standard limits (10,000 requests/day free tier)
- 2-3 calls per response = ~3,000 responses/day maximum

---

## Summary

### Recommended Implementation: ✅ PROCEED

The `respond-to-event` tool is feasible and valuable. The Google Calendar API supports this through attendee response modification.

### Key Decisions

✅ **Use `events.patch`** for efficient updates
✅ **Require explicit `modificationScope`** for recurring events
✅ **Default `sendUpdates: 'all'`** for polite notification behavior
✅ **Throw clear errors** for organizer responses and non-attendee cases

### Development Checklist

- [ ] Create `RespondToEventHandler.ts` extending `BaseToolHandler`
- [ ] Add schema to `src/tools/registry.ts` with validation rules
- [ ] Implement user email detection (with caching)
- [ ] Add comprehensive error handling for 4 edge cases
- [ ] Write 5 unit tests covering success and error paths
- [ ] Add 5 integration tests with real API calls
- [ ] Update CLAUDE.md with new tool documentation
- [ ] Consider adding to README.md examples

### Estimated Effort

- **Development:** 4 hours
- **Testing:** 2 hours
- **Documentation:** 30 minutes
- **Total:** ~6.5 hours

### Follow-Up Features (Future)

- 🔮 Batch response tool (respond to multiple invitations at once)
- 🔮 Smart suggestions (auto-detect conflicts before accepting)
- 🔮 Response templates (save common decline reasons)
- 🔮 Delegate responses (respond on behalf of resource calendars)
