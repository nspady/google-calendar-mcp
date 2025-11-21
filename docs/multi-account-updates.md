# Multi-Account Updates

This document tracks the ongoing work required to provide seamless multi-account support across stdio, HTTP, and Docker deployments.

## Recent Improvements

- **Automatic account discovery** – The server now loads every authenticated account at startup and during each request. As long as one account has valid tokens, stdio clients no longer block on a single `GOOGLE_ACCOUNT_MODE` value.
- **Safe token persistence** – Token writes are serialized through an internal queue so concurrent refreshes from different accounts cannot corrupt `tokens.json`.
- **Read vs. write awareness** – Read-only handlers (e.g., `get-event`, `search-events`) now select any account that has *read* access to a calendar instead of demanding writer permissions.
- **Partial failure surfaced** – `list-events` reports per-account warnings whenever one of the accounts fails during a merged query, making it clear when results are incomplete.
- **Documentation + onboarding** – README and advanced usage docs now explain how to add accounts via CLI or the HTTP account manager UI, and clarify where tokens are stored.

## Usage Notes

1. **CLI / stdio**: run `GOOGLE_ACCOUNT_MODE=<accountId> npm run auth` (or `node scripts/account-manager.js auth <accountId>`) for every account you want to connect. The server automatically picks the right account for each operation.
2. **HTTP / Docker**: visit `http://<host>:<port>/accounts` to add, re-auth, or remove accounts with a browser.
3. **Tool parameters**: pass `account: "work"` (or `["work","personal"]`) to target specific accounts. Omitting `account` lets read-only tools merge data from every authenticated account, while write tools pick the account that has the highest permission on the requested calendar.

## Upcoming Work

- Implement the `find-calendar-conflicts` tool and multi-account upgrades to `list-events` outlined in `MULTI_ACCOUNT_IMPLEMENTATION.md`.
- Add integration tests that exercise stdio + HTTP transports with multiple authenticated accounts.
- Consider exposing richer status metadata (e.g., token freshness) through the MCP `initialize` response so clients can present account pickers automatically.
