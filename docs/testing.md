# Testing Guide

## Quick Start

```bash
npm test            # Unit tests
npm run test:all    # All tests (requires auth)
```

## Test Structure

- `src/tests/unit/` - Unit tests (no auth required)
- `src/tests/integration/` - Integration tests (real API calls)

## Unit Tests

No external dependencies required. Test request validation, error handling, date/time parsing, schema compliance.

## Integration Tests

Require real Google account and API access. See test file headers for specific requirements.

### Setup
```bash
npm run dev auth:test     # Authenticate test account
```

**Requirements:**
- `GOOGLE_OAUTH_CREDENTIALS` - OAuth credentials file path
- `TEST_CALENDAR_ID` - Real calendar ID
- API keys for AI tests (`CLAUDE_API_KEY`, `OPENAI_API_KEY`)

**Warning:** Modifies real calendar data and consumes API credits.


## Troubleshooting

- **"No credentials found"**: Run `npm run dev auth:test`
- **"Token expired"**: Re-authenticate with `npm run dev auth:test`
- **Rate limits**: Tests include retry logic