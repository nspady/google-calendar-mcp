# Multi-Account Concurrent Access Implementation

**Goal:** All authenticated accounts active simultaneously. LLM coordinates across work/personal calendars.

**Branch:** `feature/multi-account-concurrent`

---

## Core Architecture

### Multi-Client Loading
- [ ] `TokenManager.loadAllAccounts()` → `Map<accountId, OAuth2Client>`
- [ ] `TokenManager.getClient(accountId)` → single client
- [ ] `TokenManager.listAccounts()` → account names + emails
- [ ] Validation: `/^[a-z0-9_-]{1,64}$/` + reserved names blocked

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

- [ ] `src/services/CalendarRegistry.ts` - Deduplication logic
- [ ] `src/services/CalendarRegistry.test.ts` - Permission ranking tests

---

## Phase 1: Multi-Account Core (3 days)

### Token Management
- [ ] `src/auth/tokenManager.ts` - Load all accounts on startup
- [ ] `src/auth/paths.js` - Add validation (security fix)
- [ ] `src/auth/utils.ts` - Add validation (security fix)

### Server Initialization
- [ ] `src/server.ts` - Initialize `Map<accountId, OAuth2Client>`
- [ ] `src/server.ts` - Pass accounts map to handlers
- [ ] MCP capability: Advertise available accounts in `initialize` response

### Base Handler
- [ ] `src/handlers/core/BaseToolHandler.ts` - Accept accounts map
- [ ] `src/handlers/core/BaseToolHandler.ts` - `getClient(accountId)` method
- [ ] `src/handlers/core/BaseToolHandler.ts` - Calendar registry integration

---

## Phase 2: Tool Schema Updates (2 days)

### Account Parameter (All Tools)
```typescript
account?: string | string[]  // Optional: single or multiple accounts
```

**Behavior:**
- Omitted + 1 account → use that account
- Omitted + multiple accounts → list all (for queries) or error (for mutations)
- Specified → use specified account(s)

### Files to Update
- [ ] `src/tools/registry.ts` - Add `account` param to all schemas
- [ ] `src/handlers/core/ListEventsHandler.ts` - Multi-account support
- [ ] `src/handlers/core/CreateEventHandler.ts` - Use preferredAccount
- [ ] `src/handlers/core/UpdateEventHandler.ts` - Use preferredAccount
- [ ] `src/handlers/core/DeleteEventHandler.ts` - Use preferredAccount
- [ ] `src/handlers/core/GetEventHandler.ts` - Any account
- [ ] `src/handlers/core/ListCalendarsHandler.ts` - Suggest account, deduplicate results
- [ ] Remaining 8+ handlers - Account parameter support

---

## Phase 3: Account Management UI (2 days)

### HTTP Endpoints
- [ ] `GET /accounts` - List all accounts (id, email, status)
- [ ] `POST /accounts` - Add account (name + OAuth flow)
- [ ] `DELETE /accounts/:id` - Remove account
- [ ] `POST /accounts/:id/reauth` - Re-authorize account

### Web UI
- [ ] `src/ui/accounts.html` - Account manager interface
- [ ] Account cards with email + status indicators
- [ ] Add account flow with OAuth popup
- [ ] Remove/reauth actions

### stdio Mode
- [ ] `src/transports/stdio.ts` - Load all accounts on startup
- [ ] CLI: `npm start -- --account work,personal` (filter accounts)

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

- [ ] `src/handlers/core/FindCalendarConflictsHandler.ts`
- [ ] `src/handlers/core/FindCalendarConflictsHandler.test.ts`
- [ ] Add to `src/tools/registry.ts`

### Enhanced list-events
- [ ] Support `account: ["work", "personal"]` → merged results
- [ ] Tag each event with source account
- [ ] Sort chronologically across accounts

---

## Phase 5: Testing (2 days)

### Unit Tests
- [ ] `src/tests/unit/auth/multi-account.test.ts` - Token loading
- [ ] `src/tests/unit/auth/validation.test.ts` - Account ID validation (39 tests from PR #82 review)
- [ ] `src/tests/unit/services/CalendarRegistry.test.ts` - Deduplication
- [ ] `src/tests/unit/handlers/multi-account-*.test.ts` - Each handler

### Integration Tests
- [ ] `src/tests/integration/multi-account.test.ts` - Real multi-account flows
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
