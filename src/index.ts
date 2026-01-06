import { fileURLToPath } from "url";
import { GoogleCalendarMcpServer } from './server.js';
import { parseArgs } from './config/TransportConfig.js';
import { readFileSync } from "fs";
import { join, dirname } from "path";

// Import modular components
import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

// --- Main Application Logic --- 
async function main() {
  try {
    // Parse command line arguments
    const config = parseArgs(process.argv.slice(2));
    
    // Create and initialize the server
    const server = new GoogleCalendarMcpServer(config);
    await server.initialize();
    
    // Start the server with the appropriate transport
    await server.start();

  } catch (error: unknown) {
    process.stderr.write(`Failed to start server: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}


// --- Command Line Interface ---
async function runAuthServer(accountId?: string): Promise<void> {
  // Set account mode if specified
  if (accountId) {
    // Validate account ID format
    if (!/^[a-z0-9_-]{1,64}$/.test(accountId)) {
      process.stderr.write('Invalid account ID. Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only.\n');
      process.exit(1);
    }
    process.env.GOOGLE_ACCOUNT_MODE = accountId;
    process.stderr.write(`Authenticating account: ${accountId}\n`);
  }

  // Use the same logic as auth-server.ts
  try {
    // Initialize OAuth client
    const oauth2Client = await initializeOAuth2Client();

    // Create and start the auth server
    const authServerInstance = new AuthServer(oauth2Client);

    // Start with browser opening (true by default)
    const success = await authServerInstance.start(true);

    if (!success && !authServerInstance.authCompletedSuccessfully) {
      // Failed to start and tokens weren't already valid
      process.stderr.write(
        "Authentication failed. Could not start server or validate existing tokens. Check port availability (3000-3004) and try again.\n"
      );
      process.exit(1);
    } else if (authServerInstance.authCompletedSuccessfully) {
      // Auth was successful (either existing tokens were valid or flow completed just now)
      process.stderr.write("Authentication successful.\n");
      process.exit(0); // Exit cleanly if auth is already done
    }

    // If we reach here, the server started and is waiting for the browser callback
    process.stderr.write(
      "Authentication server started. Please complete the authentication in your browser...\n"
    );

    // Wait for completion
    const intervalId = setInterval(async () => {
      if (authServerInstance.authCompletedSuccessfully) {
        clearInterval(intervalId);
        await authServerInstance.stop();
        process.stderr.write("Authentication completed successfully!\n");
        process.exit(0);
      }
    }, 1000);
  } catch (error) {
    process.stderr.write(`Authentication failed: ${error}\n`);
    process.exit(1);
  }
}

function showHelp(): void {
  process.stdout.write(`
Google Calendar MCP Server v${VERSION}

Usage:
  npx @cocal/google-calendar-mcp [command] [options]

Commands:
  auth [account-id]  Run the authentication flow
                     Optional account-id for multi-account support (e.g., work, personal)
  start              Start the MCP server (default)
  version            Show version information
  help               Show this help message

Options:
  --enable-tools <list>   Comma-separated list of tools to enable (whitelist)

Examples:
  npx @cocal/google-calendar-mcp auth              # Authenticate default account
  npx @cocal/google-calendar-mcp auth work         # Authenticate "work" account
  npx @cocal/google-calendar-mcp start
  npx @cocal/google-calendar-mcp start --enable-tools list-events,create-event,get-current-time
  npx @cocal/google-calendar-mcp

Environment Variables:
  GOOGLE_OAUTH_CREDENTIALS    Path to OAuth credentials file
  GOOGLE_ACCOUNT_MODE         Account ID to use (alternative to auth argument)
  ENABLED_TOOLS               Comma-separated list of tools to enable
`);
}

function showVersion(): void {
  process.stdout.write(`Google Calendar MCP Server v${VERSION}\n`);
}

// --- Exports & Execution Guard --- 
// Export main for testing or potential programmatic use
export { main, runAuthServer };

// Parse CLI arguments
function parseCliArgs(): { command: string | undefined; accountId: string | undefined } {
  const args = process.argv.slice(2);
  let command: string | undefined;
  let accountId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle special version/help flags as commands
    if (arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h') {
      command = arg;
      continue;
    }

    // Skip transport options and their values
    if (arg === '--transport' || arg === '--port' || arg === '--host' || arg === '--enable-tools') {
      i++; // Skip the next argument (the value)
      continue;
    }

    // Skip other flags
    if (arg === '--debug') {
      continue;
    }

    // Check for command (first non-option argument)
    if (!command && !arg.startsWith('--')) {
      command = arg;
      continue;
    }

    // If command is 'auth', capture the next non-option argument as account ID
    if (command === 'auth' && !accountId && !arg.startsWith('--')) {
      accountId = arg;
      continue;
    }
  }

  return { command, accountId };
}

// CLI logic here (run always)
const { command, accountId } = parseCliArgs();

switch (command) {
  case "auth":
    runAuthServer(accountId).catch((error) => {
      process.stderr.write(`Authentication failed: ${error}\n`);
      process.exit(1);
    });
    break;
  case "start":
  case void 0:
    main().catch((error) => {
      process.stderr.write(`Failed to start server: ${error}\n`);
      process.exit(1);
    });
    break;
  case "version":
  case "--version":
  case "-v":
    showVersion();
    break;
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    showHelp();
    process.exit(1);
}