import * as fs from 'fs/promises';
import * as path from 'path';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './token-manager.js';
import open from 'open';

export class AuthServer {
  private server: express.Application | null = null;
  private httpServer: any = null;
  private tokenManager: TokenManager;
  private port: number;
  private credentials: { client_id: string; client_secret: string } | null = null;

  constructor(private oauth2Client: OAuth2Client) {
    this.tokenManager = new TokenManager(oauth2Client);
    this.port = 3000; // Start with default port
  }

  private getKeysFilePath(): string {
    return path.join(process.cwd(), 'gcp-oauth.keys.json');
  }

  private async loadCredentials(): Promise<void> {
    const content = await fs.readFile(this.getKeysFilePath(), 'utf-8');
    const keys = JSON.parse(content);
    this.credentials = {
      client_id: keys.installed.client_id,
      client_secret: keys.installed.client_secret
    };
  }

  private createOAuthClient(port: number): OAuth2Client {
    if (!this.credentials) {
      throw new Error('Credentials not loaded');
    }
    return new OAuth2Client(
      this.credentials.client_id,
      this.credentials.client_secret,
      `http://localhost:${port}/oauth2callback`
    );
  }

  private async startServer(): Promise<boolean> {
    // Try ports 3000 and 3001
    const ports = [3000, 3001];
    
    for (const port of ports) {
      this.port = port;
      try {
        // Create a new OAuth client with the current port
        this.oauth2Client = this.createOAuthClient(port);
        
        this.server = express();
        
        // Handle OAuth callback
        this.server.get('/oauth2callback', async (req, res) => {
          try {
            const code = req.query.code as string;
            if (!code) {
              throw new Error('No code received');
            }

            const { tokens } = await this.oauth2Client.getToken(code);
            await this.tokenManager.saveTokens(tokens);
            
            res.send('Authentication successful! You can close this window.');
            await this.stop();
            return true;
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error('Error in OAuth callback:', errorMessage);
            res.status(500).send('Authentication failed. Please try again.');
            await this.stop();
            return false;
          }
        });

        // Try to start the server
        const serverStarted = await new Promise<boolean>((resolve) => {
          if (!this.server) {
            resolve(false);
            return;
          }

          this.httpServer = this.server.listen(port, () => {
            console.log(`Auth server listening on port ${port}`);
            resolve(true);
          });

          this.httpServer.on('error', (error: any) => {
            if (error.code === 'EADDRINUSE') {
              console.log(`Port ${port} is in use, trying next port...`);
              resolve(false);
            } else {
              console.error('Server error:', error);
              resolve(false);
            }
          });
        });

        if (serverStarted) {
          return true;
        }
      } catch (error) {
        console.error(`Error starting server on port ${port}:`, error);
      }
    }

    console.error('Failed to start server on any available port');
    return false;
  }

  public async start(): Promise<boolean> {
    console.log('Starting auth server...');
    
    try {
      const tokens = await this.tokenManager.loadSavedTokens();
      if (tokens) {
        console.log('Valid tokens found, no need to start auth server');
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.log('No valid tokens found:', errorMessage);
    }

    try {
      await this.loadCredentials();
      
      const serverStarted = await this.startServer();
      if (!serverStarted) {
        console.error('Failed to start auth server');
        return false;
      }

      const redirectUri = `http://localhost:${this.port}/oauth2callback`;
      console.log('Using redirect URI:', redirectUri);

      const authorizeUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar']
      });

      console.log(`Opening browser for authentication on port ${this.port}...`);
      await open(authorizeUrl);
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Authentication failed:', errorMessage);
      await this.stop();
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer.close(() => {
          console.log('Auth server stopped');
          this.server = null;
          this.httpServer = null;
          resolve();
        });
      });
    }
  }
}

// For backwards compatibility with npm run auth
if (import.meta.url === new URL(import.meta.resolve('./auth-server.js')).href) {
  const oauth2Client = new OAuth2Client();
  const authServer = new AuthServer(oauth2Client);
  authServer.start().catch(console.error);
}