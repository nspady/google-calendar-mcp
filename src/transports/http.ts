import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { TokenManager } from "../auth/tokenManager.js";
import { CalendarRegistry } from "../services/CalendarRegistry.js";
import { renderAuthSuccess, renderAuthError, loadWebFile } from "../web/templates.js";

/**
 * Security headers for HTML responses
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block'
};

/**
 * Validate if an origin is allowed.
 * Checks against ALLOWED_ORIGIN environment variable for production,
 * falls back to localhost for development.
 * Properly parses the URL to prevent bypass via subdomains.
 * Exported for testing.
 */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    // Check environment variable for allowed origin
    const allowedOrigin = process.env.ALLOWED_ORIGIN;
    if (allowedOrigin) {
      try {
        const allowedUrl = new URL(allowedOrigin);
        return url.origin === allowedUrl.origin;
      } catch {
        // Invalid ALLOWED_ORIGIN env var, fall through to localhost check
      }
    }

    // Fall back to localhost for development
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    // Invalid URL - reject
    return false;
  }
}

/**
 * Validate bearer token from Authorization header.
 * Compares against MCP_BEARER_TOKEN environment variable.
 * Returns true if valid, false otherwise.
 */
function validateBearerToken(authHeader: string | undefined): boolean {
  const requiredToken = process.env.MCP_BEARER_TOKEN;

  // If no bearer token is configured, allow all requests (development mode)
  if (!requiredToken) {
    return true;
  }

  // Check if Authorization header exists and has Bearer format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.substring(7);

  // Constant-time comparison to prevent timing attacks
  return token === requiredToken;
}

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

  /**
   * Creates an OAuth2Client configured for the given account.
   * Consolidates credential loading and redirect URI construction.
   * Uses OAUTH_REDIRECT_BASE_URL environment variable if set, otherwise falls back to localhost.
   */
  private async createOAuth2Client(accountId: string, host: string, port: number): Promise<import('google-auth-library').OAuth2Client> {
    const { OAuth2Client } = await import('google-auth-library');
    const { loadCredentials } = await import('../auth/client.js');
    const { client_id, client_secret } = await loadCredentials();

    // Use environment variable for production, fallback to localhost for development
    const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL || `http://${host}:${port}`;
    const redirectUri = `${baseUrl}/oauth2callback?account=${accountId}`;

    return new OAuth2Client(
      client_id,
      client_secret,
      redirectUri
    );
  }

  /**
   * Generates an OAuth authorization URL with standard settings.
   */
  private generateOAuthUrl(client: import('google-auth-library').OAuth2Client): string {
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent'
    });
  }

  /**
   * Validates an account ID format.
   * Throws an error if the format is invalid.
   */
  private async validateAccountId(accountId: string): Promise<void> {
    const { validateAccountId } = await import('../auth/paths.js') as any;
    validateAccountId(accountId);
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

      // For requests with Origin header, validate it using proper URL parsing
      // Checks against ALLOWED_ORIGIN environment variable or falls back to localhost
      if (origin && !isAllowedOrigin(origin)) {
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

      // Handle CORS - use ALLOWED_ORIGIN env var for production, localhost for development
      const allowedCorsOrigin = origin && isAllowedOrigin(origin)
        ? origin
        : (process.env.ALLOWED_ORIGIN || `http://${host}:${port}`);
      res.setHeader('Access-Control-Allow-Origin', allowedCorsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization');
      
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
          const html = await loadWebFile('accounts.html');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            ...SECURITY_HEADERS
          });
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

      // Serve shared CSS
      if (req.method === 'GET' && req.url === '/styles.css') {
        try {
          const css = await loadWebFile('styles.css');
          res.writeHead(200, {
            'Content-Type': 'text/css; charset=utf-8',
            ...SECURITY_HEADERS
          });
          res.end(css);
        } catch (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('CSS file not found');
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
          try {
            await this.validateAccountId(accountId);
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Invalid account ID',
              message: error instanceof Error ? error.message : String(error)
            }));
            return;
          }

          // Generate OAuth URL for this account
          const oauth2Client = await this.createOAuth2Client(accountId, host, port);
          const authUrl = this.generateOAuthUrl(oauth2Client);

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
          // Use configured host/port instead of req.headers.host for security
          const url = new URL(req.url, `http://${host}:${port}`);
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
          const oauth2Client = await this.createOAuth2Client(accountId, host, port);
          const { tokens } = await oauth2Client.getToken(code);

          // Get user email before saving tokens
          oauth2Client.setCredentials(tokens);
          let email = 'unknown';
          try {
            const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token || '');
            email = tokenInfo.email || 'unknown';
          } catch {
            // Email retrieval failed, continue with 'unknown'
          }

          // Save tokens for this account with cached email
          const originalMode = this.tokenManager.getAccountMode();
          try {
            this.tokenManager.setAccountMode(accountId);
            await this.tokenManager.saveTokens(tokens, email !== 'unknown' ? email : undefined);
          } finally {
            this.tokenManager.setAccountMode(originalMode);
          }

          // Invalidate calendar registry cache since accounts changed
          CalendarRegistry.getInstance().clearCache();

          // Compute allowed origin for postMessage - use production URL if available
          const postMessageOrigin = process.env.ALLOWED_ORIGIN || `http://${host}:${port}`;

          const successHtml = await renderAuthSuccess({
            accountId,
            email: email !== 'unknown' ? email : undefined,
            showCloseButton: true,
            postMessageOrigin
          });
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            ...SECURITY_HEADERS
          });
          res.end(successHtml);
        } catch (error) {
          const errorHtml = await renderAuthError({
            errorMessage: error instanceof Error ? error.message : String(error),
            showCloseButton: true
          });
          res.writeHead(500, {
            'Content-Type': 'text/html; charset=utf-8',
            ...SECURITY_HEADERS
          });
          res.end(errorHtml);
        }
        return;
      }

      // DELETE /api/accounts/:id - Remove account
      if (req.method === 'DELETE' && req.url?.startsWith('/api/accounts/')) {
        const accountId = req.url.substring('/api/accounts/'.length);

        try {
          // Validate account ID format
          await this.validateAccountId(accountId);

          // Switch to account and clear tokens
          const originalMode = this.tokenManager.getAccountMode();
          try {
            this.tokenManager.setAccountMode(accountId);
            await this.tokenManager.clearTokens();
          } finally {
            this.tokenManager.setAccountMode(originalMode);
          }

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
          await this.validateAccountId(accountId);

          // Generate OAuth URL for re-authentication
          const oauth2Client = await this.createOAuth2Client(accountId, host, port);
          const authUrl = this.generateOAuthUrl(oauth2Client);

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

      // All other requests are MCP requests - validate bearer token if required
      const authHeader = req.headers.authorization;
      if (!validateBearerToken(authHeader)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or missing bearer token. Please provide a valid Authorization: Bearer <token> header.'
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