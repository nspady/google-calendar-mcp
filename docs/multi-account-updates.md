# Multi-Account Updates

This document tracks the ongoing work required to provide seamless multi-account support across stdio, HTTP, and Docker deployments.

## Recent Improvements

- **Automatic account discovery** – The server now loads every authenticated account at startup and during each request. As long as one account has valid tokens, stdio clients no longer block on a single `GOOGLE_ACCOUNT_MODE` value.
- **Safe token persistence** – Token writes are serialized through an internal queue so concurrent refreshes from different accounts cannot corrupt `tokens.json`.
- **Read vs. write awareness** – Read-only handlers (e.g., `get-event`, `search-events`) now select any account that has *read* access to a calendar instead of demanding writer permissions.
- **Partial failure surfaced** – `list-events` reports per-account warnings whenever one of the accounts fails during a merged query, making it clear when results are incomplete.
- **Documentation + onboarding** – README and advanced usage docs now explain how to add accounts via CLI or the HTTP account manager UI, and clarify where tokens are stored.
- **Integration coverage** – Introduced `src/tests/integration/multi-account.test.ts`, an optional stdio integration suite powered by `MULTI_ACCOUNT_TESTS=true` + `MULTI_ACCOUNT_IDS=work,personal` to validate merged list-events output against real accounts.

## Usage Notes

1. **CLI / stdio**: run `npm run account auth <nickname>` for every account you want to connect (e.g., `work`, `personal`). The server automatically picks the right account for each operation.
2. **HTTP / Docker**: visit `http://<host>:<port>/accounts` to add, re-auth, or remove accounts with a browser.
3. **Tool parameters**: pass `account: "work"` (or `["work","personal"]`) to target specific accounts. Omitting `account` lets read-only tools merge data from every authenticated account, while write tools pick the account that has the highest permission on the requested calendar.

## Common Multi-Account Patterns

### Pattern 1: Unified Availability Check
Query all accounts to find free time:

```javascript
use_tool("list-events", {
  timeMin: "2025-03-01T09:00:00",
  timeMax: "2025-03-01T17:00:00"
  // account omitted = checks ALL accounts
});
```

Result includes events from work, personal, and any other authenticated accounts, sorted chronologically.

### Pattern 2: Account-Specific Creation
Explicitly create an event in a specific account:

```javascript
use_tool("create-event", {
  summary: "Team Standup",
  account: "work",  // Explicit account selection
  calendarId: "primary",
  start: "2025-03-02T10:00:00",
  end: "2025-03-02T10:30:00"
});
```

### Pattern 3: Smart Auto-Selection
Let the server choose the best account automatically:

```javascript
use_tool("create-event", {
  summary: "Project Update",
  calendarId: "team@company.com",  // Shared calendar
  // No account specified - server picks account with write access
  start: "2025-03-02T14:00:00",
  end: "2025-03-02T15:00:00"
});
```

The server automatically selects the account that has owner or writer permissions on `team@company.com`.

### Pattern 4: Selective Account Queries
Query only specific accounts:

```javascript
use_tool("list-events", {
  account: ["work"],  // Only work account
  timeMin: "2025-03-01T00:00:00",
  timeMax: "2025-03-01T23:59:59"
});
```

Useful when you want to focus on one account but have multiple connected.

## Upcoming Work

- Add integration tests that exercise stdio + HTTP transports with multiple authenticated accounts.
- Consider exposing richer status metadata (e.g., token freshness) through the MCP `initialize` response so clients can present account pickers automatically.
