# Authentication Setup Guide

This guide provides detailed instructions for setting up Google OAuth 2.0 authentication for the Google Calendar MCP Server.

## Google Cloud Setup

### 1. Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Click "Select a project" → "New Project"
3. Enter a project name (e.g., "Calendar MCP")
4. Click "Create"

### 2. Enable the Google Calendar API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click on it and press "Enable"
4. Wait for the API to be enabled (usually takes a few seconds)

### 3. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure the OAuth consent screen first:
   - Choose "External" user type
   - Fill in the required fields:
     - App name: "Calendar MCP" (or your choice)
     - User support email: Your email
     - Developer contact: Your email
   - Add scopes:
     - Click "Add or Remove Scopes"
     - Add: `https://www.googleapis.com/auth/calendar.events`
     - Or use the broader scope: `https://www.googleapis.com/auth/calendar`
   - Add test users:
     - Add your email address
     - **Important**: Wait 2-3 minutes for test users to propagate

4. Create the OAuth client:
   - Application type: **Desktop app** (Important!)
   - Name: "Calendar MCP Client"
   - Click "Create"

5. Download the credentials:
   - Click the download button (⬇️) next to your new client
   - Save as `gcp-oauth.keys.json`

## Credential File Format

Your credentials file should look like this:

```json
{
  "installed": {
    "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "redirect_uris": ["http://localhost"]
  }
}
```

## Credential Storage Options

### Option 1: Environment Variable (Recommended)

Set the `GOOGLE_OAUTH_CREDENTIALS` environment variable to point to your credentials file:

```bash
export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/gcp-oauth.keys.json"
```

In Claude Desktop config:
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

### Option 2: Default Location

Place the credentials file in the project root as `gcp-oauth.keys.json`.

## Token Storage

OAuth tokens are automatically stored in a secure location:

- **macOS/Linux**: `~/.config/google-calendar-mcp/tokens.json`
- **Windows**: `%APPDATA%\google-calendar-mcp\tokens.json`

To use a custom location, set:
```bash
export GOOGLE_CALENDAR_MCP_TOKEN_PATH="/custom/path/tokens.json"
```

## First-Time Authentication

1. Start Claude Desktop after configuration
2. The server will automatically open your browser for authentication
3. Sign in with your Google account
4. Grant the requested calendar permissions
5. You'll see a success message in the browser
6. Return to Claude - you're ready to use calendar features!

## Re-authentication

If your tokens expire or become invalid:

```bash
npm run auth  # For local installation
```

The server will guide you through the authentication flow again.

## Important Notes

### Test Mode Limitations

While your app is in test mode:
- OAuth tokens expire after 7 days
- Limited to test users you've explicitly added
- Perfect for personal use

To avoid weekly re-authentication, you can:
1. Verify your app in Google Cloud Console (requires review)
2. Or simply re-authenticate weekly with `npm run auth`

### Security Best Practices

1. **Never commit credentials**: Add `gcp-oauth.keys.json` to `.gitignore`
2. **Secure file permissions**: 
   ```bash
   chmod 600 /path/to/gcp-oauth.keys.json
   ```
3. **Use environment variables**: Keeps credentials out of config files
4. **Regularly rotate**: Regenerate credentials if compromised

## Troubleshooting

### "Invalid credentials" error
- Ensure you selected "Desktop app" as the application type
- Check that the credentials file is valid JSON
- Verify the file path is correct

### "Access blocked" error
- Add your email as a test user in OAuth consent screen
- Wait 2-3 minutes for changes to propagate

### "Token expired" error
- Run `npm run auth` to re-authenticate
- Check if you're in test mode (7-day expiration)

See [Troubleshooting Guide](troubleshooting.md) for more issues and solutions.