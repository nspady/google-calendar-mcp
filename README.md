[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/nspady-google-calendar-mcp-badge.png)](https://mseep.ai/app/nspady-google-calendar-mcp)

# Google Calendar MCP Server

This is a Model Context Protocol (MCP) server that provides integration with Google Calendar. It allows LLMs to read, create, update and search for calendar events through a standardized interface.

## Example Usage

Along with the normal capabilities you would expect for a calendar integration you can also do really dynamic, multi-step processes like:

1. Add events from screenshots and images:
   ```
   Add this event to my calendar based on the attached screenshot.
   ```
   Supported image formats: PNG, JPEG, GIF
   Images can contain event details like date, time, location, and description

2. Calendar analysis:
   ```
   What events do I have coming up this week that aren't part of my usual routine?
   ```
3. Check attendance:
   ```
   Which events tomorrow have attendees who have not accepted the invitation?
   ```
4. Auto coordinate events:
   ```
   Here's some available that was provided to me by someone.
   Take a look at the available times and create an event that is free on my work calendar.
   ```
5. Provide your own availability:
   ```
   Please provide availability looking at both my personal and work calendar for this upcoming week.
   Choose times that work well for normal working hours on the East Coast. Meeting time is 1 hour
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
   - Add your email address as a test user under the [OAuth Consent screen](https://console.cloud.google.com/apis/credentials/consent)
      - Note: it will take a few minutes for the test user to be added. The OAuth consent will not allow you to proceed until the test user has propagated.
      - Note about test mode: While an app is in test mode the auth tokens will expire after 1 week and need to be refreshed by running `npm run auth`.

## Installation

1. Clone the repository
2. Install dependencies (this also builds the js via postinstall):
   ```bash
   npm install
   ```
3. Download your Google OAuth credentials from the Google Cloud Console (under "Credentials") and rename the file to `gcp-oauth.keys.json` and place it in the root directory of the project.
   - Ensure the file contains credentials for a "Desktop app".
   - Alternatively, copy the provided template file: `cp gcp-oauth.keys.example.json gcp-oauth.keys.json` and populate it with your credentials from the Google Cloud Console.

## Available Scripts

- `npm run build` - Build the TypeScript code (compiles `src` to `build`)
- `npm run typecheck` - Run TypeScript type checking without compiling
- `npm run start` - Start the compiled MCP server (using `node build/index.js`)
- `npm run auth` - Manually run the Google OAuth authentication flow.
- `npm test` - Run the unit/integration test suite using Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run coverage` - Run tests and generate a coverage report

## Authentication

The server handles Google OAuth 2.0 authentication to access your calendar data.

### Automatic Authentication Flow (During Server Start)

1. Ensure `gcp-oauth.keys.json` is correctly named and placed in the project root.
2. Start the MCP server: `npm start`.
3. The server will check for existing, valid authentication tokens in `.gcp-saved-tokens.json`.
4. If valid tokens are found, the server starts normally.
5. If no valid tokens are found:
   - The server attempts to start a temporary local web server (trying ports 3000-3004).
   - Your default web browser will automatically open to the Google Account login and consent screen.
   - Follow the prompts in the browser to authorize the application.
   - Upon successful authorization, you will be redirected to a local page (e.g., `http://localhost:3000/oauth2callback`).
   - This page will display a success message confirming that the tokens have been saved to `.gcp-saved-tokens.json` (and show the exact file path).
   - The temporary auth server shuts down automatically.
   - The main MCP server continues its startup process.

### Manual Authentication Flow

If you need to re-authenticate or prefer to handle authentication separately:

1. Run the command: `npm run auth`
2. This script performs the same browser-based authentication flow described above.
3. Your browser will open, you authorize, and you'll see the success page indicating where tokens were saved.
4. The script will exit automatically upon successful authentication.

### Token Management

- Authentication tokens are stored in `.gcp-saved-tokens.json` in the project root.
- This file is created automatically and should **not** be committed to version control (it's included in `.gitignore`).
- The server attempts to automatically refresh expired access tokens using the stored refresh token.
- If the refresh token itself expires (e.g., after 7 days if the Google Cloud app is in testing mode) or is revoked, you will need to re-authenticate using either the automatic flow (by restarting the server) or the manual `npm run auth` command.

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

## Usage with Claude Desktop

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


## Development

### Troubleshooting

1. **Authentication Errors / Connection Reset on Callback:**
   - Ensure `gcp-oauth.keys.json` exists and contains credentials for a **Desktop App** type.
   - Verify your user email is added as a **Test User** in the Google Cloud OAuth Consent screen settings (allow a few minutes for changes to propagate).
   - Try deleting `.gcp-saved-tokens.json` and re-authenticating (`npm run auth` or restart `npm start`).
   - Check that no other process is blocking ports 3000-3004 when authentication is required.

2. **Tokens Expire Weekly:**
   - If your Google Cloud app is in **Testing** mode, refresh tokens expire after 7 days. Re-authenticate when needed.
   - Consider moving your app to **Production** in the Google Cloud Console for longer-lived refresh tokens (requires verification by Google).

3. **Build Errors:**
   - Run `npm install` again.
   - Check Node.js version (use LTS).
   - Delete the `build/` directory and run `npm run build`.

if you are a developer want to contribute this repository, please kindly take a look at [Architecture Overview](docs/architecture.md) before contributing

## License

MIT
