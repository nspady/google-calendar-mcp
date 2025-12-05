# Multi-Account Concurrent Access Implementation

**Goal:** All authenticated accounts active simultaneously. LLM coordinates across work/personal calendars.

**Branch:** `feature/multi-account-concurrent`

---

## Core Architecture

### Multi-Client Loading ✅ COMPLETED
- [x] `TokenManager.loadAllAccounts()` → `Map<accountId, OAuth2Client>`
- [x] `TokenManager.getClient(accountId)` → single client
- [x] `TokenManager.listAccounts()` → account names + emails
- [x] Validation: `/^[a-z0-9_-]{1,64}$/` + reserved names blocked

### Calendar Deduplication
**Problem:** Same calendar accessible from multiple accounts with different permissions.

**Solution:** Unified calendar registry with permission tracking.

```typescript
interface UnifiedCalendar {
  calendarId: string;           // e.g., "abc123@group.calendar.google.com"
  accounts: {
    accountId: string;          // e.g., "work", "personal"
    accessRole: string;         // "owner", "writer", "reader"
    primary: boolean;
  }[];
  preferredAccount: string;     // Account with highest permission
}
```

**Logic:**
1. Query all accounts → aggregate calendars
2. Group by `calendarId`
3. Rank permissions: `owner` > `writer` > `reader`
4. Write operations use `preferredAccount`
5. Read operations use any account (fastest/most reliable)

- [x] `src/services/CalendarRegistry.ts` - Deduplication logic
- [ ] `src/services/CalendarRegistry.test.ts` - Permission ranking tests

---

## Phase 1: Multi-Account Core ✅ COMPLETED

### Token Management
- [x] `src/auth/tokenManager.ts` - Load all accounts on startup
- [x] `src/auth/paths.js` - Add validation (security fix)
- [x] `src/auth/utils.ts` - Add validation (security fix)

### Server Initialization
- [x] `src/server.ts` - Initialize `Map<accountId, OAuth2Client>`
- [x] `src/server.ts` - Pass accounts map to handlers
- [ ] MCP capability: Advertise available accounts in `initialize` response (deferred)

### Base Handler
- [x] `src/handlers/core/BaseToolHandler.ts` - Accept accounts map
- [x] `src/handlers/core/BaseToolHandler.ts` - `getClientForAccount(accountId)` method
- [x] `src/handlers/core/BaseToolHandler.ts` - Calendar registry integration (write-selection helpers)

---

## Phase 2: Tool Schema Updates ✅ COMPLETED

### Account Parameter (All Tools)
```typescript
account?: string | string[]  // Optional: single account or array for multi-account reads
```

**Behavior:**
- Read tools (list-events, list-calendars, search-events) merge all authenticated accounts when omitted; specify one or more accounts to filter.
- Mutation tools (create/update/delete) auto-select the account with write access to the target calendar when omitted; specifying an account forces that client.
- Get-type tools (`get-event`) still require explicit account when more than one is present.

### Files Updated
- [x] `src/tools/registry.ts` - Added `account` param to all tool schemas (string | string[])
- [x] `src/handlers/core/ListEventsHandler.ts` - Account parameter support
- [x] `src/handlers/core/CreateEventHandler.ts` - Account parameter support
- [x] `src/handlers/core/UpdateEventHandler.ts` - Account parameter support
- [x] `src/handlers/core/DeleteEventHandler.ts` - Account parameter support
- [x] `src/handlers/core/GetEventHandler.ts` - Account parameter support
- [x] `src/handlers/core/ListCalendarsHandler.ts` - Account parameter support
- [x] `src/handlers/core/SearchEventsHandler.ts` - Account parameter support
- [x] `src/handlers/core/GetCurrentTimeHandler.ts` - Account parameter support
- [x] `src/handlers/core/FreeBusyEventHandler.ts` - Account parameter support
- [x] `src/handlers/core/ListColorsHandler.ts` - Account parameter support
- [x] All test files updated to use accounts Map

---

## Phase 3: Account Management UI ✅ COMPLETED

### HTTP Endpoints
- [x] `GET /api/accounts` - List all accounts (id, email, status)
- [x] `POST /api/accounts` - Add account (accountId + OAuth flow)
- [x] `DELETE /api/accounts/:id` - Remove account
- [x] `POST /api/accounts/:id/reauth` - Re-authenticate expired account

### Web UI
- [x] `src/web/accounts.html` - Clean account manager interface
- [x] Account cards with email + status indicators (active/expired)
- [x] Add account form with validation
- [x] Remove/reauth actions with confirmation
- [x] Real-time status updates after operations
- [x] Updated build script to copy static files

### stdio Mode
- [x] `src/transports/stdio.ts` - Already loads all accounts on startup
- [ ] CLI: `npm start -- --account work,personal` (filter accounts) - deferred to Phase 4

---

## Phase 4: Cross-Account Tools (2 days)

### New Tool: find-calendar-conflicts
```typescript
{
  accounts: string[],        // ["work", "personal"]
  timeMin: string,
  timeMax: string,
  calendarId?: string        // Optional: specific calendar to check
}
```

Returns overlapping events across specified accounts.

- [x] `src/handlers/core/FindCalendarConflictsHandler.ts`
- [x] `src/handlers/core/FindCalendarConflictsHandler.test.ts`
- [x] Add to `src/tools/registry.ts`
- [x] Integration coverage in `src/tests/integration/multi-account.test.ts`

### Enhanced list-events
- [x] Support `account: ["work", "personal"]` → merged results
- [x] Tag each event with source account
- [x] Sort chronologically across accounts

---

## Phase 5: Testing (2 days)

### Unit Tests
- [ ] `src/tests/unit/auth/multi-account.test.ts` - Token loading
- [ ] `src/tests/unit/auth/validation.test.ts` - Account ID validation (39 tests from PR #82 review)
- [x] `src/tests/unit/services/CalendarRegistry.test.ts` - Deduplication
- [ ] `src/tests/unit/handlers/multi-account-*.test.ts` - Each handler

### Integration Tests
- [x] `src/tests/integration/multi-account.test.ts` - Real multi-account flows
- [ ] Test calendar deduplication with real accounts
- [ ] Test cross-account conflict detection
- [ ] Test permission-based account selection

**Coverage Target:** >90%

---

## Technical Decisions

### Calendar Deduplication Strategy
1. **Discovery:** On first tool call, query all accounts' calendar lists
2. **Caching:** Cache unified registry for 5 minutes
3. **Permission Ranking:** `owner` (read-write-share) > `writer` (read-write) > `reader`
4. **Write Operations:** Always use `preferredAccount` (highest permission)
5. **Read Operations:** Use any account, prefer `preferredAccount`

### Account Parameter Behavior
| Tool Type | No account param | Single account | Multiple accounts |
|-----------|------------------|----------------|-------------------|
| Query (list-events) | All accounts | Specified account | Specified accounts (merged) |
| Mutation (create-event) | Error if >1 account | Specified account | Error (ambiguous) |
| Get (get-event) | Try all accounts | Specified account | Try specified accounts |

### Backward Compatibility
Single-account setups work unchanged (no `account` param needed).

---

## Open Risks

1. **Permission changes** - Calendar permissions can change; cache invalidation needed
2. **Token refresh** - One account's token expires; don't block other accounts
3. **Quota limits** - Multiple accounts = more API calls; implement smart caching
4. **Calendar ID collisions** - Rare but possible; validate during deduplication

---

## Success Criteria

- [ ] Add 2+ accounts via web UI in <60 seconds
- [ ] LLM can query both accounts: "show my work and personal events today"
- [ ] Write operations automatically use account with best permissions
- [ ] No security vulnerabilities (validation + isolation)
- [ ] >90% test coverage
- [ ] Zero breaking changes for single-account users

---

**Estimated Total:** 11 days (9 implementation + 2 testing)
