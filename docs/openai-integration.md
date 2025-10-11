# OpenAI ChatGPT Integration Guide

This guide explains how to integrate this Google Calendar MCP Server with OpenAI's ChatGPT and Responses API using the Model Context Protocol (MCP) support launched in 2025.

## Overview

As of 2025, OpenAI supports MCP in three ways:
1. **ChatGPT Desktop App** - Developer Mode with MCP connectors (September 2025)
2. **Responses API** - Remote MCP server integration (March 2025)
3. **Agents SDK** - Programmatic MCP integration for custom agents

## Key Requirements

### What's Already Compatible

Your Google Calendar MCP Server is **already compatible** with OpenAI's requirements:

✅ **Streamable HTTP Transport** - Your [http.ts](../src/transports/http.ts) already implements `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
✅ **Standard MCP Tools** - All handlers follow MCP tool specification
✅ **Health Endpoint** - `/health` endpoint for server verification
✅ **CORS Support** - Already configured for cross-origin requests
✅ **Stateless Mode** - Configured for multiple initialization cycles

### What Needs to be Deployed

For OpenAI integration, you **must deploy the HTTP server** to an accessible URL. OpenAI cannot connect to `stdio` mode servers.

**Transport Modes:**
- `stdio` (current default) = Claude Desktop only, local machine ❌ Not compatible with OpenAI
- `HTTP` (Streamable HTTP) = Remote access via URL ✅ Required for OpenAI

## Integration Methods

### Method 1: ChatGPT Desktop Developer Mode (Easiest for Testing)

**Use Case:** Quick testing with ChatGPT Plus/Pro accounts

**Requirements:**
- ChatGPT Plus or Pro subscription
- Publicly accessible server URL (localhost won't work)
- OAuth credentials already configured

**Steps:**

1. **Deploy Your MCP Server with HTTP Transport**

   ```bash
   # Option A: Docker (Recommended)
   cp .env.example .env
   # Edit .env: Change TRANSPORT=stdio to TRANSPORT=http
   docker compose up -d
   docker compose exec calendar-mcp npm run auth

   # Option B: Direct Node.js
   npm run build
   npm run start:http:public
   ```

2. **Expose Server to Public URL**

   Your server must be accessible from the internet. Options:

   ```bash
   # Option A: ngrok (easiest for testing)
   ngrok http 3000
   # Copy the https URL provided (e.g., https://abc123.ngrok.io)

   # Option B: Cloudflare Tunnel
   cloudflare tunnel --url http://localhost:3000

   # Option C: Deploy to cloud (Railway, Render, Fly.io, etc.)
   ```

3. **Enable Developer Mode in ChatGPT**

   - Open ChatGPT (Plus or Pro account required)
   - Navigate to: Settings → Connectors → Advanced → Developer mode
   - Toggle Developer Mode ON
   - ⚠️ Warning: "Powerful but dangerous" - understand MCP security before enabling

4. **Add Your MCP Server as a Connector**

   In a ChatGPT conversation:
   - Click the connector icon (or type `/connect`)
   - Choose "Add custom connector"
   - Enter your server URL: `https://your-ngrok-url.ngrok.io` or `https://your-server.com`
   - Configure:
     - **Server Label:** `google-calendar`
     - **Server URL:** Your public URL (must include `https://`)
     - **Require Approval:** Choose `never` for seamless experience or leave default for confirmations

5. **Test Integration**

   ```
   List my upcoming calendar events for this week
   ```

   ChatGPT will discover and call your MCP tools automatically.

**Security Notes:**
- ChatGPT will ask for confirmation before write actions by default
- You can inspect JSON payloads before approval
- Developer Mode is intended for developers who understand connector security

---

### Method 2: Responses API (For Custom Applications)

**Use Case:** Building custom applications with OpenAI models that need calendar access

**Requirements:**
- OpenAI API key
- Deployed MCP server with public URL
- Python or JavaScript/TypeScript development environment

**Implementation:**

#### Python Example

```python
from openai import OpenAI

# Initialize OpenAI client
client = OpenAI(api_key="sk-...")

# Connect to your MCP server
response = client.responses.create(
    model="gpt-4.1",  # or "gpt-4o", "o1", "o3-mini"
    tools=[
        {
            "type": "mcp",
            "server_label": "google-calendar",
            "server_url": "https://your-server.com",  # Your deployed MCP server
            "require_approval": "never",  # or omit for approval prompts
            # Optional: Limit which tools to expose
            # "allowed_tools": ["list-events", "create-event", "list-calendars"]
        }
    ],
    input="What meetings do I have tomorrow?"
)

print(response.output_text)
```

#### JavaScript/TypeScript Example

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const response = await client.responses.create({
  model: 'gpt-4.1',
  tools: [
    {
      type: 'mcp',
      server_label: 'google-calendar',
      server_url: 'https://your-server.com',
      require_approval: 'never'
    }
  ],
  input: 'Schedule a meeting for next Tuesday at 2pm'
});

console.log(response.output_text);
```

#### With Authentication Headers (if needed)

```python
response = client.responses.create(
    model="gpt-4.1",
    tools=[
        {
            "type": "mcp",
            "server_label": "google-calendar",
            "server_url": "https://your-server.com",
            "require_approval": "never",
            "headers": {
                "Authorization": "Bearer your-api-key"
            }
        }
    ],
    input="Check my availability this week"
)
```

**Advanced Configuration:**

```python
# Filter tools to reduce token overhead
response = client.responses.create(
    model="gpt-4.1",
    tools=[
        {
            "type": "mcp",
            "server_label": "google-calendar",
            "server_url": "https://your-server.com",
            "allowed_tools": ["list-events", "list-calendars", "get-freebusy"],
            "require_approval": "never"
        }
    ],
    input="When am I free this week?"
)
```

**Best Practices:**
- Use `allowed_tools` to limit exposed tools and reduce token usage
- Enable caching to minimize latency on repeated requests
- Limit tool calls to 2 per user request for better performance
- Provide clear, concise tool descriptions in your MCP tool schemas

**Supported Models:**
- GPT-4o series
- GPT-4.1 series
- OpenAI o-series reasoning models (o1, o3-mini, etc.)

---

### Method 3: OpenAI Agents SDK

**Use Case:** Building autonomous AI agents with calendar capabilities

**Requirements:**
- OpenAI API key
- Python development environment
- Deployed MCP server

**Installation:**

```bash
pip install openai-agents
```

**Implementation:**

```python
from openai import Agent
from openai.agents.tools import HostedMCPTool

# Create agent with MCP tool integration
agent = Agent(
    model="gpt-4.1",
    tools=[
        HostedMCPTool(
            server_label="google-calendar",
            server_url="https://your-server.com",
            require_approval=False
        )
    ]
)

# Run agent
response = agent.run("Schedule a team sync for Friday at 3pm and invite john@example.com")
print(response.output)
```

---

## Deployment Options

### Option 1: Cloud Platform (Recommended for Production)

Deploy your MCP server to any cloud platform that supports Docker or Node.js:

**Railway:**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Render:**
1. Connect your GitHub repository
2. Create a new Web Service
3. Build Command: `npm install && npm run build`
4. Start Command: `npm run start:http:public`
5. Add environment variable: `GOOGLE_OAUTH_CREDENTIALS` → paste JSON content

**Fly.io:**
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch
fly deploy
```

**Heroku:**
```bash
heroku create your-calendar-mcp
git push heroku main
heroku config:set GOOGLE_OAUTH_CREDENTIALS="$(cat gcp-oauth.keys.json)"
```

### Option 2: Docker Deployment

See [docker.md](docker.md) for complete Docker setup. Key changes for OpenAI:

```bash
# 1. Configure for HTTP mode
cp .env.example .env
# Edit .env: Set TRANSPORT=http, HOST=0.0.0.0, PORT=3000

# 2. Build and start
docker compose up -d

# 3. Authenticate
docker compose exec calendar-mcp npm run auth

# 4. Expose via reverse proxy (nginx, Caddy, etc.) with HTTPS
```

### Option 3: Serverless Functions (Advanced)

Your MCP server uses Streamable HTTP which is compatible with serverless platforms, but requires:
- Session state management (currently uses stateless mode)
- Cold start optimization
- OAuth token storage (use external service like AWS Secrets Manager)

---

## Architecture Comparison

### Claude Desktop (Current)

```
Claude Desktop ←→ stdio ←→ MCP Server (local)
                              ↓
                        Google Calendar API
```

### OpenAI ChatGPT

```
ChatGPT ←→ HTTPS ←→ MCP Server (remote) ←→ Google Calendar API
```

### OpenAI Responses API

```
Your App → OpenAI API → HTTPS → MCP Server (remote) → Google Calendar API
```

---

## Authentication & Security

### Current OAuth Flow
Your server uses OAuth 2.0 with refresh tokens stored locally at:
- Default: `~/.config/google-calendar-mcp/tokens.json`
- Docker: Named volume `google-calendar-mcp_calendar-tokens`

### For OpenAI Integration

**Important Security Considerations:**

1. **Token Storage:** When deploying remotely, ensure token storage is secure:
   ```bash
   # Use environment-specific paths
   export GOOGLE_TOKEN_PATH="/secure/path/tokens.json"

   # Or use cloud secret management
   # - AWS Secrets Manager
   # - Google Cloud Secret Manager
   # - Azure Key Vault
   ```

2. **Multi-User Support:** Current implementation uses single OAuth account. For multi-user:
   - Implement user-specific token storage
   - Add user identification in requests
   - Consider implementing `GOOGLE_ACCOUNT_MODE` per user

3. **API Security:** Add authentication to your MCP server:
   ```typescript
   // In src/transports/http.ts, add before transport.handleRequest()
   const authHeader = req.headers.authorization;
   if (authHeader !== `Bearer ${process.env.MCP_SERVER_API_KEY}`) {
     res.writeHead(401, { 'Content-Type': 'application/json' });
     res.end(JSON.stringify({ error: 'Unauthorized' }));
     return;
   }
   ```

4. **Rate Limiting:** Consider adding rate limiting for public endpoints:
   ```bash
   npm install express-rate-limit
   ```

---

## Testing Your Integration

### 1. Test MCP Server Directly

```bash
# Health check
curl https://your-server.com/health

# Test MCP protocol (list tools)
curl -X POST https://your-server.com \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

### 2. Test with OpenAI Responses API

```python
from openai import OpenAI

client = OpenAI()

# Simple test
response = client.responses.create(
    model="gpt-4.1",
    tools=[{
        "type": "mcp",
        "server_label": "test",
        "server_url": "https://your-server.com",
        "require_approval": "never"
    }],
    input="List my calendars"
)

print(response.output_text)
```

### 3. Test with ChatGPT

In ChatGPT with Developer Mode:
```
List the tools available from my google-calendar connector
```

Then test each tool:
```
Show me my upcoming events
Create a test event for tomorrow at 2pm
List all my calendars
```

---

## Limitations & Considerations

### OpenAI-Specific Limitations

1. **Transport Support:**
   - ✅ Streamable HTTP (fully supported)
   - ❌ stdio (not supported - requires local process)
   - ⚠️ SSE (deprecated but may work, not recommended)

2. **Tool Discovery:**
   - OpenAI calls `tools/list` endpoint automatically
   - All your existing tools will be exposed (29 tools total)
   - Use `allowed_tools` to limit exposure for performance

3. **Token Usage:**
   - MCP tool schemas count toward context window
   - Consider filtering tools per use case
   - Each tool call uses tokens for request/response

4. **Rate Limits:**
   - Google Calendar API: Standard quotas apply
   - OpenAI API: Based on your plan tier
   - Consider caching for repeated queries

### Current Server Limitations

1. **Single User:** OAuth tokens are per-server, not per-user
   - For multi-user: Implement user-specific token management
   - Consider OAuth 2.0 per-user flow

2. **No Authentication:** MCP server has no auth by default
   - Add API key authentication before exposing publicly
   - See Authentication & Security section above

3. **Session Management:** Stateless mode (good for OpenAI)
   - No session persistence needed
   - Each request is independent

---

## Migration Checklist

- [ ] Deploy server with HTTP transport to cloud platform
- [ ] Verify `/health` endpoint responds correctly
- [ ] Test MCP `tools/list` endpoint with cURL
- [ ] Add authentication layer to MCP server (recommended)
- [ ] Configure OAuth tokens for production (not test mode)
- [ ] Test with OpenAI Responses API using Python/JavaScript
- [ ] (Optional) Enable ChatGPT Developer Mode and add connector
- [ ] (Optional) Implement rate limiting for public access
- [ ] (Optional) Add monitoring/logging for production use
- [ ] Update documentation with your deployment URL

---

## Example: Complete OpenAI Integration

Here's a complete example of integrating your calendar MCP server with a Python application:

```python
import os
from openai import OpenAI

class CalendarAssistant:
    def __init__(self, mcp_server_url: str):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.mcp_config = {
            "type": "mcp",
            "server_label": "google-calendar",
            "server_url": mcp_server_url,
            "require_approval": "never"
        }

    def query(self, user_input: str, allowed_tools: list = None):
        """Query calendar with optional tool filtering"""
        tool_config = self.mcp_config.copy()
        if allowed_tools:
            tool_config["allowed_tools"] = allowed_tools

        response = self.client.responses.create(
            model="gpt-4.1",
            tools=[tool_config],
            input=user_input
        )
        return response.output_text

    def list_events(self, time_period: str = "this week"):
        """List calendar events"""
        return self.query(
            f"Show me my calendar events for {time_period}",
            allowed_tools=["list-events", "list-calendars"]
        )

    def create_event(self, event_description: str):
        """Create a new calendar event"""
        return self.query(
            f"Create this event: {event_description}",
            allowed_tools=["create-event", "list-calendars"]
        )

    def check_availability(self, time_period: str):
        """Check calendar availability"""
        return self.query(
            f"When am I free {time_period}?",
            allowed_tools=["get-freebusy", "list-events", "list-calendars"]
        )

# Usage
assistant = CalendarAssistant("https://your-server.com")

# List upcoming events
events = assistant.list_events("today")
print(events)

# Create event
result = assistant.create_event("Team meeting tomorrow at 2pm with john@example.com")
print(result)

# Check availability
availability = assistant.check_availability("this Friday afternoon")
print(availability)
```

---

## Resources

### Documentation
- [OpenAI MCP Documentation](https://platform.openai.com/docs/mcp)
- [OpenAI Responses API Guide](https://openai.com/index/new-tools-and-features-in-the-responses-api/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/mcp/)

### Community
- [OpenAI Developer Forum](https://community.openai.com/)
- [MCP Community Hub](https://mcpservers.org)
- This project's [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)

### Related Projects
- [FastMCP](https://gofastmcp.com/) - Rapid MCP server development framework
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Debug MCP servers
- [Anthropic MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Official TypeScript SDK (already used)

---

## Troubleshooting

### "Cannot connect to MCP server"
- Verify server is running: `curl https://your-server.com/health`
- Check URL is publicly accessible (not `localhost`)
- Ensure CORS is enabled (already configured in your server)
- Verify no firewall blocking OpenAI IPs

### "MCP server violates our guidelines"
- OpenAI reviews custom connectors for safety
- Ensure server responds within timeout (3 seconds configured)
- Check tool descriptions are clear and appropriate
- Verify server doesn't expose sensitive operations without approval

### "Authentication failed"
- Re-run authentication: `npm run auth` or `docker compose exec calendar-mcp npm run auth`
- Check OAuth credentials are valid
- Verify test user is added in Google Cloud Console
- Consider moving to production mode (tokens won't expire)

### "Tool not found" or "Tool call failed"
- Verify tool name matches exactly (case-sensitive)
- Check tool is in `allowed_tools` list if specified
- Review tool schema with: `curl -X POST https://your-server.com -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`
- Check server logs for errors

### "Rate limit exceeded"
- Google Calendar API quotas: 1M requests/day, 10 req/sec
- OpenAI API limits: Depends on your tier
- Add caching for repeated queries
- Implement exponential backoff in server code

---

## What's Next?

1. **Multi-User Support:** Implement per-user OAuth flows for SaaS deployment
2. **Enhanced Security:** Add API key authentication and rate limiting
3. **Monitoring:** Integrate logging and metrics (Sentry, Datadog, etc.)
4. **Caching:** Add Redis caching for frequent queries
5. **Webhooks:** Implement Google Calendar webhooks for real-time updates
6. **Advanced Features:** Integrate with OpenAI's new features as they launch

---

## Summary

Your Google Calendar MCP Server is **ready for OpenAI integration** with minimal changes:

**What You Have:**
✅ Streamable HTTP transport (required)
✅ MCP tool protocol (compatible)
✅ Health endpoint (helpful)
✅ CORS enabled (required)

**What You Need to Do:**
1. Deploy server with HTTP transport to public URL
2. Add authentication layer (recommended)
3. Configure OpenAI client with your server URL
4. Test and iterate

**Time Estimate:**
- Testing with ChatGPT: 15-30 minutes
- Production deployment: 1-2 hours
- Full integration with app: 2-4 hours

The architecture is sound, the protocol is compatible, and your implementation already follows MCP best practices. OpenAI integration is straightforward once the server is deployed to a public URL.
