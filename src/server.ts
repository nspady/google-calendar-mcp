import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { OAuth2Client } from "google-auth-library";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Import authentication components
import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';
import { TokenManager } from './auth/tokenManager.js';

// Import tool registry
import { ToolRegistry } from './tools/registry.js';

// Import account management handler
import { ManageAccountsHandler, ServerContext } from './handlers/core/ManageAccountsHandler.js';
import { z } from 'zod';
import { CalendarRegistry } from './services/CalendarRegistry.js';

// Import transport handlers
import { StdioTransportHandler } from './transports/stdio.js';
import { HttpTransportHandler, HttpTransportConfig, McpServerFactory } from './transports/http.js';

// Import config
import { ServerConfig } from './config/TransportConfig.js';

// Import UI resource registration
import { registerUIResources } from './ui/register-ui-resources.js';


// Read version from package.json
const __server_dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_VERSION = JSON.parse(readFileSync(join(__server_dirname, '..', 'package.json'), 'utf-8')).version;

function buildServerInfo(): { name: string; version: string; title?: string; icons?: { src: string; mimeType: string; sizes: string[] }[] } {
  const info: ReturnType<typeof buildServerInfo> = {
    name: "google-calendar",
    version: SERVER_VERSION,
    title: "Google Calendar",
  };

  const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL || process.env.MCP_ISSUER_URL;
  if (baseUrl) {
    info.icons = [{ src: `${baseUrl.replace(/\/+$/, '')}/icon.png`, mimeType: "image/png", sizes: ["any"] }];
  }

  return info;
}

export class GoogleCalendarMcpServer {
  private server: McpServer;
  private oauth2Client!: OAuth2Client;
  private tokenManager!: TokenManager;
  private authServer!: AuthServer;
  private config: ServerConfig;
  private accounts!: Map<string, OAuth2Client>;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new McpServer(buildServerInfo());
  }

  async initialize(): Promise<void> {
    // 1. Initialize Authentication (but don't block on it)
    this.oauth2Client = await initializeOAuth2Client();
    this.tokenManager = new TokenManager(this.oauth2Client);
    this.authServer = new AuthServer(this.oauth2Client);

    // 2. Load all authenticated accounts
    this.accounts = await this.tokenManager.loadAllAccounts();

    // 3. Handle startup authentication based on transport type
    await this.handleStartupAuthentication();

    // 4. Set up Modern Tool Definitions
    this.registerTools();
    this.registerPrompts();
    this.registerResources();

    // 5. Register MCP Apps UI resources
    await registerUIResources(this.server);

    // 6. Set up Graceful Shutdown
    this.setupGracefulShutdown();
  }

  private async handleStartupAuthentication(): Promise<void> {
    // Skip authentication in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.accounts = await this.tokenManager.loadAllAccounts();
    if (this.accounts.size > 0) {
      const accountList = Array.from(this.accounts.keys()).join(', ');
      process.stderr.write(`Valid tokens found for account(s): ${accountList}\n`);
      return;
    }
    
    const accountMode = this.tokenManager.getAccountMode();
    
    if (this.config.transport.type === 'stdio') {
      // For stdio mode, check for existing tokens
      const hasValidTokens = await this.tokenManager.validateTokens(accountMode);
      if (!hasValidTokens) {
        // No existing tokens - server will start but calendar tools won't work
        // User can authenticate via the 'manage-accounts' tool
        process.stderr.write(`⚠️  No authenticated accounts found.\n`);
        process.stderr.write(`Use the 'manage-accounts' tool with action 'add' to authenticate a Google account, or run:\n`);
        process.stderr.write(`  npx @cocal/google-calendar-mcp auth\n\n`);
        // Don't exit - allow server to start so add-account tool is available
      } else {
        process.stderr.write(`Valid ${accountMode} user tokens found.\n`);
        this.accounts = await this.tokenManager.loadAllAccounts();
      }
    } else {
      // For HTTP mode, check for tokens but don't block startup
      const hasValidTokens = await this.tokenManager.validateTokens(accountMode);
      if (!hasValidTokens) {
        process.stderr.write(`⚠️  No valid ${accountMode} user authentication tokens found.\n`);
        process.stderr.write('Visit the server URL in your browser to authenticate, or run "npm run auth" separately.\n');
      } else {
        process.stderr.write(`Valid ${accountMode} user tokens found.\n`);
        this.accounts = await this.tokenManager.loadAllAccounts();
      }
    }
  }

  private registerTools(): void {
    ToolRegistry.registerAll(this.server, this.executeWithHandler.bind(this), this.config);

    // Register account management tools separately (they need special context)
    this.registerAccountManagementTools();
  }

  /**
   * Register the manage-accounts tool that needs access to server internals.
   * This tool is special because it:
   * - Doesn't require existing authentication (for 'add' action)
   * - Needs access to authServer, tokenManager, etc.
   */
  private registerAccountManagementTools(): void {
    this.registerAccountManagementToolsOn(this.server);
  }

  private registerAccountManagementToolsOn(server: McpServer): void {
    // Use arrow functions to keep `this` reference current after reloadAccounts()
    const self = this;
    const serverContext: ServerContext = {
      oauth2Client: this.oauth2Client,
      tokenManager: this.tokenManager,
      authServer: this.authServer,
      get accounts() { return self.accounts; },
      reloadAccounts: async () => {
        this.accounts = await this.tokenManager.loadAllAccounts();
        return this.accounts;
      },
      oauthRedirectBaseUrl: process.env.OAUTH_REDIRECT_BASE_URL,
    };

    const manageAccountsHandler = new ManageAccountsHandler();
    server.registerTool(
      'manage-accounts',
      {
        title: 'Manage Google Accounts',
        description: "Manage Google account authentication. Actions: 'list' (show accounts), 'add' (authenticate new account), 'remove' (remove account).",
        inputSchema: {
          action: z.enum(['list', 'add', 'remove'])
            .describe("Action to perform: 'list' shows all accounts, 'add' authenticates a new account, 'remove' removes an account"),
          account_id: z.string()
            .regex(/^[a-z0-9_-]{1,64}$/, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only")
            .optional()
            .describe("Account nickname (e.g., 'work', 'personal') - a friendly name to identify this Google account. Required for 'add' and 'remove'. Optional for 'list' (shows all if omitted)")
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async (args) => {
        return manageAccountsHandler.runTool(args, serverContext);
      }
    );
  }

  private registerPrompts(server?: McpServer): void {
    const target = server ?? this.server;
    target.registerPrompt(
      'daily-agenda-brief',
      {
        title: 'Daily Agenda Brief',
        description: 'Generate a concise daily agenda brief with priorities, risks, and focus blocks.',
        argsSchema: {
          date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today's date in the selected timezone."),
          account: z.union([z.string(), z.array(z.string())]).optional().describe("Account nickname or list of account nicknames to include."),
          timeZone: z.string().optional().describe("IANA timezone (for example: America/Los_Angeles).")
        }
      },
      async ({ date, account, timeZone }) => {
        const accountHint = Array.isArray(account) ? account.join(', ') : account;
        const dateHint = date ?? 'today';
        const timeZoneHint = timeZone ?? 'calendar default timezone';
        const toolArgs: Record<string, unknown> = {
          calendarId: 'primary'
        };
        if (account) {
          toolArgs.account = account;
        }
        if (timeZone) {
          toolArgs.timeZone = timeZone;
        }

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text:
                  `Create my daily agenda brief for ${dateHint} in ${timeZoneHint}. ` +
                  `Account scope: ${accountHint ?? 'all connected accounts'}.\n\n` +
                  `Use these tools in order:\n` +
                  `1) get-current-time to ground date/time context.\n` +
                  `2) list-events with args ${JSON.stringify(toolArgs)} and a time window for the requested day.\n` +
                  `3) get-freebusy if you need to confirm open focus blocks.\n\n` +
                  `Return sections:\n` +
                  `- Priorities (top 3)\n` +
                  `- Meeting Risks (overlaps, back-to-back runs, insufficient prep gaps)\n` +
                  `- Suggested Focus Blocks (specific time ranges)\n` +
                  `- Prep Checklist (owner + due-before-event)\n\n` +
                  `Keep it concise, actionable, and timezone-explicit.`
              }
            }
          ]
        };
      }
    );

    target.registerPrompt(
      'find-and-book-meeting',
      {
        title: 'Find and Book Meeting',
        description: 'Find candidate meeting times and create an event only after explicit confirmation.',
        argsSchema: {
          title: z.string().describe('Meeting title.'),
          attendeeEmails: z.array(z.string()).optional().describe('List of attendee emails.'),
          durationMinutes: z.number().int().min(15).max(240).describe('Meeting duration in minutes.'),
          windowStart: z.string().describe('Window start in ISO 8601 format.'),
          windowEnd: z.string().describe('Window end in ISO 8601 format.'),
          account: z.union([z.string(), z.array(z.string())]).optional().describe('Account nickname or list of account nicknames to include.'),
          targetCalendarId: z.string().optional().describe("Calendar ID to book on. Defaults to 'primary'."),
          timeZone: z.string().optional().describe('IANA timezone used for candidate slots and final booking.')
        }
      },
      async ({ title, attendeeEmails, durationMinutes, windowStart, windowEnd, account, targetCalendarId, timeZone }) => {
        const freebusyArgs: Record<string, unknown> = {
          timeMin: windowStart,
          timeMax: windowEnd,
          calendars: [{ id: targetCalendarId ?? 'primary' }]
        };
        if (account) {
          freebusyArgs.account = account;
        }
        if (timeZone) {
          freebusyArgs.timeZone = timeZone;
        }

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text:
                  `Find and book a meeting.\n\n` +
                  `Constraints:\n` +
                  `- Title: ${title}\n` +
                  `- Duration: ${durationMinutes} minutes\n` +
                  `- Window: ${windowStart} to ${windowEnd}\n` +
                  `- Account scope: ${Array.isArray(account) ? account.join(', ') : account ?? 'all connected accounts'}\n` +
                  `- Target calendar: ${targetCalendarId ?? 'primary'}\n` +
                  `- Timezone: ${timeZone ?? 'calendar default timezone'}\n` +
                  `- Attendees: ${(attendeeEmails && attendeeEmails.length > 0) ? attendeeEmails.join(', ') : 'none specified'}\n\n` +
                  `Workflow:\n` +
                  `1) Call get-current-time first.\n` +
                  `2) Call get-freebusy with args ${JSON.stringify(freebusyArgs)}.\n` +
                  `3) Propose exactly 3 ranked candidate slots with tradeoffs.\n` +
                  `4) Ask for explicit confirmation of one slot.\n` +
                  `5) Only after confirmation, call create-event with selected slot and provided attendees.\n\n` +
                  `Do not create an event before confirmation.`
              }
            }
          ]
        };
      }
    );
  }

  private registerResources(server?: McpServer): void {
    const target = server ?? this.server;
    target.registerResource(
      'calendar-accounts',
      'calendar://accounts',
      {
        title: 'Connected Accounts and Calendars',
        description: 'Lists authenticated account nicknames and a deduplicated summary of accessible calendars.',
        mimeType: 'application/json'
      },
      async () => {
        try {
          await this.ensureAuthenticated();

          const accountIds = Array.from(this.accounts.keys()).sort();
          const registry = CalendarRegistry.getInstance();
          const unifiedCalendars = await registry.getUnifiedCalendars(this.accounts);

          const payload = {
            generatedAt: new Date().toISOString(),
            accountCount: accountIds.length,
            accountIds,
            calendarCount: unifiedCalendars.length,
            calendars: unifiedCalendars.map((calendar) => ({
              calendarId: calendar.calendarId,
              displayName: calendar.displayName,
              preferredAccount: calendar.preferredAccount,
              access: calendar.accounts.map((accountAccess) => ({
                accountId: accountAccess.accountId,
                accessRole: accountAccess.accessRole,
                primary: accountAccess.primary
              }))
            })),
            notes: [
              "Calendars are deduplicated across accounts by calendar ID.",
              "preferredAccount is the account with the highest permissions for that calendar."
            ]
          };

          return {
            contents: [
              {
                uri: 'calendar://accounts',
                mimeType: 'application/json',
                text: JSON.stringify(payload, null, 2)
              }
            ]
          };
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to load calendar accounts: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    );
  }

  private async ensureAuthenticated(): Promise<void> {
    const availableAccounts = await this.tokenManager.loadAllAccounts();
    if (availableAccounts.size > 0) {
      this.accounts = availableAccounts;
      return;
    }

    // Check if we already have valid tokens
    if (await this.tokenManager.validateTokens()) {
      const refreshedAccounts = await this.tokenManager.loadAllAccounts();
      if (refreshedAccounts.size > 0) {
        this.accounts = refreshedAccounts;
        return;
      }
    }

    // For stdio mode, authentication should have been handled at startup
    if (this.config.transport.type === 'stdio') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Authentication tokens are no longer valid. Please restart the server to re-authenticate."
      );
    }

    // For HTTP mode, try to start auth server if not already running
    try {
      const authSuccess = await this.authServer.start(false); // openBrowser = false for HTTP mode
      
      if (!authSuccess) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Authentication required. Please run 'npm run auth' to authenticate, or visit the auth URL shown in the logs for HTTP mode."
        );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new McpError(ErrorCode.InvalidRequest, error.message);
      }
      throw new McpError(ErrorCode.InvalidRequest, "Authentication required. Please run 'npm run auth' to authenticate.");
    }
  }

  private async executeWithHandler(handler: any, args: any): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    await this.ensureAuthenticated();

    const result = await handler.runTool(args, this.accounts);
    return result;
  }

  async start(): Promise<void> {
    switch (this.config.transport.type) {
      case 'stdio':
        const stdioHandler = new StdioTransportHandler(this.server);
        await stdioHandler.connect();
        break;
        
      case 'http':
        const httpConfig: HttpTransportConfig = {
          port: this.config.transport.port,
          host: this.config.transport.host,
          mcpOAuth: this.config.mcpOAuth,
        };
        const serverFactory: McpServerFactory = async () => {
          const server = new McpServer(buildServerInfo());
          await ToolRegistry.registerAll(server, this.executeWithHandler.bind(this), this.config);
          this.registerAccountManagementToolsOn(server);
          this.registerPrompts(server);
          this.registerResources(server);
          await registerUIResources(server);
          return server;
        };
        const httpHandler = new HttpTransportHandler(
          serverFactory,
          httpConfig,
          this.tokenManager
        );
        await httpHandler.connect();
        break;
        
      default:
        throw new Error(`Unsupported transport type: ${this.config.transport.type}`);
    }
  }

  private setupGracefulShutdown(): void {
    const cleanup = async () => {
      try {
        if (this.authServer) {
          await this.authServer.stop();
        }
        
        // McpServer handles transport cleanup automatically
        this.server.close();
        
        process.exit(0);
      } catch (error: unknown) {
        process.stderr.write(`Error during cleanup: ${error instanceof Error ? error.message : error}\n`);
        process.exit(1);
      }
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  // Expose server for testing
  getServer(): McpServer {
    return this.server;
  }
} 
