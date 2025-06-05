# Google Calendar MCP Server

This is a Model Context Protocol (MCP) server that provides integration with Google Calendar. It allows LLMs to read, create, update and search for calendar events through a standardized interface.

## Features

- **Multi-Calendar Support**: List events from multiple calendars simultaneously
- **Event Management**: Create, update, delete, and search calendar events
- **Recurring Events**: Advanced modification scopes for recurring events (single instance, all instances, or future instances only)
- **Calendar Management**: List calendars and their properties
- **Free/Busy Queries**: Check availability across calendars
- **Dual Transport Support**: Both stdio (local) and HTTP (remote) transports
- **Remote Deployment**: Can be deployed as a web service for remote access
- **Consistent Time Validation**: All time-based operations require RFC3339 datetime format with mandatory timezone specification

## Transport Modes

### stdio Transport (Local Use)
The default mode for local development and Claude Desktop integration.

### HTTP Transport (Remote Use)
Enables remote deployment and access via HTTP with Server-Sent Events (SSE).

**Key Features:**
- ✅ **Session Management**: Secure session-based connections
- ✅ **CORS Support**: Configurable cross-origin access
- ✅ **Rate Limiting**: Built-in protection against abuse
- ✅ **Origin Validation**: Security against DNS rebinding attacks
- ✅ **Health Monitoring**: Health check and info endpoints
- ✅ **Graceful Shutdown**: Proper cleanup of resources

## Example Usage

Along with the normal capabilities you would expect for a calendar integration you can also do really dynamic, multi-step processes like:

1. **Cross-calendar availability**:
   ```
   Please provide availability looking at both my personal and work calendar for this upcoming week.
   Choose times that work well for normal working hours on the East Coast. Meeting time is 1 hour
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
   Here's some available that was provided to me by someone.
   Take a look at the available times and create an event that is free on my work calendar.
   ```

## Requirements

1. A Google Cloud project with the Calendar API enabled
2. OAuth 2.0 credentials (Client ID and Client Secret from the Google Cloud project)

## Google Cloud Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one.
3. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for your project. Ensure that the right project is selected from the top bar before enabling the API.
4. Create OAuth 2.0 credentials:
   - Go to Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "User data" for the type of data that the app will be accessing
   - Add your app name and contact information
   - Add the following scopes (optional):
     - `https://www.googleapis.com/auth/calendar.events` (or broader `https://www.googleapis.com/auth/calendar` if needed)
   - Select "Desktop app" as the application type (Important!)
   - Add your email address as a test user under the [OAuth Consent screen](https://console.cloud.google.com/apis/credentials/consent)
      - Note: it will take a few minutes for the test user to be added. The OAuth consent will not allow you to proceed until the test user has propagated.
      - Note about test mode: While an app is in test mode the auth tokens will expire after 1 week and need to be refreshed by running `npm run auth`.

## Installation

### Option 1: Use with npx (Recommended)

1. **Add to Claude Desktop**: Edit your Claude Desktop configuration file:
   
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

2. **Restart Claude Desktop**

### Option 2: Local Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   git clone https://github.com/nspady/google-calendar-mcp.git
   cd google-calendar-mcp
   npm install && npm run build
   ```
3. **Configure OAuth credentials** using one of these methods:
   **Option A: Custom file location (recommended)**
   - Place your credentials file anywhere on your system
   - Use the `GOOGLE_OAUTH_CREDENTIALS` environment variable to specify the path

   **Option B: In project file location (legacy)**
   - Download your Google OAuth credentials from the Google Cloud Console (under "Credentials") and rename the file to `gcp-oauth.keys.json` and place it in the root directory of the project.
   - Ensure the file contains credentials for a "Desktop app".
   - Alternatively, copy the provided template file: `cp gcp-oauth.keys.example.json gcp-oauth.keys.json` and populate it with your credentials from the Google Cloud Console.

4. **Add configuration to your Claude Desktop config file:**

   **Using default credentials file location:**
   ```json
   {
     "mcpServers": {
       "google-calendar": {
         "command": "node",
         "args": ["<absolute-path-to-project-folder>/build/index.js"]
       }
     }
   }
   ```

   **Using environment variable:**
   ```json
   {
     "mcpServers": {
       "google-calendar": {
         "command": "node",
         "args": ["<absolute-path-to-project-folder>/build/index.js"],
         "env": {
           "GOOGLE_OAUTH_CREDENTIALS": "/path/to/your/credentials.json"
         }
       }
     }
   }
   ```

   Note: Replace `<absolute-path-to-project-folder>` with the actual path to your project directory.

5. Restart Claude **Desktop**

## Available Scripts

- `npm run build` - Build the TypeScript code (compiles `src` to `build`)
- `npm run typecheck` - Run TypeScript type checking without compiling
- `npm run start` - Start the MCP server in stdio mode (default)
- `npm run start:http` - Start the MCP server in HTTP mode on localhost:3000
- `npm run start:http:public` - Start the MCP server in HTTP mode accessible from any host
- `npm run auth` - Authenticate normal account (sets GOOGLE_ACCOUNT_MODE=normal)
- `npm run auth:test` - Authenticate test account
- `npm run account:status` - Show account status and configuration
- `npm run account:clear:normal` - Clear normal account tokens
- `npm run account:clear:test` - Clear test account tokens
- `npm test` - Run unit tests only (excludes integration tests)
- `npm run test:all` - Run all tests including integration tests
- `npm run test:watch` - Run unit tests in watch mode
- `npm run test:watch:all` - Run all tests in watch mode
- `npm run test:integration:direct` - Run core integration tests (recommended for development)
- `npm run test:integration:all` - Run complete integration test suite
- `npm run test:integration:claude-mcp` - Run Claude + MCP end-to-end integration tests
- `npm run coverage` - Run tests and generate a coverage report

## Multi-Account OAuth Management

The server now supports managing OAuth tokens for multiple Google accounts, making it easy to separate your normal account from your test account. The integration tests are meant to be run against a test gmail account rather than
your normal calendar.

### Quick Start

```bash
# Authenticate both accounts
npm run auth        # Authenticate your normal account
npm run auth:test   # Authenticate your test account

# Check status
npm run account:status

# Run tests with test account
npm run test:integration:all
```

### Account Modes

Use the `GOOGLE_ACCOUNT_MODE` environment variable to control which account to use:

- `GOOGLE_ACCOUNT_MODE=normal` (default): Use your normal account
- `GOOGLE_ACCOUNT_MODE=test`: Use your test account

### Benefits

- **Separation of Concerns**: Keep your personal calendar separate from test data
- **Safe Testing**: Run integration tests without affecting your real calendar
- **Easy Switching**: Toggle between accounts using environment variables or npm scripts
- **Shared Configuration**: Both accounts use the same `gcp-oauth.keys.json` file

For detailed setup and usage instructions, see [docs/multi-account-setup.md](docs/multi-account-setup.md).

## Command Line Options

The server supports various command-line options for configuration:
### Credential Loading Priority

The server searches for OAuth credentials in the following order:

1. **Environment Variable** (Highest Priority): `GOOGLE_OAUTH_CREDENTIALS` environment variable
2. **Default File** (Lowest Priority): `gcp-oauth.keys.json` in the current working directory

### Configuration Methods

#### Method 1: Environment Variable (Recommended)
Set the `GOOGLE_OAUTH_CREDENTIALS` environment variable:

```bash
# Basic usage
node build/index.js [options]

# Options:
--transport <type>        # Transport type: stdio (default) | http
--port <number>          # Port for HTTP transport (default: 3000)
--host <string>          # Host for HTTP transport (default: 127.0.0.1)
--allowed-origins <list> # Comma-separated list of allowed origins
--auth-mode <mode>       # Authentication mode: local | remote | tokens
--debug                  # Enable debug logging
--help                   # Show help message

# Examples:
node build/index.js                                    # stdio (local use)
node build/index.js --transport http --port 3000       # HTTP server
node build/index.js --transport http --auth-mode remote # Remote auth
```
# Then run normally
npx @cocal/google-calendar-mcp start
```

#### Method 2: Default File
Place your OAuth credentials file as `gcp-oauth.keys.json` in the current working directory (traditional method).

### Claude Desktop Configuration Examples

Choose one of these configuration methods based on your preference:

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["@cocal/google-calendar-mcp"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/Users/yourname/Documents/my-google-credentials.json"
      }
    }
  }
}
```

**⚠️ Important Note for npx Users**: When using npx, you **must** specify the credentials file path using the `GOOGLE_OAUTH_CREDENTIALS` environment variable. The default file location method is not reliable with npx installations due to package caching behavior.

## Authentication

The server handles Google OAuth 2.0 authentication to access your calendar data.

### Automatic Authentication Flow (During Server Start)

1. **Ensure OAuth credentials are available** using one of the supported methods:
   - Environment variable: `GOOGLE_OAUTH_CREDENTIALS=/path/to/credentials.json`
   - Default file: `gcp-oauth.keys.json` in the working directory

2. **Start the MCP server** using your chosen method from the installation section above.

3. **Authentication process:**
   - The server will check for existing, valid authentication tokens in `.gcp-saved-tokens.json`.
   - If valid tokens are found, the server starts normally.
   - If no valid tokens are found:
     - The server attempts to start a temporary local web server (trying ports 3000-3004).
     - Your default web browser will automatically open to the Google Account login and consent screen.
     - Follow the prompts in the browser to authorize the application.
     - Upon successful authorization, you will be redirected to a local page (e.g., `http://localhost:3000/oauth2callback`).
     - This page will display a success message confirming that the tokens have been saved to `.gcp-saved-tokens.json` (and show the exact file path).
     - The temporary auth server shuts down automatically.
     - The main MCP server continues its startup process.

### Manual Authentication Flow

If you need to re-authenticate or prefer to handle authentication separately:

**For npx installations:**
```bash
# Set environment variable and authenticate
export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/credentials.json"
npx @cocal/google-calendar-mcp auth
```

**For local installations:**
```bash
# Using default credentials file location
npm run auth

# The CLI parameter and environment variable methods also work for local installations
```

**Authentication Process:**
1. The script performs the same browser-based authentication flow described above.
2. Your browser will open, you authorize, and you'll see the success page indicating where tokens were saved.
3. The script will exit automatically upon successful authentication.

### Token Management

- **Authentication tokens are stored in `~/.config/google-calendar-mcp/tokens.json`** following the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) (a cross-platform standard for organizing user configuration files)
- On systems without XDG support, tokens are stored in `~/.config/google-calendar-mcp/tokens.json` 
- **Custom token location**: Set `GOOGLE_CALENDAR_MCP_TOKEN_PATH` environment variable to use a different location
- Token files are created automatically with secure permissions (600) and should **not** be committed to version control
- The server attempts to automatically refresh expired access tokens using the stored refresh token
- If the refresh token itself expires (e.g., after 7 days if the Google Cloud app is in testing mode) or is revoked, you will need to re-authenticate using either the automatic flow (by restarting the server) or the manual `npm run auth` command

#### Token Storage Priority
1. **Custom path**: `GOOGLE_CALENDAR_MCP_TOKEN_PATH` environment variable (highest priority)
2. **XDG Config**: `$XDG_CONFIG_HOME/google-calendar-mcp/tokens.json` if XDG_CONFIG_HOME is set
3. **Default**: `~/.config/google-calendar-mcp/tokens.json` (lowest priority)

## Integration Testing

This project includes comprehensive integration tests that validate the MCP server against real Google Calendar operations and Claude natural language processing.

### Quick Testing
```bash
# Fast core integration tests (~15 seconds)
npm run test:integration:direct

# Complete test suite including Claude integration (~60 seconds)  
npm run test:integration:all
```

### Test Levels

1. **Core MCP Tool Tests** (`test:integration:direct`)
   - Tests all MCP tools against live Google Calendar API
   - Validates CRUD workflows and performance
   - **Recommended for regular development**

2. **Claude + MCP Integration Tests** (`test:integration:claude-mcp`)
   - **Full Claude + MCP server integration**
   - Claude actually executes real calendar operations
   - Tests complex multi-step workflows
   - **Most comprehensive validation**

3. **Complete Integration Suite** (`test:integration:all`)
   - Runs all integration tests
   - Includes both direct API tests and Claude integration

### Setup for Integration Tests
1. Configure Google Calendar OAuth (see Authentication section)
2. Add Claude API key to `.env` file:
   ```env
   CLAUDE_API_KEY={your_api_key_here}
   ANTHROPIC_MODEL=claude-3-5-haiku-20241022
   ```
3. Run tests: `npm run test:integration:all`

See `src/integration/README.md` for detailed test documentation.

## Remote Deployment

### Docker Deployment

**Prerequisites:**
1. Place your `gcp-oauth.keys.json` file in the project root (see Google Cloud Setup)
2. Authenticate once: `npm run auth` (creates `.gcp-saved-tokens.json`)
3. Build the Docker image: `docker compose build server`

**Claude Desktop Configuration:**
Add this to your Claude Desktop config (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--mount",
        "type=bind,src=<absolute-path-to-project>/gcp-oauth.keys.json,dst=/usr/src/app/gcp-oauth.keys.json",
        "--mount",
        "type=bind,src=<absolute-path-to-project>/.gcp-saved-tokens.json,dst=/usr/src/app/.gcp-saved-tokens.json",
        "google-calendar-mcp-server"
      ]
    }
  }
}
```
Replace `<absolute-path-to-project>` with your actual project path for both the keys and token files.

**⚠️ Token Expiration:** OAuth tokens expire after 7 days in test mode. When they expire, run `npm run auth` on the host machine to refresh tokens since this requires completing the broswer based OAuth flow.


### Cloud Deployment

The HTTP transport mode enables deployment to cloud platforms:

1. **Prepare Authentication**: Ensure you have valid OAuth tokens
2. **Set Environment Variables**: Configure allowed origins and other settings
3. **Deploy**: Use your preferred cloud platform (AWS, GCP, Azure, etc.)

Example environment variables:
```bash
TRANSPORT=http
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=https://your-client-domain.com,https://another-domain.com
```

### Security Considerations for Remote Deployment

When deploying remotely:

1. **Use HTTPS**: Always deploy behind HTTPS in production
2. **Configure Origins**: Set `--allowed-origins` to restrict access
3. **Network Security**: Use firewalls and VPCs to limit access
4. **Authentication**: Consider additional authentication layers
5. **Monitoring**: Set up logging and monitoring for security events

## Testing

Unit and integration tests are implemented using [Vitest](https://vitest.dev/).

### Unit Tests
- **Run unit tests**: `npm test` (excludes integration tests)
- **Watch mode**: `npm run test:watch`
- **Coverage**: `npm run coverage`

### All Tests (Unit + Integration)
- **Run all tests**: `npm run test:all`
- **Watch mode**: `npm run test:watch:all`

Unit tests mock external dependencies (Google API, filesystem) to ensure isolated testing of server logic and handlers, while integration tests run against real Google Calendar APIs.

## Security Notes

- The server runs locally and requires OAuth authentication.
- OAuth credentials (`gcp-oauth.keys.json`) and saved tokens (`.gcp-saved-tokens.json`) should **never** be committed to version control. Ensure they are added to your `.gitignore` file.
- For production use, consider getting your OAuth application verified by Google.
- When using HTTP transport, implement proper network security and access controls.

## Usage with Claude Desktop

### Local Usage (stdio)

1. Add this configuration to your Claude Desktop config file. E.g. `/Users/<user>/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "google-calendar": {
         "command": "node",
         "args": ["<absolute-path-to-project-folder>/build/index.js"]
       }
     }
   }
   ```
   Note: Replace `<absolute-path-to-project-folder>` with the actual path to your project directory.

2. Restart Claude Desktop

### Remote Usage (HTTP)

1. Deploy the server using HTTP transport
2. Configure Claude Desktop to connect to the remote server:
   ```json
   {
     "mcpServers": {
       "google-calendar-remote": {
         "url": "https://your-server-domain.com/sse"
       }
     }
   }
   ```

## API Endpoints (HTTP Transport)

When running in HTTP mode, the server exposes these endpoints:

- `GET /sse` - Server-Sent Events endpoint for MCP connections
- `POST /messages` - Message handling endpoint
- `GET /health` - Health check endpoint
- `GET /info` - Server information endpoint
## Development

### Troubleshooting

1. **OAuth Credentials File Not Found (ENOENT Error):**
   
   If you see an error like `ENOENT: no such file or directory, open 'gcp-oauth.keys.json'`, the server cannot find your OAuth credentials file.

   **⚠️ For npx users**: You **must** specify the credentials file path - the default file location method is not reliable with npx. Use one of these options:

   ```json
   {
     "mcpServers": {
       "google-calendar": {
         "command": "npx",
         "args": ["@cocal/google-calendar-mcp"],
         "env": {
           "GOOGLE_OAUTH_CREDENTIALS": "/path/to/your/credentials.json"
         }
       }
     }
   }
   ```

   **For local installations only**: You can place `gcp-oauth.keys.json` in the project root directory.

2. **Authentication Errors / Connection Reset on Callback:**
   - Ensure your credentials file contains credentials for a **Desktop App** type.
   - Verify your user email is added as a **Test User** in the Google Cloud OAuth Consent screen settings (allow a few minutes for changes to propagate).
   - Try deleting `.gcp-saved-tokens.json` and re-authenticating with your preferred credential loading method.
   - Check that no other process is blocking ports 3000-3004 when authentication is required.

3. **Credential Loading Priority Issues:**
   - Remember the loading priority: Environment variable > Default file
   - Check that environment variables are properly set in your shell or Claude Desktop config
   - Verify file paths are absolute and accessible

4. **Tokens Expire Weekly:**
   - If your Google Cloud app is in **Testing** mode, refresh tokens expire after 7 days. Re-authenticate when needed.
   - Consider moving your app to **Production** in the Google Cloud Console for longer-lived refresh tokens (requires verification by Google).

5. **Build Errors:**
   - Run `npm install` again.
   - Check Node.js version (use LTS).
   - Delete the `build/` directory and run `npm run build`.

6. **HTTP Transport Issues:**
   - Check firewall settings and port availability
   - Verify CORS configuration for cross-origin requests
   - Ensure proper authentication setup before starting HTTP mode

If you are a developer want to contribute this repository, please kindly take a look at [Architecture Overview](docs/architecture.md) before contributing

## License

MIT
