# Google Calendar MCP Server

A Model Context Protocol (MCP) server that provides Google Calendar integration for AI assistants like Claude.

## Features

- **Multi-Account Support**: Connect multiple Google accounts (e.g., work, personal) and query them simultaneously
- **Multi-Calendar Support**: List events from multiple calendars in a single request
- **Cross-Account Conflicts**: Detect overlapping events across any combination of calendars
- **Event Management**: Create, update, delete, and search calendar events
- **Recurring Events**: Advanced modification capabilities for recurring events
- **Free/Busy Queries**: Check availability across calendars
- **Smart Scheduling**: Natural language understanding for dates and times
- **Intelligent Import**: Add calendar events from images, PDFs, or web links

## Quick Start

### Prerequisites

1. A Google Cloud project with the Calendar API enabled
2. OAuth 2.0 credentials (Desktop app type)

### Google Cloud Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one.
3. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for your project. Ensure that the right project is selected from the top bar before enabling the API.
4. Create OAuth 2.0 credentials:
   - Go to Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "User data" for the type of data that the app will be accessing
   - Add your app name and contact information
   - Add the following scopes (optional):
     - `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar`
   - Select "Desktop app" as the application type (Important!)
   - Save the auth key, you'll need to add its path to the JSON in the next step
   - Add your email address as a test user under the [Audience screen](https://console.cloud.google.com/auth/audience)
      - Note: it might take a few minutes for the test user to be added. The OAuth consent will not allow you to proceed until the test user has propagated.
      - Note about test mode: While an app is in test mode the auth tokens will expire after 1 week and need to be refreshed (see Re-authentication section below).

### Installation

**Option 1: Use with npx (Recommended)**

Add to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["@cocal/google-calendar-mcp"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/your/gcp-oauth.keys.json"
      }
    }
  }
}
```

**⚠️ Important Note for npx Users**: When using npx, you **must** specify the credentials file path using the `GOOGLE_OAUTH_CREDENTIALS` environment variable.

**Option 2: Local Installation**

```bash
git clone https://github.com/nspady/google-calendar-mcp.git
cd google-calendar-mcp
npm install
npm run build
```

Then add to Claude Desktop config using the local path or by specifying the path with the `GOOGLE_OAUTH_CREDENTIALS` environment variable.

**Option 3: Docker Installation**

```bash
git clone https://github.com/nspady/google-calendar-mcp.git
cd google-calendar-mcp
cp /path/to/your/gcp-oauth.keys.json .
docker compose up
```

See the [Docker deployment guide](docs/docker.md) for detailed configuration options including HTTP transport mode.

### First Run

1. Start Claude Desktop
2. The server will prompt for authentication on first use
3. Complete the OAuth flow in your browser
4. You're ready to use calendar features!

### Re-authentication

If you're in test mode (default), tokens expire after 7 days. If you are using a client like Claude Desktop it should open up a browser window to automatically re-auth. However, if you see authentication errors you can also resolve by following these steps:

**For npx users:**
```bash
export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/gcp-oauth.keys.json"
npx @cocal/google-calendar-mcp auth
```

**For local installation:**
```bash
npm run auth
```

**To avoid weekly re-authentication**, publish your app to production mode (without verification):
1. Go to Google Cloud Console → "APIs & Services" → "OAuth consent screen"
2. Click "PUBLISH APP" and confirm
3. Your tokens will no longer expire after 7 days but Google will show a warning about the app being unverified. 

See [Authentication Guide](docs/authentication.md#avoiding-token-expiration) for details.

## Managing Multiple Accounts

Connect multiple Google accounts and use them simultaneously.

**In chat (recommended):** Use the `manage-accounts` tool to add, list, or remove accounts directly from your AI assistant - no terminal needed. See the [Authentication Guide](docs/authentication.md#managing-multiple-accounts) for details.

**CLI:** For initial setup, use `npm run account auth <nickname>` (e.g., `npm run account auth work`).

**HTTP / Docker:** Visit `http://localhost:3000/accounts` to manage accounts in the browser.

When no `account` parameter is supplied to a tool, read-only tools merge results from all accounts, while write tools auto-select the account with appropriate permissions.

## Example Usage

Along with the normal capabilities you would expect for a calendar integration you can also do really dynamic, multi-step processes like:

1. **Cross-calendar availability**:
   ```
   Please provide availability looking at both my personal and work calendar for this upcoming week.
   I am looking for a good time to meet with someone in London for 1 hr.
   ```

2. Add events from screenshots, images and other data sources:
   ```
   Add this event to my calendar based on the attached screenshot.
   ```
   Supported image formats: PNG, JPEG, GIF
   Images can contain event details like date, time, location, and description

3. Calendar analysis:
   ```
   What events do I have coming up this week that aren't part of my usual routine?
   ```
4. Check attendance:
   ```
   Which events tomorrow have attendees who have not accepted the invitation?
   ```
5. Respond to invitations:
   ```
   Accept the team meeting invitation on my calendar for tomorrow at 2pm
   ```
   Decline with a note:
   ```
   Decline the Friday meeting with a note that I have a scheduling conflict
   ```
   Respond to recurring events:
   ```
   Accept just this week's standup, but keep future instances as tentative
   ```
   ```
   Decline all future Monday planning meetings
   ```
6. Auto coordinate events:
   ```
   Here's some availability that was provided to me by someone. {available times}
   Take a look at the times provided and let me know which ones are open on my calendar.
   ```

## Available Tools

| Tool | Description |
|------|-------------|
| `list-calendars` | List all available calendars |
| `list-events` | List events with date filtering |
| `get-event` | Get details of a specific event by ID |
| `search-events` | Search events by text query |
| `create-event` | Create new calendar events |
| `update-event` | Update existing events |
| `delete-event` | Delete events |
| `respond-to-event` | Respond to event invitations (Accept, Decline, Maybe, No Response) |
| `get-freebusy` | Check availability across calendars, including external calendars |
| `get-current-time` | Get current date and time in calendar's timezone |
| `list-colors` | List available event colors |
| `manage-accounts` | Add, list, or remove connected Google accounts |

## Documentation

- [Authentication Setup](docs/authentication.md) - Detailed Google Cloud setup
- [Advanced Usage](docs/advanced-usage.md) - Multi-account, batch operations
- [Deployment Guide](docs/deployment.md) - HTTP transport, remote access
- [Docker Guide](docs/docker.md) - Docker deployment with stdio and HTTP modes
- [Architecture](docs/architecture.md) - Technical architecture overview
- [Development](docs/development.md) - Contributing and testing
- [Testing](docs/testing.md) - Unit and integration testing guide
- [Multi-Account Updates](docs/multi-account-updates.md) - Current status and roadmap for multi-account support

## Sponsorship

If Google Calendar MCP has been useful to you and you're so inclined, I'd greatly appreciate it if you'd consider [sponsoring my open source work](https://github.com/sponsors/nspady).

Thanks! – Nate

## Configuration

**Environment Variables:**
- `GOOGLE_OAUTH_CREDENTIALS` - Path to OAuth credentials file
- `GOOGLE_CALENDAR_MCP_TOKEN_PATH` - Custom token storage location (optional)
- `ENABLED_TOOLS` - Comma-separated list of tools to enable (see Tool Filtering below)

### Tool Filtering

You can limit which tools are exposed to the AI assistant using the `--enable-tools` flag or `ENABLED_TOOLS` environment variable. This is useful for:
- **Reducing context usage**: Each tool consumes tokens from the AI's context window. Limiting tools can help preserve context for longer conversations.
- **Security**: Restrict capabilities to read-only operations or specific functionality.
- **Simplicity**: Only expose the tools your workflow actually needs.

**Via command line:**
```bash
npx @cocal/google-calendar-mcp start --enable-tools list-events,create-event,get-current-time
```

**Via environment variable in Claude Desktop config:**
```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["@cocal/google-calendar-mcp"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/credentials.json",
        "ENABLED_TOOLS": "list-events,create-event,get-current-time,update-event"
      }
    }
  }
}
```

**Available tool names:** `list-calendars`, `list-events`, `search-events`, `get-event`, `list-colors`, `create-event`, `update-event`, `delete-event`, `get-freebusy`, `get-current-time`, `respond-to-event`, `manage-accounts`

**Note:** The `manage-accounts` tool is always available regardless of filtering, as it's needed for authentication management.

When tool filtering is active, the server provides instructions to the AI assistant listing which tools are disabled. This allows the AI to inform users that additional functionality exists but is currently unavailable, without consuming the full token cost of those tool schemas.

If the list is empty or contains only commas, the server will fail to start with an error.

If an invalid tool name is specified, the server will fail to start with an error listing all available tools.

## Security

- OAuth tokens are stored securely in your system's config directory
- Credentials never leave your local machine
- All calendar operations require explicit user consent

### Troubleshooting

1. **OAuth Credentials File Not Found:**
   - For npx users: You **must** specify the credentials file path using `GOOGLE_OAUTH_CREDENTIALS`
   - Verify file paths are absolute and accessible

2. **Authentication Errors:**
   - Ensure your credentials file contains credentials for a **Desktop App** type
   - Verify your user email is added as a **Test User** in the Google Cloud OAuth Consent screen
   - Try deleting saved tokens and re-authenticating
   - Check that no other process is blocking ports 3000-3004

3. **Build Errors:**
   - Run `npm install && npm run build` again
   - Check Node.js version (use LTS)
   - Delete the `build/` directory and run `npm run build`
4. **"Something went wrong" screen during browser authentication**
   - Run the auth command manually (see [Re-authentication](#re-authentication) above)
   - Use a Chromium-based browser. Test app authentication may not work on some non-Chromium browsers.

5. **"User Rate Limit Exceeded" errors**
   - This typically occurs when your OAuth credentials are missing project information
   - Ensure your `gcp-oauth.keys.json` file includes `project_id`
   - Re-download credentials from Google Cloud Console if needed
   - The file should have format: `{"installed": {"project_id": "your-project-id", ...}}`

## License

MIT

## Support

- [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)
- [Documentation](docs/)
