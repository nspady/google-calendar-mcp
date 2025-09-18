# Google Calendar MCP Server

A Model Context Protocol (MCP) server that provides Google Calendar integration for AI assistants like Claude.

## Features

- **Multi-Calendar Support**: List events from multiple calendars simultaneously
- **Multi-Account Support**: Manage multiple Google accounts with custom IDs
- **Event Management**: Create, update, delete, and search calendar events
- **Recurring Events**: Advanced modification capabilities for recurring events
- **Free/Busy Queries**: Check availability across calendars
- **Smart Scheduling**: Natural language understanding for dates and times
- **Inteligent Import**: Add calendar events from images, PDFs or web links

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
3. Your tokens will no longer expire after 7 days but Google will show a more threatning warning when connecting to the app about it being unverified. 

See [Authentication Guide](docs/authentication.md#moving-to-production-mode-recommended) for details.

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
5. Auto coordinate events:
   ```
   Here's some available that was provided to me by someone. {available times}
   Take a look at the times provided and let me know which ones are open on my calendar.
   ```

## Available Tools

| Tool | Description |
|------|-------------|
| `list-calendars` | List all available calendars |
| `list-events` | List events with date filtering |
| `search-events` | Search events by text query |
| `create-event` | Create new calendar events |
| `update-event` | Update existing events |
| `delete-event` | Delete events |
| `get-freebusy` | Check availability across calendars, including external calendars |
| `list-colors` | List available event colors |

## Documentation

- [Authentication Setup](docs/authentication.md) - Detailed Google Cloud setup
- [Advanced Usage](docs/advanced-usage.md) - Multi-account, batch operations
- [Deployment Guide](docs/deployment.md) - HTTP transport, remote access
- [Docker Guide](docs/docker.md) - Docker deployment with stdio and HTTP modes
- [OAuth Verification](docs/oauth-verification.md) - Moving from test to production mode
- [Architecture](docs/architecture.md) - Technical architecture overview
- [Development](docs/development.md) - Contributing and testing
- [Testing](docs/testing.md) - Unit and integration testing guide

## Configuration

**Environment Variables:**
- `GOOGLE_OAUTH_CREDENTIALS` - Path to OAuth credentials file
- `GOOGLE_CALENDAR_MCP_TOKEN_PATH` - Custom token storage location (optional)
- `GOOGLE_ACCOUNT_MODE` - Account ID to use (default: "normal")

**Claude Desktop Config Location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Multi-Account Support

The server supports multiple Google accounts, allowing you to authenticate and manage different accounts separately.

### Setting Up Multiple Accounts

#### Using the Same OAuth Credentials
If all your accounts are personal Google accounts, you can use the same OAuth credentials file:

```bash
# Authenticate work account
GOOGLE_ACCOUNT_MODE=work npm run auth
# Browser opens - log in with your work Google account

# Authenticate personal account
GOOGLE_ACCOUNT_MODE=personal npm run auth  
# Browser opens - log in with your personal Google account
```

#### Using Different OAuth Credentials
If you need different OAuth apps (e.g., company OAuth for work, personal OAuth for personal):

1. **Authenticate each account with its own credentials:**
   ```bash
   # Work account with company OAuth credentials
   GOOGLE_OAUTH_CREDENTIALS="/path/to/work-oauth.json" \
   GOOGLE_ACCOUNT_MODE=work \
   npm run auth
   
   # Personal account with personal OAuth credentials
   GOOGLE_OAUTH_CREDENTIALS="/path/to/personal-oauth.json" \
   GOOGLE_ACCOUNT_MODE=personal \
   npm run auth
   ```

2. **Configure Claude Desktop with multiple accounts:**
   ```json
   {
     "mcpServers": {
       "google-calendar-work": {
         "command": "npx",
         "args": ["@cocal/google-calendar-mcp"],
         "env": {
           "GOOGLE_OAUTH_CREDENTIALS": "/path/to/work-oauth.json",
           "GOOGLE_ACCOUNT_MODE": "work"
         }
       },
       "google-calendar-personal": {
         "command": "npx",
         "args": ["@cocal/google-calendar-mcp"],
         "env": {
           "GOOGLE_OAUTH_CREDENTIALS": "/path/to/personal-oauth.json",
           "GOOGLE_ACCOUNT_MODE": "personal"
         }
       }
     }
   }
   ```

3. **List available accounts:**
   ```bash
   node scripts/account-manager.js list
   ```

### Understanding OAuth Credentials vs User Tokens

- **OAuth Credentials** (`gcp-oauth.keys.json`): These authenticate your *application* to Google. You get these from Google Cloud Console.
- **User Tokens** (stored in `~/.config/google-calendar-mcp/tokens.json`): These authenticate specific *Google user accounts* after login.

You can use:
- **Same OAuth credentials** for multiple personal accounts (the app is the same, users are different)
- **Different OAuth credentials** when required (e.g., company policy requires using their OAuth app for work accounts)

### Account IDs

Account IDs can contain lowercase letters, numbers, dashes, and underscores. Examples:
- `work`, `personal`, `client-abc`, `project-2024`, `dev-team`

### Managing Accounts

```bash
# Check status of all accounts
node scripts/account-manager.js status

# Clear tokens for a specific account
node scripts/account-manager.js clear work

# Re-authenticate an account
node scripts/account-manager.js auth work

# Switch between accounts at runtime
GOOGLE_ACCOUNT_MODE=personal npm start
```

All account tokens are stored in `~/.config/google-calendar-mcp/tokens.json` with separate credentials for each account.


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
   - Perform manual authentication per the below steps
   - Use a Chromium-based browser to open the authentication URL. Test app authentication may not be supported on some non-Chromium browsers.

### Manual Authentication
For re-authentication or troubleshooting:
```bash
# For npx installations
export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/credentials.json"
npx @cocal/google-calendar-mcp auth

# For local installations
npm run auth
```

## License

MIT

## Support

- [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)
- [Documentation](docs/)
