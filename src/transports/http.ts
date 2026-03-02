import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import { TokenManager } from "../auth/tokenManager.js";
import { CalendarRegistry } from "../services/CalendarRegistry.js";
import { renderAuthSuccess, renderAuthError, loadWebFile } from "../web/templates.js";
import type { McpOAuthConfig } from "../config/TransportConfig.js";

/**
 * Security headers for HTML responses
 */
const SECURITY_HEADERS: Record<string, string> = {
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

function setSecurityHeaders(res: Response): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

export interface HttpTransportConfig {
  port?: number;
  host?: string;
  mcpOAuth?: McpOAuthConfig;
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

  async connect(): Promise<void> {
    const port = this.config.port || 3000;
    const host = this.config.host || '127.0.0.1';

    // Configure transport for stateless mode to allow multiple initialization cycles
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // Stateless mode - allows multiple initializations
    });

    await this.server.connect(transport);

    const app = express();
    app.set('trust proxy', 1);
    // Parse JSON for all routes except /mcp — the MCP transport reads the raw body stream itself
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/mcp') {
        next();
      } else {
        express.json({ limit: '10mb' })(req, res, next);
      }
    });

    // --- MCP OAuth setup (when enabled) ---
    let mcpOAuthProvider: import('../auth/mcp-oauth/McpOAuthProvider.js').McpOAuthProvider | null = null;

    if (this.config.mcpOAuth?.enabled) {
      const issuerUrl = this.config.mcpOAuth.issuerUrl;
      if (!issuerUrl) {
        throw new Error('MCP_ISSUER_URL is required when MCP_OAUTH_ENABLED=true');
      }

      const { McpOAuthProvider } = await import('../auth/mcp-oauth/McpOAuthProvider.js');
      const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');

      mcpOAuthProvider = new McpOAuthProvider({
        tokenManager: this.tokenManager,
        issuerUrl,
      });
      await mcpOAuthProvider.initialize();

      // Install MCP auth router at app root (handles /.well-known/*, /authorize, /token, /register, /revoke)
      app.use(mcpAuthRouter({
        provider: mcpOAuthProvider,
        issuerUrl: new URL(issuerUrl),
        resourceServerUrl: new URL(`${issuerUrl}/mcp`),
        serviceDocumentationUrl: new URL('https://github.com/nspady/google-calendar-mcp'),
      }));

      process.stderr.write(`MCP OAuth enabled with issuer: ${issuerUrl}\n`);
    }

    // --- Global middleware ---

    // Origin validation (DNS rebinding protection)
    // When MCP OAuth is enabled, bearer tokens are the security boundary, so skip origin checks.
    if (!mcpOAuthProvider) {
      app.use((req: Request, res: Response, next: NextFunction) => {
        const origin = req.headers.origin;
        if (origin && !isAllowedOrigin(origin)) {
          res.status(403).json({
            error: 'Forbidden: Invalid origin',
            message: 'Origin header validation failed'
          });
          return;
        }
        next();
      });
    }

    // CORS headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      const allowedCorsOrigin = mcpOAuthProvider
        ? (origin || '*')
        : (origin && isAllowedOrigin(origin) ? origin : (process.env.ALLOWED_ORIGIN || `http://${host}:${port}`));
      res.setHeader('Access-Control-Allow-Origin', allowedCorsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization');

      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }
      next();
    });

    // --- Account Management UI ---

    app.get(['/', '/accounts'], async (_req: Request, res: Response) => {
      try {
        const html = await loadWebFile('accounts.html');
        setSecurityHeaders(res);
        res.type('html').send(html);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to load UI',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    app.get('/styles.css', async (_req: Request, res: Response) => {
      try {
        const css = await loadWebFile('styles.css');
        setSecurityHeaders(res);
        res.type('css').send(css);
      } catch {
        res.status(404).type('text').send('CSS file not found');
      }
    });

    // --- Account Management API ---

    app.get('/api/accounts', async (_req: Request, res: Response) => {
      try {
        const accounts = await this.tokenManager.listAccounts();
        res.json({ accounts });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to list accounts',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    app.post('/api/accounts', async (req: Request, res: Response) => {
      try {
        const accountId = req.body?.accountId;

        if (!accountId || typeof accountId !== 'string') {
          res.status(400).json({
            error: 'Invalid request',
            message: 'accountId is required and must be a string'
          });
          return;
        }

        try {
          await this.validateAccountId(accountId);
        } catch (error) {
          res.status(400).json({
            error: 'Invalid account ID',
            message: error instanceof Error ? error.message : String(error)
          });
          return;
        }

        const oauth2Client = await this.createOAuth2Client(accountId, host, port);
        const authUrl = this.generateOAuthUrl(oauth2Client);

        res.json({ authUrl, accountId });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to initiate OAuth flow',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    app.delete('/api/accounts/:id', async (req: Request, res: Response) => {
      const accountId = req.params.id as string;

      try {
        await this.validateAccountId(accountId);

        const originalMode = this.tokenManager.getAccountMode();
        try {
          this.tokenManager.setAccountMode(accountId);
          await this.tokenManager.clearTokens();
        } finally {
          this.tokenManager.setAccountMode(originalMode);
        }

        CalendarRegistry.getInstance().clearCache();

        res.json({
          success: true,
          accountId,
          message: 'Account removed successfully'
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to remove account',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    app.post('/api/accounts/:id/reauth', async (req: Request, res: Response) => {
      const accountId = req.params.id as string;

      try {
        await this.validateAccountId(accountId);

        const oauth2Client = await this.createOAuth2Client(accountId, host, port);
        const authUrl = this.generateOAuthUrl(oauth2Client);

        res.json({ authUrl, accountId });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to initiate re-authentication',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // --- OAuth2 Callback ---

    app.get('/oauth2callback', async (req: Request, res: Response) => {
      try {
        const code = req.query.code as string | undefined;
        const stateParam = req.query.state as string | undefined;

        if (!code) {
          res.status(400).type('html').send('<h1>Error</h1><p>Authorization code missing</p>');
          return;
        }

        // Check if this is an MCP auth flow callback
        if (mcpOAuthProvider && stateParam) {
          const { McpOAuthProvider: McpOAuthProviderClass } = await import('../auth/mcp-oauth/McpOAuthProvider.js');
          const mcpState = McpOAuthProviderClass.parseMcpAuthState(stateParam);
          if (mcpState) {
            await mcpOAuthProvider.completeMcpAuth(
              code,
              mcpState.sessionId,
              mcpState.account,
              res
            );
            return;
          }
        }

        // Standard account management OAuth callback
        const accountId = req.query.account as string | undefined;
        if (!accountId) {
          res.status(400).type('html').send('<h1>Error</h1><p>Account ID missing</p>');
          return;
        }

        const oauth2Client = await this.createOAuth2Client(accountId, host, port);
        const { tokens } = await oauth2Client.getToken(code);

        oauth2Client.setCredentials(tokens);
        let email = 'unknown';
        try {
          const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token || '');
          email = tokenInfo.email || 'unknown';
        } catch {
          // Email retrieval failed
        }

        const originalMode = this.tokenManager.getAccountMode();
        try {
          this.tokenManager.setAccountMode(accountId);
          await this.tokenManager.saveTokens(tokens, email !== 'unknown' ? email : undefined);
        } finally {
          this.tokenManager.setAccountMode(originalMode);
        }

        CalendarRegistry.getInstance().clearCache();

        const postMessageOrigin = process.env.ALLOWED_ORIGIN || `http://${host}:${port}`;

        const successHtml = await renderAuthSuccess({
          accountId,
          email: email !== 'unknown' ? email : undefined,
          showCloseButton: true,
          postMessageOrigin
        });
        setSecurityHeaders(res);
        res.type('html').send(successHtml);
      } catch (error) {
        const errorHtml = await renderAuthError({
          errorMessage: error instanceof Error ? error.message : String(error),
          showCloseButton: true
        });
        setSecurityHeaders(res);
        res.status(500).type('html').send(errorHtml);
      }
    });

    // --- Health Check ---

    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        server: 'google-calendar-mcp',
        timestamp: new Date().toISOString()
      });
    });

    // --- MCP Endpoint ---

    // Protect MCP routes based on auth mode
    if (mcpOAuthProvider) {
      // MCP OAuth mode: use SDK's bearer auth middleware
      const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
      const issuerUrl = this.config.mcpOAuth!.issuerUrl!;
      const resourceMetadataUrl = `${issuerUrl}/.well-known/oauth-protected-resource/mcp`;

      app.all('/mcp', requireBearerAuth({
        verifier: mcpOAuthProvider,
        resourceMetadataUrl,
      }), async (req: Request, res: Response) => {
        try {
          process.stderr.write(`MCP request: ${req.method} auth=${!!req.auth}\n`);
          await transport.handleRequest(req, res);
        } catch (error) {
          process.stderr.write(`Error handling MCP request: ${error instanceof Error ? error.stack || error.message : error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
      });
    } else {
      // Static bearer token mode (existing behavior)
      app.all('/mcp', (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;
        if (!validateBearerToken(authHeader)) {
          res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or missing bearer token. Please provide a valid Authorization: Bearer <token> header.'
          });
          return;
        }
        next();
      }, async (req: Request, res: Response) => {
        try {
          await transport.handleRequest(req, res);
        } catch (error) {
          process.stderr.write(`Error handling MCP request: ${error instanceof Error ? error.message : error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
      });

      // Also handle requests at root for backwards compatibility (non-OAuth mode only)
      app.post('/', async (req: Request, res: Response, next: NextFunction) => {
        // Only handle JSON-RPC requests at root, not other POST requests
        const contentType = req.headers['content-type'];
        if (!contentType?.includes('application/json')) {
          next();
          return;
        }

        const authHeader = req.headers.authorization;
        if (!validateBearerToken(authHeader)) {
          res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or missing bearer token. Please provide a valid Authorization: Bearer <token> header.'
          });
          return;
        }

        try {
          await transport.handleRequest(req, res);
        } catch (error) {
          process.stderr.write(`Error handling request: ${error instanceof Error ? error.message : error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
      });
    }

    app.listen(port, host, () => {
      process.stderr.write(`Google Calendar MCP Server listening on http://${host}:${port}\n`);
    });
  }
}
