import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { TokenManager } from "../auth/tokenManager.js";
import { CalendarRegistry } from "../services/CalendarRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HttpTransportConfig {
  port?: number;
  host?: string;
}

export class HttpTransportHandler {
  private server: McpServer;
  private config: HttpTransportConfig;
  private tokenManager: TokenManager;

  constructor(
    server: McpServer,
    config: HttpTransportConfig = {},
    tokenManager: TokenManager
  ) {
    this.server = server;
    this.config = config;
    this.tokenManager = tokenManager;
  }

  private parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON in request body'));
        }
      });
      req.on('error', reject);
    });
  }

  async connect(): Promise<void> {
    const port = this.config.port || 3000;
    const host = this.config.host || '127.0.0.1';

    // Configure transport for stateless mode to allow multiple initialization cycles
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // Stateless mode - allows multiple initializations
    });

    await this.server.connect(transport);

    // Create HTTP server to handle the StreamableHTTP transport
    const httpServer = http.createServer(async (req, res) => {
      // Validate Origin header to prevent DNS rebinding attacks (MCP spec requirement)
      const origin = req.headers.origin;
      const allowedOrigins = [
        'http://localhost',
        'http://127.0.0.1',
        'https://localhost',
        'https://127.0.0.1'
      ];

      // For requests with Origin header, validate it
      if (origin && !allowedOrigins.some(allowed => origin.startsWith(allowed))) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Forbidden: Invalid origin',
          message: 'Origin header validation failed'
        }));
        return;
      }

      // Basic request size limiting (prevent DoS)
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      const maxRequestSize = 10 * 1024 * 1024; // 10MB limit
      if (contentLength > maxRequestSize) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Payload Too Large',
          message: 'Request size exceeds maximum allowed size'
        }));
        return;
      }

      // Handle CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Validate Accept header for MCP requests (spec requirement)
      if (req.method === 'POST' || req.method === 'GET') {
        const acceptHeader = req.headers.accept;
        if (acceptHeader && !acceptHeader.includes('application/json') && !acceptHeader.includes('text/event-stream') && !acceptHeader.includes('*/*')) {
          res.writeHead(406, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not Acceptable',
            message: 'Accept header must include application/json or text/event-stream'
          }));
          return;
        }
      }

      // Serve Account Management UI
      if (req.method === 'GET' && (req.url === '/' || req.url === '/accounts')) {
        try {
          // Try build location first, then source location
          let htmlPath = path.join(__dirname, 'web', 'accounts.html'); // build location
          try {
            await fs.access(htmlPath);
          } catch {
            // Build location doesn't exist, try source location
            htmlPath = path.join(__dirname, '..', 'web', 'accounts.html');
          }

          const html = await fs.readFile(htmlPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Failed to load UI',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }

      // Account Management API Endpoints

      // GET /api/accounts - List all authenticated accounts
      if (req.method === 'GET' && req.url === '/api/accounts') {
        try {
          const accounts = await this.tokenManager.listAccounts();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accounts }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Failed to list accounts',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }

      // POST /api/accounts - Add new account (get OAuth URL)
      if (req.method === 'POST' && req.url === '/api/accounts') {
        try {
          const body = await this.parseRequestBody(req);
          const accountId = body.accountId;

          if (!accountId || typeof accountId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Invalid request',
              message: 'accountId is required and must be a string'
            }));
            return;
          }

          // Validate account ID format
          const { validateAccountId } = await import('../auth/paths.js') as any;
          try {
            validateAccountId(accountId);
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Invalid account ID',
              message: error instanceof Error ? error.message : String(error)
            }));
            return;
          }

          // Generate OAuth URL for this account
          const { OAuth2Client } = await import('google-auth-library');
          const { loadCredentials } = await import('../auth/client.js');

          const { client_id, client_secret } = await loadCredentials();
          const oauth2Client = new OAuth2Client(
            client_id,
            client_secret,
            `http://${req.headers.host}/oauth2callback?account=${accountId}`
          );

          const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar'],
            prompt: 'consent'
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            authUrl,
            accountId
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Failed to initiate OAuth flow',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }

      // GET /oauth2callback - OAuth callback handler
      if (req.method === 'GET' && req.url?.startsWith('/oauth2callback')) {
        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const code = url.searchParams.get('code');
          const accountId = url.searchParams.get('account');

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Error</h1><p>Authorization code missing</p>');
            return;
          }

          if (!accountId) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Error</h1><p>Account ID missing</p>');
            return;
          }

          // Exchange code for tokens
          const { OAuth2Client } = await import('google-auth-library');
          const { loadCredentials } = await import('../auth/client.js');

          const { client_id, client_secret } = await loadCredentials();
          const oauth2Client = new OAuth2Client(
            client_id,
            client_secret,
            `http://${req.headers.host}/oauth2callback?account=${accountId}`
          );

          const { tokens } = await oauth2Client.getToken(code);

          // Save tokens for this account
          const originalMode = this.tokenManager.getAccountMode();
          this.tokenManager.setAccountMode(accountId);
          await this.tokenManager.saveTokens(tokens);
          this.tokenManager.setAccountMode(originalMode);

          // Invalidate calendar registry cache since accounts changed
          CalendarRegistry.getInstance().clearCache();

          // Get user email
          oauth2Client.setCredentials(tokens);
          const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token || '');
          const email = tokenInfo.email || 'unknown';

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: #f5f5f5;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                  background: white;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                  max-width: 500px;
                }
                h1 { color: #4CAF50; margin-bottom: 1rem; }
                p { color: #666; margin: 0.5rem 0; }
                .account-info {
                  background: #f9f9f9;
                  padding: 1rem;
                  border-radius: 4px;
                  margin: 1rem 0;
                }
                .account-id { font-weight: 600; color: #333; }
                .email { color: #1976d2; }
                button {
                  margin-top: 1rem;
                  padding: 0.75rem 1.5rem;
                  background: #1976d2;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  font-size: 1rem;
                  cursor: pointer;
                }
                button:hover { background: #1565c0; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>✓ Authentication Successful!</h1>
                <div class="account-info">
                  <p class="account-id">Account: ${accountId}</p>
                  <p class="email">${email}</p>
                </div>
                <p>You can now close this window and return to the account manager.</p>
                <button onclick="window.close()">Close Window</button>
              </div>
              <script>
                // Try to communicate back to opener
                if (window.opener) {
                  window.opener.postMessage({ type: 'auth-success', accountId: '${accountId}' }, '*');
                }
                // Auto-close after 3 seconds
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
            </html>
          `);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
            <body style="font-family: sans-serif; padding: 2rem;">
              <h1>Authentication Failed</h1>
              <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
              <button onclick="window.close()">Close Window</button>
            </body>
            </html>
          `);
        }
        return;
      }

      // DELETE /api/accounts/:id - Remove account
      if (req.method === 'DELETE' && req.url?.startsWith('/api/accounts/')) {
        const accountId = req.url.substring('/api/accounts/'.length);

        try {
          // Validate account ID format
          const { validateAccountId } = await import('../auth/paths.js') as any;
          validateAccountId(accountId);

          // Switch to account and clear tokens
          const originalMode = this.tokenManager.getAccountMode();
          this.tokenManager.setAccountMode(accountId);
          await this.tokenManager.clearTokens();
          this.tokenManager.setAccountMode(originalMode);

          // Invalidate calendar registry cache since accounts changed
          CalendarRegistry.getInstance().clearCache();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            accountId,
            message: 'Account removed successfully'
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Failed to remove account',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }

      // POST /api/accounts/:id/reauth - Re-authenticate account
      if (req.method === 'POST' && req.url?.match(/^\/api\/accounts\/[^/]+\/reauth$/)) {
        const accountId = req.url.split('/')[3];

        try {
          // Validate account ID format
          const { validateAccountId } = await import('../auth/paths.js') as any;
          validateAccountId(accountId);

          // Generate OAuth URL for re-authentication
          const { OAuth2Client } = await import('google-auth-library');
          const { loadCredentials } = await import('../auth/client.js');

          const { client_id, client_secret } = await loadCredentials();
          const oauth2Client = new OAuth2Client(
            client_id,
            client_secret,
            `http://${req.headers.host}/oauth2callback?account=${accountId}`
          );

          const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar'],
            prompt: 'consent'
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            authUrl,
            accountId
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Failed to initiate re-authentication',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }

      // Handle health check endpoint
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          server: 'google-calendar-mcp',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        process.stderr.write(`Error handling request: ${error instanceof Error ? error.message : error}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          }));
        }
      }
    });

    httpServer.listen(port, host, () => {
      process.stderr.write(`Google Calendar MCP Server listening on http://${host}:${port}\n`);
    });
  }
} 