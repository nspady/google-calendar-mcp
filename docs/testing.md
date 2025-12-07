# Testing Guide

## Quick Start

```bash
npm test                 # Unit tests (no auth required)
npm run test:integration # Integration tests (requires Google auth)
npm run test:all         # All tests (requires Google auth + LLM API keys)
```

## Test Structure

- `src/tests/unit/` - Unit tests (mocked, no external dependencies)
- `src/tests/integration/` - Integration tests (real Google Calendar API calls)

## Unit Tests

**Requirements:** None - fully self-contained

**Coverage:**
- Request validation and schema compliance
- Error handling and edge cases
- Date/time parsing and timezone conversion logic
- Mock-based handler functionality
- Tool registration and validation

**Run with:**
```bash
npm test
```

## Integration Tests

Integration tests are divided into three categories based on their requirements:

### 1. Direct Google Calendar Integration

**Files:** `direct-integration.test.ts`

**Requirements:**
- Google OAuth credentials file
- Authenticated test account
- Real Google Calendar access

**Setup:**
```bash
# Set environment variables
export GOOGLE_OAUTH_CREDENTIALS="path/to/your/oauth-credentials.json"
export TEST_CALENDAR_ID="your-test-calendar-id"

# Authenticate test account
npm run dev auth:test
```

**What these tests do:**
- ✅ Create, read, update, delete real calendar events
- ✅ Test multi-calendar operations with batch requests
- ✅ Validate timezone handling with actual Google Calendar API
- ✅ Test recurring event patterns and modifications
- ✅ Verify free/busy queries and calendar listings
- ✅ Performance benchmarking with real API latency

**⚠️ Warning:** These tests modify real calendar data in your test calendar.

### 2. LLM Integration Tests

**Files:** `claude-mcp-integration.test.ts`, `openai-mcp-integration.test.ts`

**Requirements:**
- Google OAuth credentials + authenticated test account (from above)
- LLM API keys
- **LLM models that support MCP (Claude) or function calling (OpenAI)**

**Additional setup:**
```bash
# Set LLM API keys
export CLAUDE_API_KEY="your-claude-api-key"
export OPENAI_API_KEY="your-openai-api-key"

# Optional: specify models (must support MCP/function calling)
export ANTHROPIC_MODEL="claude-3-5-haiku-20241022"  # Default
export OPENAI_MODEL="gpt-4o-mini"                   # Default
```

**What these tests do:**
- ✅ Test end-to-end MCP protocol integration with Claude
- ✅ Test end-to-end MCP protocol integration with OpenAI
- ✅ Validate AI assistant can successfully call calendar tools
- ✅ Test complex multi-step AI workflows

**⚠️ Warning:** These tests consume LLM API credits and modify real calendar data.

**Important LLM Compatibility Notes:**
- **Claude**: Only Claude 3.5+ models support MCP. Earlier models will fail.
- **OpenAI**: Only GPT-4+ and select GPT-3.5-turbo models support function calling.
- If you see "tool not found" or "function not supported" errors, verify your model selection.

### Running Specific Integration Test Types

```bash
# Run only direct Google Calendar integration tests
npm run test:integration -- direct-integration.test.ts

# Run only LLM integration tests (requires API keys)
npm run test:integration -- claude-mcp-integration.test.ts
npm run test:integration -- openai-mcp-integration.test.ts

# Run all integration tests (requires both Google auth + LLM API keys)
npm run test:integration
```

## Environment Configuration

### Required Environment Variables

| Variable | Required For | Purpose | Example |
|----------|--------------|---------|---------|
| `GOOGLE_OAUTH_CREDENTIALS` | All integration tests | Path to OAuth credentials file | `./gcp-oauth.keys.json` |
| `TEST_CALENDAR_ID` | All integration tests | Target calendar for test operations | `test-calendar@gmail.com` or `primary` |
| `CLAUDE_API_KEY` | Claude integration tests | Anthropic API access | `sk-ant-api03-...` |
| `OPENAI_API_KEY` | OpenAI integration tests | OpenAI API access | `sk-...` |
| `INVITEE_1` | Attendee tests | Test attendee email | `test1@example.com` |
| `INVITEE_2` | Attendee tests | Test attendee email | `test2@example.com` |

### Optional Environment Variables

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `GOOGLE_ACCOUNT_MODE` | Default account nickname for auth flows | `normal` | Set to any lowercase nickname (e.g., `work`, `personal`) before running `npm run auth` |
| `DEBUG_LLM_INTERACTIONS` | Debug logging | `false` | Set `true` for verbose LLM logs |
| `ANTHROPIC_MODEL` | Claude model | `claude-3-5-haiku-20241022` | Must support MCP |
| `OPENAI_MODEL` | OpenAI model | `gpt-4o-mini` | Must support function calling |
| `MULTI_ACCOUNT_TESTS` | Enable `multi-account.test.ts` | `false` | Set to `true` to run cross-account integration tests |
| `MULTI_ACCOUNT_IDS` | Comma-separated account nicknames | _unset_ | Example: `work,personal` (requires tokens for each account) |

### Complete Setup Example

1. **Obtain Google OAuth Credentials:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing
   - Enable Google Calendar API
   - Create OAuth 2.0 credentials (Desktop app type)
   - Download credentials JSON file
   - Save as `gcp-oauth.keys.json` in project root

2. **Create `.env` file in project root:**
```env
# Required for all integration tests
GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json
TEST_CALENDAR_ID=test-calendar@gmail.com

# Required for LLM integration tests
CLAUDE_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...

# Required for attendee tests
INVITEE_1=test1@example.com
INVITEE_2=test2@example.com

# Optional configurations
GOOGLE_ACCOUNT_MODE=test
DEBUG_LLM_INTERACTIONS=false
ANTHROPIC_MODEL=claude-3-5-haiku-20241022
OPENAI_MODEL=gpt-4o-mini
```

3. **Authenticate Test Account:**
```bash
# Creates tokens in ~/.config/google-calendar-mcp/tokens.json
npm run dev auth:test
```

4. **Verify Setup:**
```bash
# Check authentication status
npm run dev account:status

# Run a simple integration test
npm run test:integration -- direct-integration.test.ts
```

5. **Run multi-account integration tests (optional):**
```bash
export MULTI_ACCOUNT_TESTS=true
export MULTI_ACCOUNT_IDS=work,personal
vitest run src/tests/integration/multi-account.test.ts
```
These tests verify cross-account list-events merging. Each account listed in `MULTI_ACCOUNT_IDS` must already be authenticated.

> **Tip:** Authenticate multiple accounts with `npm run account auth <nickname>` for each one (e.g., `work`, `personal`). All tokens share the same storage file, so integration tests can switch accounts by passing the `account` parameter.


## Troubleshooting

### Common Issues

**Authentication Errors:**
- **"No credentials found"**: Run `npm run dev auth:test` to authenticate
- **"Token expired"**: Re-authenticate with `npm run dev auth:test`
- **"Invalid credentials"**: Check `GOOGLE_OAUTH_CREDENTIALS` path is correct
- **"Refresh token must be passed"**: Delete tokens and re-authenticate

**API Errors:**
- **Rate limits**: Tests include retry logic, but may still hit limits with frequent runs
- **Calendar not found**: Verify `TEST_CALENDAR_ID` exists and is accessible
- **Permission denied**: Ensure test account has write access to the calendar
- **"Invalid time range"**: Free/busy queries limited to 3 months between timeMin and timeMax

**LLM Integration Errors:**
- **"Invalid API key"**: Check `CLAUDE_API_KEY`/`OPENAI_API_KEY` are set correctly
- **"Insufficient credits"**: LLM tests consume API credits - ensure account has balance
- **"Model not found"**: Verify model name and availability in your API plan
- **"Tool not found" or "Function not supported"**: 
  - Claude: Ensure using Claude 3.5+ model that supports MCP
  - OpenAI: Ensure using GPT-4+ or compatible GPT-3.5-turbo model
- **"Maximum tokens exceeded"**: Some complex tests may hit token limits with verbose models
- **Network timeouts**: LLM tests may take 2-5 minutes due to AI processing time

### Test Data Management

**Calendar Cleanup:**
- Tests attempt to clean up created events automatically
- Failed tests may leave test events in your calendar
- Manually delete events with "Integration Test" or "Test Event" in the title if needed

**Test Isolation:**
- Use a dedicated test calendar (`TEST_CALENDAR_ID`)
- Don't use your personal calendar for testing
- Consider creating a separate Google account for testing

### Performance Considerations

**Test Duration:**
- Unit tests: ~2 seconds
- Direct integration tests: ~30-60 seconds  
- LLM integration tests: ~2-5 minutes (due to AI processing)
- Full test suite: ~5-10 minutes

**Parallel Execution:**
- Unit tests run in parallel by default
- Integration tests run sequentially to avoid API conflicts
- Use `--reporter=verbose` for detailed progress during long test runs

## Development Tips

### Debugging Integration Tests

1. **Enable Debug Logging:**
```bash
# Debug all LLM interactions
export DEBUG_LLM_INTERACTIONS=true
```

2. **Run Single Test:**
```bash
# Run specific test by name pattern
npm run test:integration -- -t "should handle timezone"
```

3. **Interactive Testing:**
```bash
# Use the dev menu for quick access to test commands
npm run dev
```

### Writing New Integration Tests

1. **Use Test Data Factory:**
```typescript
import { TestDataFactory } from './test-data-factory.js';

const factory = new TestDataFactory();
const testEvent = factory.createTestEvent({
  summary: 'My Test Event',
  start: factory.getTomorrowAt(14, 0),
  end: factory.getTomorrowAt(15, 0)
});
```

2. **Track Created Events:**
```typescript
// Events are automatically tracked for cleanup
const eventId = TestDataFactory.extractEventIdFromResponse(result);
```

3. **LLM Context Logging:**
```typescript
// Wrap LLM operations for automatic error logging
await executeWithContextLogging('Test Name', async () => {
  const response = await llmClient.sendMessage('...');
  // Test assertions
});
```

### Best Practices

1. **Environment Isolation:**
   - Always use `GOOGLE_ACCOUNT_MODE=test` for testing
   - Use a dedicated test calendar, not personal calendar
   - Consider separate Google account for testing

2. **Cost Management:**
   - LLM tests consume API credits
   - Run specific tests during development
   - Use smaller/cheaper models for initial testing

3. **Test Data:**
   - Tests auto-cleanup created events
   - Use unique event titles with timestamps
   - Verify cleanup in afterEach hooks

4. **Debugging Failures:**
   - Check `DEBUG_LLM_INTERACTIONS` output for LLM tests
   - Verify model compatibility for tool/function support
   - Check API quotas and rate limits
