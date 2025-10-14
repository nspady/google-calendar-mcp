import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './tokenManager.js';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { loadCredentials } from './client.js';
import { getAccountMode } from './utils.js';

export class AuthServer {
  private baseOAuth2Client: OAuth2Client; // Used by TokenManager for validation/refresh
  private flowOAuth2Client: OAuth2Client | null = null; // Used specifically for the auth code flow
  private server: http.Server | null = null;
  private tokenManager: TokenManager;
  private portRange: { start: number; end: number };
  private activeConnections: Set<import('net').Socket> = new Set(); // Track active socket connections
  public authCompletedSuccessfully = false; // Flag for standalone script

  constructor(oauth2Client: OAuth2Client) {
    this.baseOAuth2Client = oauth2Client;
    this.tokenManager = new TokenManager(oauth2Client);
    this.portRange = { start: 3500, end: 3505 };
  }

  private createServer(): http.Server {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      
      if (url.pathname === '/') {
        // Root route - show auth link
        const clientForUrl = this.flowOAuth2Client || this.baseOAuth2Client;
        const scopes = ['https://www.googleapis.com/auth/calendar'];
        const authUrl = clientForUrl.generateAuthUrl({
          access_type: 'offline',
          scope: scopes,
          prompt: 'consent'
        });
        
        const accountMode = getAccountMode();
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h1>Google Calendar Authentication</h1>
          <p><strong>Account Mode:</strong> <code>${accountMode}</code></p>
          <p>You are authenticating for the <strong>${accountMode}</strong> account.</p>
          <a href="${authUrl}">Authenticate with Google</a>
        `);
        
      } else if (url.pathname === '/oauth2callback') {
        // OAuth callback route
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Authorization code missing');
          return;
        }
        
        if (!this.flowOAuth2Client) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Authentication flow not properly initiated.');
          return;
        }
        
        try {
          const { tokens } = await this.flowOAuth2Client.getToken(code);
          await this.tokenManager.saveTokens(tokens);
          this.authCompletedSuccessfully = true;

          const tokenPath = this.tokenManager.getTokenPath();
          const accountMode = this.tokenManager.getAccountMode();
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Authentication Successful</title>
                <style>
                    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4; margin: 0; }
                    .container { text-align: center; padding: 2em; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    h1 { color: #4CAF50; }
                    p { color: #333; margin-bottom: 0.5em; }
                    code { background-color: #eee; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
                    .account-mode { background-color: #e3f2fd; padding: 1em; border-radius: 5px; margin: 1em 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Authentication Successful!</h1>
                    <div class="account-mode">
                        <p><strong>Account Mode:</strong> <code>${accountMode}</code></p>
                        <p>Your authentication tokens have been saved for the <strong>${accountMode}</strong> account.</p>
                    </div>
                    <p>Tokens saved to:</p>
                    <p><code>${tokenPath}</code></p>
                    <p>You can now close this browser window.</p>
                </div>
            </body>
            </html>
          `);
        } catch (error: unknown) {
          this.authCompletedSuccessfully = false;
          const message = error instanceof Error ? error.message : 'Unknown error';
          process.stderr.write(`✗ Token save failed: ${message}\n`);

          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Authentication Failed</title>
                <style>
                    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4; margin: 0; }
                    .container { text-align: center; padding: 2em; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    h1 { color: #F44336; }
                    p { color: #333; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Authentication Failed</h1>
                    <p>An error occurred during authentication:</p>
                    <p><code>${message}</code></p>
                    <p>Please try again or check the server logs.</p>
                </div>
            </body>
            </html>
          `);
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
      const { client_id, client_secret } = await loadCredentials();
      this.flowOAuth2Client = new OAuth2Client(
        client_id,
        client_secret,
        `http://localhost:${port}/oauth2callback`
      );
    } catch (error) {
        // Could not load credentials, cannot proceed with auth flow
        this.authCompletedSuccessfully = false;
        await this.stop(); // Stop the server we just started
        return false;
    }

    // Generate Auth URL using the newly created flow client
    const authorizeUrl = this.flowOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent'
    });
    
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
} 