import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { RequestContextStore, extractRequestContext } from './contextMiddleware.js';

export interface HttpTransportConfig {
  port?: number;
  host?: string;
}

export interface McpRequestContext {
  userToken?: string;
  refreshToken?: string;
}

export class HttpTransportHandler {
  private server: McpServer;
  private config: HttpTransportConfig;

  constructor(server: McpServer, config: HttpTransportConfig = {}) {
    this.server = server;
    this.config = config;
  }

  async connect(): Promise<void> {
    const port = this.config.port || 3000;
    const host = this.config.host || '127.0.0.1';

    // Store reference to server for context injection
    const mcpServer = this.server;

    // Configure transport for stateless mode to allow multiple initialization cycles
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // Stateless mode - allows multiple initializations
    });

    await mcpServer.connect(transport);

    // Create HTTP server to handle the StreamableHTTP transport
    const httpServer = http.createServer(async (req, res) => {
      // Extract authorization token from header for multi-tenant support
      const authHeader = req.headers['authorization'];
      let userToken: string | undefined;
      let refreshToken: string | undefined;

      if (authHeader) {
        if (authHeader.startsWith('Bearer ')) {
          userToken = authHeader.substring(7);
        } else if (authHeader.startsWith('Token ')) {
          userToken = authHeader.substring(6);
        }
      }

      // Also check for refresh token in custom header
      const refreshHeader = req.headers['x-refresh-token'];
      if (refreshHeader && typeof refreshHeader === 'string') {
        refreshToken = refreshHeader;
      }

      // Attach token context to request for later use
      (req as any).mcpContext = {
        userToken,
        refreshToken
      } as McpRequestContext;

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization, X-Refresh-Token');
      
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

      // Handle health check endpoint
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          server: 'google-calendar-mcp',
          version: '1.3.0',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      try {
        // Extract request context and run the handler within the context store
        // This makes the context available to all downstream operations
        const requestContext = extractRequestContext(req);

        await RequestContextStore.run(requestContext, async () => {
          await transport.handleRequest(req, res);
        });
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