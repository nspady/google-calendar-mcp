import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";

// Import authentication components
import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';
import { TokenManager } from './auth/tokenManager.js';

// Import tool registry
import { ToolRegistry } from './tools/registry.js';

// Import account management handler
import { ManageAccountsHandler, ServerContext } from './handlers/core/ManageAccountsHandler.js';
import { z } from 'zod';

// Import transport handlers
import { StdioTransportHandler } from './transports/stdio.js';
import { HttpTransportHandler, HttpTransportConfig } from './transports/http.js';

// Import config
import { ServerConfig } from './config/TransportConfig.js';

export class GoogleCalendarMcpServer {
  private server: McpServer;
  private oauth2Client!: OAuth2Client;
  private tokenManager!: TokenManager;
  private authServer!: AuthServer;
  private config: ServerConfig;
  private accounts!: Map<string, OAuth2Client>;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new McpServer({
      name: "google-calendar",
      version: "1.3.0"
    });
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

    // 5. Set up Graceful Shutdown
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
        // User can authenticate via the 'add-account' tool
        process.stderr.write(`⚠️  No authenticated accounts found.\n`);
        process.stderr.write(`Use the 'add-account' tool to authenticate a Google account, or run:\n`);
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
    const serverContext: ServerContext = {
      oauth2Client: this.oauth2Client,
      tokenManager: this.tokenManager,
      authServer: this.authServer,
      accounts: this.accounts,
      reloadAccounts: async () => {
        this.accounts = await this.tokenManager.loadAllAccounts();
        return this.accounts;
      }
    };

    const manageAccountsHandler = new ManageAccountsHandler();
    this.server.tool(
      'manage-accounts',
      "Manage Google account authentication. Actions: 'list' (show accounts), 'add' (authenticate new account), 'remove' (remove account).",
      {
        action: z.enum(['list', 'add', 'remove'])
          .describe("Action to perform: 'list' shows all accounts, 'add' authenticates a new account, 'remove' removes an account"),
        account_id: z.string()
          .regex(/^[a-z0-9_-]{1,64}$/, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only")
          .optional()
          .describe("Account nickname (e.g., 'work', 'personal') - a friendly name to identify this Google account. Required for 'add' and 'remove'. Optional for 'list' (shows all if omitted)")
      },
      async (args) => {
        return manageAccountsHandler.runTool(args, serverContext);
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
          host: this.config.transport.host
        };
        const httpHandler = new HttpTransportHandler(
          this.server,
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
