# Multi-Tenant Architecture

The Google Calendar MCP Server now supports **multi-tenant mode** when running with HTTP transport. This allows multiple users to interact with their own Google Calendars simultaneously without requiring OAuth flow for each user at the server level.

## Overview

### Traditional (Single-User) Mode
- Server stores one OAuth token locally
- All requests use the same Google Calendar account
- OAuth flow required at server startup

### Multi-Tenant Mode (NEW)
- Server accepts tokens via HTTP Authorization header
- Each request can use a different Google Calendar account
- No OAuth flow required at server startup
- True multi-tenancy with isolated user contexts

## Architecture

```
Client App (manages OAuth) → [Authorization: Bearer <token>] → MCP Server → Google Calendar API
                                                                ↓
                                                    Uses token from request
                                                    No server-side storage
```

## How It Works

### 1. Transport Mode Detection

The server automatically enables multi-tenant support based on transport type:

- **stdio mode**: Traditional single-user authentication (for Claude Desktop)
- **HTTP mode**: Multi-tenant support enabled automatically

### 2. Token Flow

```
1. Client performs OAuth flow with Google (outside MCP server)
2. Client obtains access_token (and optionally refresh_token)
3. Client includes token in Authorization header with each MCP request
4. Server creates isolated OAuth2Client for that request
5. Request executes with user's credentials
6. No token is stored server-side
```

### 3. Request Context Isolation

Uses Node.js `AsyncLocalStorage` to maintain request context:
- Each request runs in isolated async context
- Tokens never leak between concurrent requests
- Thread-safe for high concurrency

## Usage

### Starting the Server in Multi-Tenant Mode

```bash
# Start server in HTTP mode
npm run start:http

# Or with custom port/host
node build/index.js --transport http --port 3000 --host 0.0.0.0
```

Server will output:
```
HTTP mode: Multi-tenant support enabled. Pass tokens via Authorization header.
No OAuth flow required at startup. Clients should provide their own access tokens.
Google Calendar MCP Server listening on http://127.0.0.1:3000
```

### Client Implementation

#### 1. Obtain OAuth Token

Clients should implement Google OAuth 2.0 flow:

```javascript
// Example using Google Auth Library
import { OAuth2Client } from 'google-auth-library';

const oauth2Client = new OAuth2Client(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'YOUR_REDIRECT_URI'
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ]
});

// User visits authUrl, gets code, then:
const { tokens } = await oauth2Client.getToken(code);
const accessToken = tokens.access_token;
const refreshToken = tokens.refresh_token;
```

#### 2. Make MCP Requests with Token

**Required Headers:**
- `Authorization: Bearer <access_token>` (required)
- `X-Refresh-Token: <refresh_token>` (optional, for auto-refresh)

**Example: List Events**

```javascript
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'X-Refresh-Token': refreshToken  // Optional
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'list-events',
      arguments: {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-31T23:59:59'
      }
    }
  })
});

const data = await response.json();
console.log(data.result);
```

**Example: Create Event**

```javascript
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userAccessToken}`
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'create-event',
      arguments: {
        calendarId: 'primary',
        summary: 'Team Meeting',
        start: '2024-12-01T10:00:00',
        end: '2024-12-01T11:00:00',
        location: 'Conference Room A',
        attendees: [
          { email: 'colleague@example.com' }
        ]
      }
    }
  })
});
```

#### 3. Multiple Users Simultaneously

```javascript
// User 1 creates event
const user1Response = fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${user1Token}`,
    // ...
  },
  body: JSON.stringify({ /* create event */ })
});

// User 2 lists events (concurrent request)
const user2Response = fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${user2Token}`,
    // ...
  },
  body: JSON.stringify({ /* list events */ })
});

// Both execute in parallel with isolated contexts
const [result1, result2] = await Promise.all([user1Response, user2Response]);
```

## Token Management

### Access Token Lifecycle

1. **Obtain**: Client gets token from Google OAuth
2. **Store**: Client stores token securely (never server-side)
3. **Include**: Client includes in Authorization header
4. **Validate**: Server validates format (optional)
5. **Use**: Server creates OAuth2Client per-request
6. **Expire**: Google tokens typically expire in 1 hour

### Refresh Token Support

Include refresh token for automatic token refresh:

```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'X-Refresh-Token': `${refreshToken}`
}
```

The server will use the refresh token to automatically refresh expired access tokens.

### Token Validation

Optional token validation utility:

```typescript
import { TokenValidator } from './auth/tokenValidator.js';

// Validate token format
const isValid = TokenValidator.isValidTokenFormat(token);

// Validate with Google (makes API call)
const result = await TokenValidator.validateAccessToken(token);
if (result.valid) {
  console.log('Token expires at:', result.expiresAt);
  console.log('User:', result.email);
}

// Check for calendar scopes
const hasScopes = await TokenValidator.hasCalendarScopes(token);
```

## Security Considerations

### Server-Side
✅ **No token storage**: Tokens only exist during request lifecycle
✅ **Isolated contexts**: AsyncLocalStorage prevents cross-request leaks
✅ **CORS configured**: Proper origin validation
✅ **Request size limits**: 10MB maximum payload
✅ **Origin validation**: DNS rebinding protection

### Client-Side
⚠️ **Secure token storage**: Store tokens encrypted on client
⚠️ **HTTPS in production**: Always use HTTPS for token transmission
⚠️ **Token rotation**: Implement token refresh logic
⚠️ **Scope limitation**: Request minimal required scopes
⚠️ **Token revocation**: Implement logout/revoke functionality

## Error Handling

### Authentication Errors

**No token provided (HTTP mode):**
```json
{
  "error": {
    "code": -32602,
    "message": "Authentication required. For HTTP mode, provide token via Authorization header."
  }
}
```

**Invalid token:**
```json
{
  "error": {
    "code": -32602,
    "message": "Failed to create OAuth client from provided token: Invalid credentials"
  }
}
```

**Expired token:**
Google API will return 401, client should refresh and retry.

### Best Practices

1. **Implement retry logic** for expired tokens
2. **Cache tokens** on client-side with expiry tracking
3. **Refresh proactively** before expiration
4. **Handle concurrent requests** properly
5. **Log authentication failures** for debugging

## Performance

### Token Caching

The `OAuth2ClientFactory` caches OAuth2Client instances:
- **Cache TTL**: 1 hour (configurable)
- **Cache key**: First 32 chars of access token
- **Memory efficient**: Automatic cleanup of expired entries

### Concurrency

- **AsyncLocalStorage overhead**: Minimal (~1-2% performance impact)
- **Concurrent requests**: Unlimited (within system resources)
- **Context isolation**: Zero cross-talk between requests

## Comparison: Single-User vs Multi-Tenant

| Feature | Single-User (stdio) | Multi-Tenant (HTTP) |
|---------|-------------------|---------------------|
| OAuth Flow | At server startup | Client manages |
| Token Storage | Server filesystem | Client-side only |
| Multiple Users | ❌ Single account | ✅ Unlimited users |
| Deployment | Desktop apps | Web services |
| State | Stateful | Stateless |
| Scaling | Single instance | Horizontal scaling |
| Security | Local file system | HTTPS + secure headers |

## Migration Guide

### From Single-User to Multi-Tenant

**Step 1: Change transport mode**
```bash
# Before (stdio)
npm start

# After (HTTP)
npm run start:http
```

**Step 2: Update client code**
```javascript
// Before: No authentication needed (server handled it)
const response = await mcpClient.callTool('list-events', args);

// After: Include authorization header
const response = await fetch(mcpUrl, {
  headers: {
    'Authorization': `Bearer ${userToken}`
  },
  // ...
});
```

**Step 3: Implement OAuth in your app**
- Add Google OAuth 2.0 flow
- Store tokens securely client-side
- Include tokens in all MCP requests

## Troubleshooting

### Issue: "Authentication required" error

**Solution**: Ensure Authorization header is included:
```javascript
headers: {
  'Authorization': 'Bearer ya29.a0AfH6SMBx...'  // ← Must include this
}
```

### Issue: Tokens leak between users

**Cause**: Using shared OAuth2Client instances
**Solution**: Server automatically handles this with AsyncLocalStorage. Ensure you're using the updated code.

### Issue: High memory usage

**Cause**: Token cache not being cleaned up
**Solution**: Restart server periodically or adjust cache TTL in `clientFactory.ts`

### Issue: CORS errors

**Solution**: Server allows all origins by default. For production, configure specific origins in `src/transports/http.ts`:
```typescript
res.setHeader('Access-Control-Allow-Origin', 'https://your-domain.com');
```

## Example Applications

### Web Dashboard

```javascript
// User logs in with Google OAuth
const { accessToken } = await googleOAuthLogin();

// Store token in session
sessionStorage.setItem('gcal_token', accessToken);

// Make MCP requests
async function listEvents() {
  const token = sessionStorage.getItem('gcal_token');
  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'list-events',
        arguments: { calendarId: 'primary' }
      }
    })
  });
  return response.json();
}
```

### Multi-Tenant SaaS

```javascript
// Express.js middleware to inject user token
app.use(async (req, res, next) => {
  const userId = req.session.userId;
  const userToken = await getUserToken(userId); // From your DB
  req.mcpToken = userToken;
  next();
});

// Forward to MCP with user's token
app.post('/api/calendar/*', async (req, res) => {
  const mcpResponse = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${req.mcpToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req.body)
  });
  res.json(await mcpResponse.json());
});
```

## API Reference

### HTTP Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | Bearer token: `Bearer <access_token>` |
| `X-Refresh-Token` | No | Refresh token for auto-refresh |
| `Content-Type` | Yes | Must be `application/json` |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_OAUTH_CREDENTIALS` | Path to OAuth credentials file | Required |
| `PORT` | HTTP server port (via --port flag) | 3000 |
| `HOST` | HTTP server host (via --host flag) | 127.0.0.1 |

## Support

For issues or questions:
- [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)
- [Documentation](../README.md)
- [Architecture Guide](./architecture.md)
