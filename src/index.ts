import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { join, dirname } from "path";

// Import modular components
import { initializeOAuth2Client, initializeOAuth2ClientFromHost } from './auth/client.js';
import { AuthServer } from './auth/server.js';
import { TokenManager } from './auth/tokenManager.js';
import { getToolDefinitions } from './handlers/listTools.js';
import { handleCallTool } from './handlers/callTool.js';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

// --- Global Variables --- 
// Create server instance (global for export)
const server = new Server(
  {
    name: "google-calendar",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let oauth2Client: OAuth2Client;
let tokenManager: TokenManager | undefined;
let authServer: AuthServer | undefined;
let hostAuthMode = false;

// --- Main Application Logic --- 
async function main() {
  try {
    // 1. Initialize Authentication
    if (hostAuthMode) {
      oauth2Client = await initializeOAuth2ClientFromHost();
      if (!oauth2Client.credentials.access_token) {
        throw new Error("Missing or invalid GOOGLE_API_ACCESS_TOKEN.");
      }
      // No tokenManager, no AuthServer in host-auth mode
    } else {
      oauth2Client = await initializeOAuth2Client();
      tokenManager = new TokenManager(oauth2Client);
      authServer = new AuthServer(oauth2Client);
      // 2. Start auth server if authentication is required
      // The start method internally validates tokens first
      const authSuccess = await authServer.start();
      if (!authSuccess) {
        process.exit(1);
      }
    }

    // 3. Set up MCP Handlers
    
    // List Tools Handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Directly return the definitions from the handler module
      return getToolDefinitions();
    });

    // Call Tool Handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!hostAuthMode && tokenManager && !(await tokenManager.validateTokens())) {
        throw new Error("Authentication required. Please run 'npm run auth' to authenticate.");
      }
      // In hostAuthMode, assume token is valid (cannot refresh)
      return handleCallTool(request, oauth2Client);
    });

    // 4. Connect Server Transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // 5. Set up Graceful Shutdown
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

  } catch (error: unknown) {
    process.stderr.write(`Server startup failed: ${error}\n`);
    process.exit(1);
  }
}

// --- Cleanup Logic --- 
async function cleanup() {
  try {
    if (authServer) {
      // Attempt to stop the auth server if it exists and might be running
      await authServer.stop();
    }
    process.exit(0);
  } catch (error: unknown) {
    process.exit(1);
  }
}

// --- Command Line Interface ---
async function runAuthServer(): Promise<void> {
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
      console.error(
        "Authentication failed. Could not start server or validate existing tokens. Check port availability (3000-3004) and try again."
      );
      process.exit(1);
    } else if (authServerInstance.authCompletedSuccessfully) {
      // Auth was successful (either existing tokens were valid or flow completed just now)
      console.log("Authentication successful.");
      process.exit(0); // Exit cleanly if auth is already done
    }

    // If we reach here, the server started and is waiting for the browser callback
    console.log(
      "Authentication server started. Please complete the authentication in your browser..."
    );

    // Wait for completion
    const intervalId = setInterval(async () => {
      if (authServerInstance.authCompletedSuccessfully) {
        clearInterval(intervalId);
        await authServerInstance.stop();
        console.log("Authentication completed successfully!");
        process.exit(0);
      }
    }, 1000);
  } catch (error) {
    console.error("Authentication failed:", error);
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
Google Calendar MCP Server v${VERSION}

Usage:
  npx @cocal/google-calendar-mcp [command] [--host-auth]

Commands:
  auth     Run the authentication flow
  start    Start the MCP server (default)
  version  Show version information
  help     Show this help message

Options:
  --host-auth   Use access token from environment variable (GOOGLE_API_ACCESS_TOKEN)

Examples:
  npx @cocal/google-calendar-mcp auth
  npx @cocal/google-calendar-mcp start
  npx @cocal/google-calendar-mcp start --host-auth
  npx @cocal/google-calendar-mcp version
  npx @cocal/google-calendar-mcp

Environment Variables:
  GOOGLE_OAUTH_CREDENTIALS    Path to OAuth credentials file
  GOOGLE_API_ACCESS_TOKEN     Access token for --host-auth mode
`);
}

function showVersion(): void {
  console.log(`Google Calendar MCP Server v${VERSION}`);
}

// --- Exports & Execution Guard --- 
// Export server and main for testing or potential programmatic use
export { main, server, runAuthServer };

// Parse CLI arguments
function parseCliArgs(): { command: string | undefined } {
  const args = process.argv.slice(2);
  let command: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle special version/help flags as commands
    if (arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h') {
      command = arg;
      continue;
    }
    
    if (arg === '--host-auth') {
      hostAuthMode = true;
      continue;
    }
    
    // Check for command (first non-option argument)
    if (!command && !arg.startsWith('--')) {
      command = arg;
      continue;
    }
  }

  return { command };
}

// CLI logic here (run always)
const { command } = parseCliArgs();

switch (command) {
  case "auth":
    runAuthServer().catch((error) => {
      console.error("Authentication failed:", error);
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
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}