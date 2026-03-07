# Production Release TODOs

Tracking list for items needed before/during production release of the MCP server as a hosted app (ChatGPT, Claude, etc.).

## ChatGPT App Submission

- [ ] **Set widget domain for UI templates** — ChatGPT warns: "Widget domain is not set for this template. A unique domain is required for app submission." The `ui://calendar/day-view.html` template needs a widget domain configured. Investigate ChatGPT's MCP app requirements for template/widget domains.
- [ ] **Review hidden tools behavior** — `ui-get-day-events` and `ui-get-event-details` are hidden by ChatGPT because they're tied to templates. Decide whether to: (a) set widget domains so they work in ChatGPT, (b) exclude them from the tool list when connected via HTTP/MCP OAuth, or (c) leave as-is (ChatGPT hides them gracefully).
- [ ] **CSP domains for UI templates** — The `day-view.html` template has empty CSP domain arrays (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`). These may need to be populated for ChatGPT app submission.

## OAuth & Security

- [ ] **Remove debug logging** — Clean up any remaining stderr debug logs added during development (check `McpOAuthProvider.ts`, `http.ts`)
- [ ] **Rate limiting review** — SDK applies default rate limits to `/token` (50 req/15min). Verify this is appropriate for production traffic.
- [ ] **Client registration limits** — Currently 27+ registered clients with no cleanup. Add expiration or cap on registered clients.

## Deployment

- [ ] **Merge `feature/railway-deployment` to `main`** — Once stable, merge the Railway deployment branch
- [ ] **Docker image optimization** — Review Dockerfile for production builds
- [ ] **Health check monitoring** — Set up monitoring on `/health` endpoint
