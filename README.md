# Google Calendar MCP Server

This is a Model Context Protocol (MCP) server that provides integration with Google Calendar. It allows LLMs to read, create, update and search for calendar events through a standardized interface.

## Features

- **Multi-Calendar Support**: List events from multiple calendars simultaneously
- **Event Management**: Create, update (including notifications), delete, and search calendar events
- **Recurring Events**: Advanced modification scopes for recurring events (single instance, all instances, or future instances only)
- **Calendar Management**: List calendars and their properties
- **Free/Busy Queries**: Check availability across calendars

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

1. Node.js (Latest LTS recommended)
2. TypeScript 5.3 or higher
3. A Google Cloud project with the Calendar API enabled
4. OAuth 2.0 credentials (Client ID and Client Secret)

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
   - Save the auth key, you'll need to add its path to the JSON in the next step
   - Add your email address as a test user under the [Audience screen](https://console.cloud.google.com/auth/audience)
      - Note: it might take a few minutes for the test user to be added. The OAuth consent will not allow you to proceed until the test user has propagated.
      - Note about test mode: While an app is in test mode the auth tokens will expire after 1 week and need to be refreshed by running `npm run auth`.

## Installation

### Option 1: Use with npx (Recommended)

1. **Add to Claude Desktop**: Close Claude Desktop, then edit your Claude Desktop configuration file:
   
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

2. **Start Claude Desktop** - it will open the google sign-in dialogue in a browser window 

### Option 2: Local Installation

1. Clone the repository
2. Install dependencies (this also builds the js via postinstall):
   ```bash
   git clone https://github.com/nspady/google-calendar-mcp.git
   cd google-calendar-mcp
   npm install
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
- `npm run start` - Start the compiled MCP server (using `node build/index.js`)
- `npm run auth` - Manually run the Google OAuth authentication flow.
- `npm test` - Run the unit/integration test suite using Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run coverage` - Run tests and generate a coverage report

## OAuth Credentials Configuration

The server supports multiple methods for providing OAuth credentials, with a priority-based loading system:

### Credential Loading Priority

The server searches for OAuth credentials in the following order:

1. **Environment Variable** (Highest Priority): `GOOGLE_OAUTH_CREDENTIALS` environment variable
2. **Default File** (Lowest Priority): `gcp-oauth.keys.json` in the current working directory

### Configuration Methods

#### Method 1: Environment Variable (Recommended)
Set the `GOOGLE_OAUTH_CREDENTIALS` environment variable:

```bash
# Set environment variable
export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/credentials.json"

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

## Testing

Unit and integration tests are implemented using [Vitest](https://vitest.dev/).

- Run tests: `npm test`
- Run tests in watch mode: `npm run test:watch`
- Generate coverage report: `npm run coverage`

Tests mock external dependencies (Google API, filesystem) to ensure isolated testing of server logic and handlers.

## Security Notes

- The server runs locally and requires OAuth authentication.
- OAuth credentials (`gcp-oauth.keys.json`) and saved tokens (`.gcp-saved-tokens.json`) should **never** be committed to version control. Ensure they are added to your `.gitignore` file.
- For production use, consider getting your OAuth application verified by Google.

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

If you are a developer want to contribute this repository, please kindly take a look at [Architecture Overview](docs/architecture.md) before contributing

## License

MIT
