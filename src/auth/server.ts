import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './tokenManager.js';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { loadCredentials } from './client.js';
import { getAccountMode } from './utils.js';
import { renderAuthSuccess, renderAuthError, renderAuthLanding, loadWebFile } from '../web/templates.js';

export interface StartForMcpToolResult {
  success: boolean;
  authUrl?: string;
  callbackUrl?: string;
  error?: string;
}

export class AuthServer {
  private baseOAuth2Client: OAuth2Client; // Used by TokenManager for validation/refresh
  private flowOAuth2Client: OAuth2Client | null = null; // Used specifically for the auth code flow
  private server: http.Server | null = null;
  private tokenManager: TokenManager;
  private portRange: { start: number; end: number };
  private activeConnections: Set<import('net').Socket> = new Set(); // Track active socket connections
  public authCompletedSuccessfully = false; // Flag for standalone script
  private mcpToolTimeout: ReturnType<typeof setTimeout> | null = null; // Timeout for MCP tool auth flow
  private autoShutdownOnSuccess = false; // Whether to auto-shutdown after successful auth

  constructor(oauth2Client: OAuth2Client) {
    this.baseOAuth2Client = oauth2Client;
    this.tokenManager = new TokenManager(oauth2Client);
    this.portRange = { start: 3500, end: 3505 };
  }

  /**
   * Creates the flow-specific OAuth2Client with the correct redirect URI.
   */
  private async createFlowOAuth2Client(port: number): Promise<OAuth2Client> {
    const { client_id, client_secret } = await loadCredentials();
    return new OAuth2Client(
      client_id,
      client_secret,
      `http://localhost:${port}/oauth2callback`
    );
  }

  /**
   * Generates an OAuth authorization URL with standard settings.
   */
  private generateOAuthUrl(client: OAuth2Client): string {
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent'
    });
  }

  private createServer(): http.Server {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      
      if (url.pathname === '/styles.css') {
        // Serve shared CSS
        const css = await loadWebFile('styles.css');
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(css);

      } else if (url.pathname === '/') {
        // Root route - show auth link
        const clientForUrl = this.flowOAuth2Client || this.baseOAuth2Client;
        const authUrl = this.generateOAuthUrl(clientForUrl);
        const accountMode = getAccountMode();

        const landingHtml = await renderAuthLanding({
          accountId: accountMode,
          authUrl: authUrl
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(landingHtml);

      } else if (url.pathname === '/oauth2callback') {
        // OAuth callback route
        const code = url.searchParams.get('code');
        if (!code) {
          const errorHtml = await renderAuthError({
            errorMessage: 'Authorization code missing'
          });
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml);
          return;
        }

        if (!this.flowOAuth2Client) {
          const errorHtml = await renderAuthError({
            errorMessage: 'Authentication flow not properly initiated.'
          });
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml);
          return;
        }
        
        try {
          const { tokens } = await this.flowOAuth2Client.getToken(code);
          await this.tokenManager.saveTokens(tokens);
          this.authCompletedSuccessfully = true;

          const tokenPath = this.tokenManager.getTokenPath();
          const accountMode = this.tokenManager.getAccountMode();

          // Auto-shutdown after successful auth if triggered by MCP tool
          if (this.autoShutdownOnSuccess) {
            // Clear the timeout since auth succeeded
            if (this.mcpToolTimeout) {
              clearTimeout(this.mcpToolTimeout);
              this.mcpToolTimeout = null;
            }
            // Give the browser time to render success page, then shutdown
            setTimeout(() => {
              this.stop().catch(() => {});
            }, 2000);
          }
          
          const successHtml = await renderAuthSuccess({
            accountId: accountMode,
            tokenPath: tokenPath
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(successHtml);
        } catch (error: unknown) {
          this.authCompletedSuccessfully = false;
          const message = error instanceof Error ? error.message : 'Unknown error';
          process.stderr.write(`✗ Token save failed: ${message}\n`);

          const errorHtml = await renderAuthError({
            errorMessage: message
          });
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml);
        }
      } else {
        // 404 for other routes
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    // Track connections at server level
    server.on('connection', (socket) => {
      this.activeConnections.add(socket);
      socket.on('close', () => {
        this.activeConnections.delete(socket);
      });
    });
    
    return server;
  }

  async start(openBrowser = true): Promise<boolean> {
    // Add timeout wrapper to prevent hanging
    return Promise.race([
      this.startWithTimeout(openBrowser),
      new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('Auth server start timed out after 10 seconds')), 10000);
      })
    ]).catch(() => false); // Return false on timeout instead of throwing
  }

  private async startWithTimeout(openBrowser = true): Promise<boolean> {
    if (await this.tokenManager.validateTokens()) {
      this.authCompletedSuccessfully = true;
      return true;
    }
    
    // Try to start the server and get the port
    const port = await this.startServerOnAvailablePort();
    if (port === null) {
      process.stderr.write(`Could not start auth server on available port. Please check port availability (${this.portRange.start}-${this.portRange.end}) and try again.\n`);

      this.authCompletedSuccessfully = false;
      return false;
    }

    // Successfully started server on `port`. Now create the flow-specific OAuth client.
    try {
      this.flowOAuth2Client = await this.createFlowOAuth2Client(port);
    } catch (error) {
        // Could not load credentials, cannot proceed with auth flow
        this.authCompletedSuccessfully = false;
        await this.stop(); // Stop the server we just started
        return false;
    }

    // Generate Auth URL using the newly created flow client
    const authorizeUrl = this.generateOAuthUrl(this.flowOAuth2Client);
    
    // Always show the URL in console for easy access
    process.stderr.write(`\n🔗 Authentication URL: ${authorizeUrl}\n\n`);
    process.stderr.write(`Or visit: http://localhost:${port}\n\n`);
    
    if (openBrowser) {
      try {
        await open(authorizeUrl);
        process.stderr.write(`Browser opened automatically. If it didn't open, use the URL above.\n`);
      } catch (error) {
        process.stderr.write(`Could not open browser automatically. Please use the URL above.\n`);
      }
    } else {
      process.stderr.write(`Please visit the URL above to complete authentication.\n`);
    }

    return true; // Auth flow initiated
  }

  private async startServerOnAvailablePort(): Promise<number | null> {
    for (let port = this.portRange.start; port <= this.portRange.end; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const testServer = this.createServer();
          testServer.listen(port, () => {
            this.server = testServer; // Assign to class property *only* if successful
            resolve();
          });
          testServer.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              // Port is in use, close the test server and reject
              testServer.close(() => reject(err)); 
            } else {
              // Other error, reject
              reject(err);
            }
          });
        });
        return port; // Port successfully bound
      } catch (error: unknown) {
        // Check if it's EADDRINUSE, otherwise rethrow or handle
        if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) {
            // An unexpected error occurred during server start
            return null;
        }
        // EADDRINUSE occurred, loop continues
      }
    }
    return null; // No port found
  }

  public getRunningPort(): number | null {
    if (this.server) {
      const address = this.server.address();
      if (typeof address === 'object' && address !== null) {
        return address.port;
      }
    }
    return null;
  }

  async stop(): Promise<void> {
    // Clear any pending MCP tool timeout
    if (this.mcpToolTimeout) {
      clearTimeout(this.mcpToolTimeout);
      this.mcpToolTimeout = null;
    }
    this.autoShutdownOnSuccess = false;

    return new Promise((resolve, reject) => {
      if (this.server) {
        // Force close all active connections
        for (const connection of this.activeConnections) {
          connection.destroy();
        }
        this.activeConnections.clear();

        // Add a timeout to force close if server doesn't close gracefully
        const timeout = setTimeout(() => {
          process.stderr.write('Server close timeout, forcing exit...\n');
          this.server = null;
          resolve();
        }, 2000); // 2 second timeout

        this.server.close((err) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Start the auth server for use by an MCP tool.
   *
   * Unlike the regular start() method:
   * - Does not open the browser automatically
   * - Returns the auth URL for the MCP tool to return to the user
   * - Auto-shutdowns after successful auth or timeout (5 minutes)
   * - Does not validate existing tokens (allows adding new accounts)
   *
   * @param accountId - The account ID to authenticate
   * @returns Result with auth URL on success, or error on failure
   */
  async startForMcpTool(accountId: string): Promise<StartForMcpToolResult> {
    // If server is already running, stop it first
    if (this.server) {
      await this.stop();
    }

    // Set the account mode
    this.tokenManager.setAccountMode(accountId);

    // Try to start the server and get the port
    const port = await this.startServerOnAvailablePort();
    if (port === null) {
      return {
        success: false,
        error: `Could not start auth server. Ports ${this.portRange.start}-${this.portRange.end} may be in use.`
      };
    }

    // Create the flow-specific OAuth client
    try {
      this.flowOAuth2Client = await this.createFlowOAuth2Client(port);
    } catch (error) {
      await this.stop();
      return {
        success: false,
        error: `Failed to load OAuth credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    // Generate Auth URL
    const authUrl = this.generateOAuthUrl(this.flowOAuth2Client);

    // Enable auto-shutdown on success
    this.autoShutdownOnSuccess = true;
    this.authCompletedSuccessfully = false;

    // Set timeout to auto-shutdown if auth not completed (5 minutes)
    this.mcpToolTimeout = setTimeout(async () => {
      if (!this.authCompletedSuccessfully) {
        process.stderr.write(`Auth timeout for account "${accountId}" - shutting down auth server\n`);
        await this.stop();
      }
    }, 5 * 60 * 1000);

    return {
      success: true,
      authUrl,
      callbackUrl: `http://localhost:${port}/oauth2callback`
    };
  }
} 