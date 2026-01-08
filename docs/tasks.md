# Google Tasks Integration

Google Tasks integration allows you to manage tasks alongside your calendar events. This feature is **disabled by default** to keep the OAuth scope minimal.

## Prerequisites

Before enabling Tasks integration, you need to complete these steps:

### 1. Enable the Tasks API in Google Cloud Console

The Tasks API must be enabled separately from the Calendar API in your Google Cloud project.

1. Go to the [Google Tasks API page](https://console.cloud.google.com/apis/library/tasks.googleapis.com)
2. Make sure your project is selected in the top bar
3. Click **Enable**
4. Wait a few minutes for the change to propagate

> **Note**: If you skip this step, you'll see an error like:
> ```
> Google Tasks API has not been used in project XXXXX before or it is disabled.
> ```

### 2. Enable Tasks in the MCP Server

Tasks must be explicitly enabled when running the server. Choose one of these methods:

**Option A: Environment Variable (Recommended for MCP clients)**

Add `ENABLE_TASKS` to your MCP configuration:

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["@cocal/google-calendar-mcp"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/credentials.json",
        "ENABLE_TASKS": "true"
      }
    }
  }
}
```

**Option B: CLI Flag**

```bash
npx @cocal/google-calendar-mcp start --enable-tasks
```

### 3. Re-authenticate with Tasks Scope

After enabling Tasks, you must re-authenticate to grant the additional OAuth scope. The server stores which scopes were granted, and will prompt for re-authentication if Tasks is enabled but the scope is missing.

**For npx users:**
```bash
ENABLE_TASKS=true npx @cocal/google-calendar-mcp auth
```

**For local installation:**
```bash
ENABLE_TASKS=true npm run auth
```

During the OAuth flow, Google will show that the app is requesting additional access for Tasks:
- "Create, edit, organize, and delete all your tasks"

Click **Continue** to grant this permission.

> **Important**: You must include `ENABLE_TASKS=true` when running the auth command, not just when running the server. Otherwise, the auth flow won't request the Tasks scope.

### 4. Restart Your MCP Client

After re-authenticating, restart Claude Desktop (or your MCP client) to pick up the new configuration.

## Available Tools

Once enabled, these task management tools become available:

| Tool | Description |
|------|-------------|
| `list-task-lists` | List all task lists for an account |
| `list-tasks` | List tasks in a task list with filtering by status and due date |
| `get-task` | Get details of a specific task |
| `create-task` | Create a new task with title, notes, and due date |
| `update-task` | Update task title, notes, due date, or status |
| `complete-task` | Mark a task as completed |
| `delete-task` | Delete a task |

## Example Usage

**Create a task:**
```
Create a task to "Review quarterly report" due next Friday
```

**List tasks:**
```
Show me all my incomplete tasks
```

**Complete a task:**
```
Mark the "Send invoices" task as complete
```

**Organize tasks:**
```
What tasks do I have due this week?
```

## Troubleshooting

### "Access denied: Request had insufficient authentication scopes"

This error means your OAuth token doesn't include the Tasks scope. Re-authenticate with Tasks enabled:

```bash
ENABLE_TASKS=true npm run auth
# or for npx:
ENABLE_TASKS=true npx @cocal/google-calendar-mcp auth
```

### "Google Tasks API has not been used in project XXXXX"

The Tasks API isn't enabled in your Google Cloud project. Visit:
```
https://console.cloud.google.com/apis/library/tasks.googleapis.com
```

Enable the API and wait a few minutes before retrying.

### "Tasks feature enabled but no scope information saved"

Your existing token was created before scope tracking was implemented. Re-authenticate to update:

```bash
ENABLE_TASKS=true npm run auth
```

### Tasks tools not appearing

Make sure:
1. `ENABLE_TASKS=true` is set in your MCP client configuration
2. You've restarted your MCP client after changing the configuration
3. If using `ENABLED_TOOLS` filtering, include the task tools you want

## Multi-Account Support

Tasks integration works with multiple accounts. Each account needs to be authenticated with the Tasks scope separately.

To authenticate additional accounts with Tasks:

```bash
ENABLE_TASKS=true GOOGLE_ACCOUNT_MODE=work npm run auth
```

Or use the `manage-accounts` tool in chat after enabling Tasks in your MCP configuration.

## Technical Details

### OAuth Scopes

When Tasks is enabled, the server requests these scopes:
- `https://www.googleapis.com/auth/calendar` (Calendar)
- `https://www.googleapis.com/auth/tasks` (Tasks)

Scope information is stored in the token file (`~/.config/google-calendar-mcp/tokens.json`) under `granted_scopes` for each account.

### Default Task List

Use `@default` as the task list ID to access the user's default task list:

```
List tasks from my default task list
```

### Task Properties

Tasks support these properties:
- **title**: Task title (required, max 1024 characters)
- **notes**: Description/notes (max 8192 characters)
- **due**: Due date in RFC 3339 format (e.g., `2024-01-15T00:00:00Z`)
- **status**: `needsAction` (incomplete) or `completed`
- **parent**: Parent task ID for subtasks
