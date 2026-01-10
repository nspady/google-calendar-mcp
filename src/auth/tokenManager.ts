import { OAuth2Client, Credentials } from 'google-auth-library';
import fs from 'fs/promises';
import { getSecureTokenPath, getAccountMode, getLegacyTokenPath } from './utils.js';
import { GaxiosError } from 'gaxios';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

// Cached calendar info
interface CachedCalendar {
  id: string;
  summary: string;
  summaryOverride?: string;
  accessRole: string;
  primary: boolean;
  backgroundColor?: string;
}

// Extended credentials with cached email and calendars
interface CachedCredentials extends Credentials {
  cached_email?: string;
  cached_calendars?: CachedCalendar[];
  calendars_cached_at?: number;
}

// Interface for multi-account token storage
// Now supports arbitrary account IDs
interface MultiAccountTokens {
  [accountId: string]: CachedCredentials;
}

export class TokenManager {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;
  private accountMode: string;
  private accounts: Map<string, OAuth2Client> = new Map();
  private credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
    this.tokenPath = getSecureTokenPath();
    this.accountMode = getAccountMode();

    // Store credentials to avoid accessing private properties later
    this.credentials = {
      clientId: (oauth2Client as any)._clientId,
      clientSecret: (oauth2Client as any)._clientSecret,
      redirectUri: (oauth2Client as any)._redirectUri
    };

    this.setupTokenRefresh();
  }

  // Method to expose the token path
  public getTokenPath(): string {
    return this.tokenPath;
  }

  // Method to get current account mode
  public getAccountMode(): string {
    return this.accountMode;
  }

  // Method to switch account mode (supports arbitrary account IDs)
  public setAccountMode(mode: string): void {
    this.accountMode = mode;
  }

  private async ensureTokenDirectoryExists(): Promise<void> {
    try {
      await mkdir(dirname(this.tokenPath), { recursive: true });
    } catch (error) {
      process.stderr.write(`Failed to create token directory: ${error}\n`);
    }
  }

  private isFileNotFoundError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && (error as any).code === 'ENOENT';
  }

  private async writeTokenFile(tokens: MultiAccountTokens): Promise<void> {
    await this.ensureTokenDirectoryExists();
    await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  private async loadMultiAccountTokens(): Promise<MultiAccountTokens> {
    try {
      const fileContent = await fs.readFile(this.tokenPath, "utf-8");
      const parsed = JSON.parse(fileContent);

      // Check if this is the old single-account format
      if (parsed.access_token || parsed.refresh_token) {
        // Convert old format to new multi-account format
        const multiAccountTokens: MultiAccountTokens = {
          normal: parsed
        };
        await this.saveMultiAccountTokens(multiAccountTokens);
        return multiAccountTokens;
      }

      // Already in multi-account format
      return parsed as MultiAccountTokens;
    } catch (error: unknown) {
      if (this.isFileNotFoundError(error)) {
        return {};
      }
      throw error;
    }
  }

  /**
   * Raw token file read without migration logic.
   * Used for atomic read-modify-write operations where we need to re-read current state.
   */
  private async loadMultiAccountTokensRaw(): Promise<MultiAccountTokens> {
    try {
      const fileContent = await fs.readFile(this.tokenPath, "utf-8");
      return JSON.parse(fileContent) as MultiAccountTokens;
    } catch (error: unknown) {
      if (this.isFileNotFoundError(error)) {
        return {};
      }
      throw error;
    }
  }

  private async saveMultiAccountTokens(multiAccountTokens: MultiAccountTokens): Promise<void> {
    return this.enqueueTokenWrite(async () => {
      await this.writeTokenFile(multiAccountTokens);
    });
  }

  private enqueueTokenWrite(operation: () => Promise<void>): Promise<void> {
    const pendingWrite = this.writeQueue
      .catch(() => undefined)
      .then(operation);

    this.writeQueue = pendingWrite
      .catch(error => {
        process.stderr.write(`Error writing token file: ${error instanceof Error ? error.message : error}\n`);
        throw error;
      })
      .catch(() => undefined);

    return pendingWrite;
  }

  private setupTokenRefresh(): void {
    this.setupTokenRefreshForAccount(this.oauth2Client, this.accountMode);
  }

  /**
   * Set up token refresh handler for a specific account
   * Uses enqueueTokenWrite to prevent race conditions when multiple accounts refresh simultaneously
   */
  private setupTokenRefreshForAccount(client: OAuth2Client, accountId: string): void {
    client.on("tokens", async (newTokens) => {
      try {
        // Wrap entire read-modify-write in the queue to prevent race conditions
        await this.enqueueTokenWrite(async () => {
          const multiAccountTokens = await this.loadMultiAccountTokens();
          const currentTokens = multiAccountTokens[accountId] || {};

          const updatedTokens = {
            ...currentTokens,
            ...newTokens,
            refresh_token: newTokens.refresh_token || currentTokens.refresh_token,
          };

          multiAccountTokens[accountId] = updatedTokens;
          await this.writeTokenFile(multiAccountTokens);
        });

        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`Tokens updated and saved for ${accountId} account\n`);
        }
      } catch (error: unknown) {
        process.stderr.write("Error saving updated tokens: ");
        if (error instanceof Error) {
          process.stderr.write(error.message);
        } else if (typeof error === 'string') {
          process.stderr.write(error);
        }
        process.stderr.write("\n");
      }
    });
  }

  private async migrateLegacyTokens(): Promise<boolean> {
    const legacyPath = getLegacyTokenPath();
    try {
      // Check if legacy tokens exist
      if (!(await fs.access(legacyPath).then(() => true).catch(() => false))) {
        return false; // No legacy tokens to migrate
      }

      // Read legacy tokens
      const legacyTokens = JSON.parse(await fs.readFile(legacyPath, "utf-8"));
      
      if (!legacyTokens || typeof legacyTokens !== "object") {
        process.stderr.write("Invalid legacy token format, skipping migration\n");
        return false;
      }

      // Copy to new location (ensures directory exists)
      await this.writeTokenFile(legacyTokens);
      
      process.stderr.write(`Migrated tokens from legacy location: ${legacyPath} to: ${this.tokenPath}\n`);
      
      // Optionally remove legacy file after successful migration
      try {
        await fs.unlink(legacyPath);
        process.stderr.write("Removed legacy token file\n");
      } catch (unlinkErr) {
        process.stderr.write(`Warning: Could not remove legacy token file: ${unlinkErr}\n`);
      }
      
      return true;
    } catch (error) {
      process.stderr.write(`Error migrating legacy tokens: ${error}\n`);
      return false;
    }
  }

  async loadSavedTokens(): Promise<boolean> {
    try {
      await this.ensureTokenDirectoryExists();
      
      // Check if current token file exists
      const tokenExists = await fs.access(this.tokenPath).then(() => true).catch(() => false);
      
      // If no current tokens, try to migrate from legacy location
      if (!tokenExists) {
        const migrated = await this.migrateLegacyTokens();
        if (!migrated) {
          process.stderr.write(`No token file found at: ${this.tokenPath}\n`);
          return false;
        }
      }

      const multiAccountTokens = await this.loadMultiAccountTokens();
      const tokens = multiAccountTokens[this.accountMode];

      if (!tokens || typeof tokens !== "object") {
        process.stderr.write(`No tokens found for ${this.accountMode} account in file: ${this.tokenPath}\n`);
        return false;
      }

      this.oauth2Client.setCredentials(tokens);
      process.stderr.write(`Loaded tokens for ${this.accountMode} account\n`);
      return true;
    } catch (error: unknown) {
      process.stderr.write(`Error loading tokens for ${this.accountMode} account: `);
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') { 
          try { 
              await fs.unlink(this.tokenPath); 
              process.stderr.write("Removed potentially corrupted token file\n"); 
            } catch (unlinkErr) { /* ignore */ } 
      }
      return false;
    }
  }

  async refreshTokensIfNeeded(): Promise<boolean> {
    const expiryDate = this.oauth2Client.credentials.expiry_date;
    const isExpired = expiryDate
      ? Date.now() >= expiryDate - 5 * 60 * 1000 // 5 minute buffer
      : !this.oauth2Client.credentials.access_token; // No token means we need one

    if (isExpired && this.oauth2Client.credentials.refresh_token) {
      if (process.env.NODE_ENV !== 'test') {
        process.stderr.write(`Auth token expired or nearing expiry for ${this.accountMode} account, refreshing...\n`);
      }
      try {
        const response = await this.oauth2Client.refreshAccessToken();
        const newTokens = response.credentials;

        if (!newTokens.access_token) {
          throw new Error("Received invalid tokens during refresh");
        }
        // The 'tokens' event listener should handle saving
        this.oauth2Client.setCredentials(newTokens);
        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`Token refreshed successfully for ${this.accountMode} account\n`);
        }
        return true;
      } catch (refreshError) {
        if (refreshError instanceof GaxiosError && refreshError.response?.data?.error === 'invalid_grant') {
            process.stderr.write(`Error refreshing auth token for ${this.accountMode} account: Invalid grant. Token likely expired or revoked. Please re-authenticate.\n`);
            return false; // Indicate failure due to invalid grant
        } else {
            // Handle other refresh errors
            process.stderr.write(`Error refreshing auth token for ${this.accountMode} account: `);
            if (refreshError instanceof Error) {
              process.stderr.write(refreshError.message);
            } else if (typeof refreshError === 'string') {
              process.stderr.write(refreshError);
            }
            process.stderr.write("\n");
            return false;
        }
      }
    } else if (!this.oauth2Client.credentials.access_token && !this.oauth2Client.credentials.refresh_token) {
        process.stderr.write(`No access or refresh token available for ${this.accountMode} account. Please re-authenticate.\n`);
        return false;
    } else {
        // Token is valid or no refresh token available
        return true;
    }
  }

  async validateTokens(accountMode?: string): Promise<boolean> {
    // For unit tests that don't need real authentication, they should mock at the handler level
    // Integration tests always need real tokens

    const modeToValidate = accountMode || this.accountMode;
    const currentMode = this.accountMode;
    
    try {
      // Temporarily switch to the mode we want to validate if different
      if (modeToValidate !== currentMode) {
        this.accountMode = modeToValidate;
      }
      
      if (!this.oauth2Client.credentials || !this.oauth2Client.credentials.access_token) {
          // Try loading first if no credentials set
          if (!(await this.loadSavedTokens())) {
              return false; // No saved tokens to load
          }
          // Check again after loading
          if (!this.oauth2Client.credentials || !this.oauth2Client.credentials.access_token) {
              return false; // Still no token after loading
          }
      }
      
      const result = await this.refreshTokensIfNeeded();
      return result;
    } finally {
      // Always restore the original account mode
      if (modeToValidate !== currentMode) {
        this.accountMode = currentMode;
      }
    }
  }

  async saveTokens(tokens: Credentials, email?: string): Promise<void> {
    try {
        // Wrap entire read-modify-write in the queue to prevent race conditions
        await this.enqueueTokenWrite(async () => {
          const multiAccountTokens = await this.loadMultiAccountTokens();
          const cachedTokens: CachedCredentials = { ...tokens };

          // Cache the email if provided
          if (email) {
            cachedTokens.cached_email = email;
          }

          multiAccountTokens[this.accountMode] = cachedTokens;
          await this.writeTokenFile(multiAccountTokens);
        });
        this.oauth2Client.setCredentials(tokens);
        process.stderr.write(`Tokens saved successfully for ${this.accountMode} account to: ${this.tokenPath}\n`);
    } catch (error: unknown) {
        process.stderr.write(`Error saving tokens for ${this.accountMode} account: ${error}\n`);
        throw error;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      this.oauth2Client.setCredentials({}); // Clear in memory

      // Wrap entire read-modify-write in the queue to prevent race conditions
      await this.enqueueTokenWrite(async () => {
        const multiAccountTokens = await this.loadMultiAccountTokens();
        delete multiAccountTokens[this.accountMode];

        // If no accounts left, delete the entire file
        if (Object.keys(multiAccountTokens).length === 0) {
          await fs.unlink(this.tokenPath);
          process.stderr.write(`All tokens cleared, file deleted\n`);
        } else {
          await this.writeTokenFile(multiAccountTokens);
          process.stderr.write(`Tokens cleared for ${this.accountMode} account\n`);
        }
      });
    } catch (error: unknown) {
      if (this.isFileNotFoundError(error)) {
        // File already gone, which is fine
        process.stderr.write("Token file already deleted\n");
      } else {
        process.stderr.write(`Error clearing tokens for ${this.accountMode} account: ${error}\n`);
        // Don't re-throw, clearing is best-effort
      }
    }
  }

  // Method to list available accounts
  async listAvailableAccounts(): Promise<string[]> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();
      return Object.keys(multiAccountTokens);
    } catch (error) {
      return [];
    }
  }

  /**
   * Remove a specific account's tokens from storage.
   * @param accountId - The account ID to remove
   * @throws Error if account doesn't exist or removal fails
   */
  async removeAccount(accountId: string): Promise<void> {
    const normalizedId = accountId.toLowerCase();

    await this.enqueueTokenWrite(async () => {
      const multiAccountTokens = await this.loadMultiAccountTokens();

      if (!multiAccountTokens[normalizedId]) {
        throw new Error(`Account "${normalizedId}" not found`);
      }

      delete multiAccountTokens[normalizedId];

      // If no accounts left, delete the entire file
      if (Object.keys(multiAccountTokens).length === 0) {
        await fs.unlink(this.tokenPath);
        process.stderr.write(`All tokens cleared, file deleted\n`);
      } else {
        await this.writeTokenFile(multiAccountTokens);
        process.stderr.write(`Account "${normalizedId}" removed successfully\n`);
      }

      // Remove from in-memory accounts map if present
      this.accounts.delete(normalizedId);
    });
  }

  // Method to switch to a different account (supports arbitrary account IDs)
  async switchAccount(newMode: string): Promise<boolean> {
    this.accountMode = newMode;
    return this.loadSavedTokens();
  }

  /**
   * Load all authenticated accounts from token file
   * Returns a Map of account ID to OAuth2Client
   *
   * Reuses existing OAuth2Client instances to prevent memory leaks
   * Sets up token refresh handlers for new accounts
   */
  async loadAllAccounts(): Promise<Map<string, OAuth2Client>> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();

      // Remove accounts that no longer exist in token file
      for (const accountId of this.accounts.keys()) {
        if (!multiAccountTokens[accountId]) {
          const client = this.accounts.get(accountId);
          if (client) {
            // Clean up event listeners before removing
            client.removeAllListeners('tokens');
          }
          this.accounts.delete(accountId);
        }
      }

      // Add or update accounts
      for (const [accountId, tokens] of Object.entries(multiAccountTokens)) {
        // Validate account ID
        try {
          const { validateAccountId } = await import('./paths.js') as any;
          validateAccountId(accountId);

          // Skip invalid token entries
          if (!tokens || typeof tokens !== 'object' || !tokens.access_token) {
            continue;
          }

          // Check if we already have a client for this account (reuse it to prevent memory leak)
          let client = this.accounts.get(accountId);

          if (!client) {
            // Create a new OAuth2Client for this account using stored credentials
            client = new OAuth2Client(
              this.credentials.clientId,
              this.credentials.clientSecret,
              this.credentials.redirectUri
            );

            // Set up token refresh handler for this new client
            this.setupTokenRefreshForAccount(client, accountId);

            this.accounts.set(accountId, client);
          }

          // Update credentials (for both new and existing clients)
          client.setCredentials(tokens);

        } catch (error) {
          // Skip invalid account IDs
          if (process.env.NODE_ENV !== 'test') {
            process.stderr.write(`Skipping invalid account "${accountId}": ${error}\n`);
          }
          continue;
        }
      }

      return this.accounts;
    } catch (error: any) {
      // Check for file not found error (works with both Error objects and plain objects)
      if (error && error.code === 'ENOENT') {
        // No token file exists, return empty map
        return new Map();
      }
      throw error;
    }
  }

  /**
   * Get OAuth2Client for a specific account
   * @param accountId The account ID to retrieve
   * @throws Error if account not found or invalid
   */
  getClient(accountId: string): OAuth2Client {
    // Validate account ID first
    const { validateAccountId } = require('./paths.js');
    validateAccountId(accountId);

    const client = this.accounts.get(accountId);
    if (!client) {
      throw new Error(`Account "${accountId}" not found. Please authenticate this account first.`);
    }

    return client;
  }

  /**
   * List all authenticated accounts with their email addresses, status, and calendars
   * Uses cached data when available to avoid repeated API calls
   */
  async listAccounts(): Promise<Array<{
    id: string;
    email: string;
    status: string;
    calendars: CachedCalendar[];
  }>> {
    try {
      const multiAccountTokens = await this.loadMultiAccountTokens();
      const accountList: Array<{
        id: string;
        email: string;
        status: string;
        calendars: CachedCalendar[];
      }> = [];
      let tokensUpdated = false;

      // Cache TTL: 5 minutes for calendars
      const CALENDAR_CACHE_TTL = 5 * 60 * 1000;

      for (const [accountId, tokens] of Object.entries(multiAccountTokens)) {
        // Skip invalid entries
        if (!tokens || typeof tokens !== 'object') {
          continue;
        }

        let client: OAuth2Client | null = null;

        // Create client and refresh if needed
        if (tokens.access_token || tokens.refresh_token) {
          try {
            client = new OAuth2Client(
              this.credentials.clientId,
              this.credentials.clientSecret,
              this.credentials.redirectUri
            );
            client.setCredentials(tokens);

            // Try to refresh token if access token is expired or missing
            if (tokens.refresh_token && (!tokens.access_token || (tokens.expiry_date && tokens.expiry_date < Date.now()))) {
              try {
                const response = await client.refreshAccessToken();
                client.setCredentials(response.credentials);
                Object.assign(tokens, response.credentials);
                tokensUpdated = true;
              } catch {
                // Refresh failed
              }
            }
          } catch {
            client = null;
          }
        }

        // Get email address - use cached value if available
        let email = tokens.cached_email || 'unknown';
        if (!tokens.cached_email && client) {
          try {
            email = await this.getUserEmail(client);
            if (email !== 'unknown') {
              tokens.cached_email = email;
              tokensUpdated = true;
            }
          } catch {
            // Email retrieval failed
          }
        }

        // Get calendars - use cached if fresh, otherwise fetch
        let calendars: CachedCalendar[] = tokens.cached_calendars || [];
        const cacheExpired = !tokens.calendars_cached_at ||
          (Date.now() - tokens.calendars_cached_at) > CALENDAR_CACHE_TTL;

        if (cacheExpired && client) {
          try {
            calendars = await this.fetchCalendarsForClient(client);
            tokens.cached_calendars = calendars;
            tokens.calendars_cached_at = Date.now();
            tokensUpdated = true;
          } catch {
            // Calendar fetch failed, use cached or empty
          }
        }

        // Determine status
        let status = 'active';
        if (!tokens.refresh_token) {
          if (!tokens.access_token || (tokens.expiry_date && tokens.expiry_date < Date.now())) {
            status = 'expired';
          }
        }

        accountList.push({ id: accountId, email, status, calendars });
      }

      // Save updated tokens with cached data using atomic read-modify-write
      // This prevents race conditions when multiple listAccounts() calls run concurrently
      if (tokensUpdated) {
        await this.enqueueTokenWrite(async () => {
          // Re-read current token state to preserve any concurrent auth changes
          const latestTokens = await this.loadMultiAccountTokensRaw();

          // Merge our cached metadata updates into the latest token state
          for (const accountId of Object.keys(multiAccountTokens)) {
            const localUpdates = multiAccountTokens[accountId];
            const latestAccount = latestTokens[accountId];

            if (latestAccount && localUpdates) {
              // Only update cached metadata, not auth tokens
              if (localUpdates.cached_email) {
                latestAccount.cached_email = localUpdates.cached_email;
              }
              if (localUpdates.cached_calendars) {
                latestAccount.cached_calendars = localUpdates.cached_calendars;
                latestAccount.calendars_cached_at = localUpdates.calendars_cached_at;
              }
            }
          }

          await this.writeTokenFile(latestTokens);
        });
      }

      return accountList;
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetch calendars for a specific OAuth2Client
   */
  private async fetchCalendarsForClient(client: OAuth2Client): Promise<CachedCalendar[]> {
    const { google } = await import('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.calendarList.list();
    const items = response.data.items || [];

    const calendars: CachedCalendar[] = items.map(cal => ({
      id: cal.id || '',
      summary: cal.summary || '',
      summaryOverride: cal.summaryOverride || undefined,
      accessRole: cal.accessRole || 'reader',
      primary: cal.primary || false,
      backgroundColor: cal.backgroundColor || undefined
    }));

    // Sort: primary first, then by name
    calendars.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return (a.summaryOverride || a.summary).localeCompare(b.summaryOverride || b.summary);
    });

    return calendars;
  }

  /**
   * Get user email address from OAuth2Client
   * First tries getTokenInfo, then falls back to primary calendar ID
   */
  private async getUserEmail(client: OAuth2Client): Promise<string> {
    try {
      // Try getTokenInfo first (only works if token has email/openid scope)
      const tokenInfo = await client.getTokenInfo(client.credentials.access_token || '');
      if (tokenInfo.email) {
        return tokenInfo.email;
      }
    } catch {
      // Token info failed, try calendar fallback
    }

    // Fallback: Get primary calendar ID (usually the user's email)
    try {
      const { google } = await import('googleapis');
      const calendar = google.calendar({ version: 'v3', auth: client });
      const response = await calendar.calendars.get({ calendarId: 'primary' });
      const primaryId = response.data.id;
      // Primary calendar ID is typically the user's email
      if (primaryId && primaryId.includes('@')) {
        return primaryId;
      }
    } catch {
      // Calendar fallback also failed
    }

    return 'unknown';
  }
} 
