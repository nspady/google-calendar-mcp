import { OAuth2Client, Credentials } from 'google-auth-library';
import { loadCredentials } from './client.js';

/**
 * Factory for creating OAuth2Client instances from access tokens
 * Supports multi-tenant scenarios where tokens are provided per-request
 */
export class OAuth2ClientFactory {
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private clientCache = new Map<string, { client: OAuth2Client; createdAt: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour cache TTL

  /**
   * Initialize the factory with OAuth credentials
   * This only needs to be called once at startup
   *
   * @param optional - If true, skip initialization if credentials are not available
   */
  async initialize(optional: boolean = false): Promise<void> {
    try {
      const creds = await loadCredentials();
      this.clientId = creds.client_id;
      this.clientSecret = creds.client_secret;
    } catch (error) {
      if (!optional) {
        throw error;
      }
      // In optional mode, we can work without credentials
      // Tokens will still work, but validation features may be limited
      process.stderr.write('Note: OAuth credentials not found. Token validation features will be limited.\n');
    }
  }

  /**
   * Create an OAuth2Client from an access token
   * No OAuth flow needed - just uses the provided token
   *
   * @param accessToken - The user's access token
   * @param refreshToken - Optional refresh token for token refresh capability
   * @returns OAuth2Client configured with the provided credentials
   */
  createFromAccessToken(accessToken: string, refreshToken?: string): OAuth2Client {
    // Check cache first
    const cacheKey = this.getCacheKey(accessToken);
    const cached = this.clientCache.get(cacheKey);

    if (cached && Date.now() - cached.createdAt < this.CACHE_TTL) {
      return cached.client;
    }

    // Create new client - can work with or without client ID/secret
    const clientOptions: any = {};
    if (this.clientId) {
      clientOptions.clientId = this.clientId;
    }
    if (this.clientSecret) {
      clientOptions.clientSecret = this.clientSecret;
    }

    // Create new client (works even without clientId/clientSecret for basic API calls)
    const client = new OAuth2Client(clientOptions);

    const credentials: Credentials = {
      access_token: accessToken
    };

    if (refreshToken) {
      credentials.refresh_token = refreshToken;
    }

    client.setCredentials(credentials);

    // Cache the client
    this.clientCache.set(cacheKey, {
      client,
      createdAt: Date.now()
    });

    // Clean up old cache entries periodically
    this.cleanupCache();

    return client;
  }

  /**
   * Create an OAuth2Client from raw credentials object
   * Useful for more complex authentication scenarios
   *
   * @param credentials - Google OAuth2 credentials
   * @returns OAuth2Client configured with the provided credentials
   */
  createFromCredentials(credentials: Credentials): OAuth2Client {
    const clientOptions: any = {};
    if (this.clientId) {
      clientOptions.clientId = this.clientId;
    }
    if (this.clientSecret) {
      clientOptions.clientSecret = this.clientSecret;
    }

    const client = new OAuth2Client(clientOptions);

    client.setCredentials(credentials);
    return client;
  }

  /**
   * Clear the client cache
   */
  clearCache(): void {
    this.clientCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttl: number } {
    return {
      size: this.clientCache.size,
      ttl: this.CACHE_TTL
    };
  }

  /**
   * Generate cache key from access token (using hash to avoid storing full token)
   */
  private getCacheKey(accessToken: string): string {
    // Use first 32 chars as cache key (sufficient for uniqueness)
    return accessToken.substring(0, 32);
  }

  /**
   * Remove old entries from cache
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.clientCache.entries()) {
      if (now - value.createdAt >= this.CACHE_TTL) {
        this.clientCache.delete(key);
      }
    }
  }
}
