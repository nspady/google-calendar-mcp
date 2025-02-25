import { OAuth2Client, Credentials } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';

export class TokenManager {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;
  private refreshTimer: NodeJS.Timeout | null = null;
  private maxRetries = 5;
  private refreshThreshold = 0.8; // Refresh at 80% of token lifetime

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
    this.tokenPath = this.getSecureTokenPath();
    this.setupTokenRefresh();
  }

  private getSecureTokenPath(): string {
    return path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../.gcp-saved-tokens.json'
    );
  }

  private calculateJitter(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    const maxJitter = 1000; // 1 second
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    const jitter = Math.random() * maxJitter;
    return exponentialDelay + jitter;
  }

  private async setupTokenRefresh(): Promise<void> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.expiry_date) return;

    const now = Date.now();
    const timeUntilExpiry = credentials.expiry_date - now;
    const refreshTime = timeUntilExpiry * (1 - this.refreshThreshold);

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(
      () => this.refreshToken(),
      Math.max(0, refreshTime)
    );
  }

  private async refreshToken(retryCount = 0): Promise<void> {
    try {
      const response = await this.oauth2Client.refreshAccessToken();
      const newTokens = response.credentials;

      if (!newTokens.access_token) {
        throw new Error('Received invalid tokens during refresh');
      }

      await this.saveTokens(newTokens);
      this.setupTokenRefresh();
    } catch (error) {
      console.error(`Token refresh attempt ${retryCount + 1} failed:`, error);

      if (retryCount < this.maxRetries) {
        const delay = this.calculateJitter(retryCount);
        setTimeout(() => this.refreshToken(retryCount + 1), delay);
      } else {
        console.error('Token refresh failed after maximum retries');
      }
    }
  }

  public async loadSavedTokens(): Promise<boolean> {
    try {
      const tokens = JSON.parse(await fs.readFile(this.tokenPath, 'utf-8'));
      
      if (!tokens || typeof tokens !== 'object') {
        console.error('Invalid token format');
        return false;
      }

      this.oauth2Client.setCredentials(tokens);
      this.setupTokenRefresh();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading tokens:', error);
      }
      return false;
    }
  }

  public async saveTokens(tokens: Credentials): Promise<void> {
    try {
      await fs.writeFile(
        this.tokenPath,
        JSON.stringify(tokens, null, 2),
        { mode: 0o600 }
      );
      this.oauth2Client.setCredentials(tokens);
      this.setupTokenRefresh();
    } catch (error) {
      console.error('Error saving tokens:', error);
      throw error;
    }
  }

  public async validateTokens(): Promise<boolean> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.access_token) return false;

    if (credentials.expiry_date) {
      const now = Date.now();
      if (now >= credentials.expiry_date) {
        try {
          await this.refreshToken();
          return true;
        } catch {
          return false;
        }
      }
    }

    return true;
  }

  public clearTokens(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
} 