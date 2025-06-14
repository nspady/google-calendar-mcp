import { OAuth2Client, Credentials } from 'google-auth-library';
import fs from 'fs/promises';
import { getSecureTokenPath, getAccountMode, getLegacyTokenPath } from './utils.js';
import { GaxiosError } from 'gaxios';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

// Interface for multi-account token storage
interface MultiAccountTokens {
  normal?: Credentials;
  test?: Credentials;
}

export class TokenManager {
  private oauth2Client: OAuth2Client;
  private tokenPath: string;
  private accountMode: 'normal' | 'test';

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
    this.tokenPath = getSecureTokenPath();
    this.accountMode = getAccountMode();
    this.setupTokenRefresh();
  }

  // Method to expose the token path
  public getTokenPath(): string {
    return this.tokenPath;
  }

  // Method to get current account mode
  public getAccountMode(): 'normal' | 'test' {
    return this.accountMode;
  }

  // Method to switch account mode (useful for testing)
  public setAccountMode(mode: 'normal' | 'test'): void {
    this.accountMode = mode;
  }

  private async ensureTokenDirectoryExists(): Promise<void> {
    try {
      await mkdir(dirname(this.tokenPath), { recursive: true });
    } catch (error) {
      process.stderr.write(`Failed to create token directory: ${error}\n`);
    }
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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist, return empty structure
        return {};
      }
      throw error;
    }
  }

  private async saveMultiAccountTokens(multiAccountTokens: MultiAccountTokens): Promise<void> {
    await this.ensureTokenDirectoryExists();
    await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
      mode: 0o600,
    });
  }

  private setupTokenRefresh(): void {
    this.oauth2Client.on("tokens", async (newTokens) => {
      try {
        const multiAccountTokens = await this.loadMultiAccountTokens();
        const currentTokens = multiAccountTokens[this.accountMode] || {};
        
        const updatedTokens = {
          ...currentTokens,
          ...newTokens,
          refresh_token: newTokens.refresh_token || currentTokens.refresh_token,
        };
        
        multiAccountTokens[this.accountMode] = updatedTokens;
        await this.saveMultiAccountTokens(multiAccountTokens);
        
        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`Tokens updated and saved for ${this.accountMode} account\n`);
        }
      } catch (error: unknown) {
        // Handle case where file might not exist yet
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { 
          try {
            const multiAccountTokens: MultiAccountTokens = {
              [this.accountMode]: newTokens
            };
            await this.saveMultiAccountTokens(multiAccountTokens);
            if (process.env.NODE_ENV !== 'test') {
              process.stderr.write(`New tokens saved for ${this.accountMode} account\n`);
            }
          } catch (writeError) {
            process.stderr.write("Error saving initial tokens: ");
            if (writeError) {
              process.stderr.write(writeError.toString());
            }
            process.stderr.write("\n");
          }
        } else {
          process.stderr.write("Error saving updated tokens: ");
          if (error instanceof Error) {
            process.stderr.write(error.message);
          } else if (typeof error === 'string') {
            process.stderr.write(error);
          }
          process.stderr.write("\n");
        }
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

      // Ensure new token directory exists
      await this.ensureTokenDirectoryExists();
      
      // Copy to new location
      await fs.writeFile(this.tokenPath, JSON.stringify(legacyTokens, null, 2), {
        mode: 0o600,
      });
      
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

  async validateTokens(accountMode?: 'normal' | 'test'): Promise<boolean> {
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

  async saveTokens(tokens: Credentials): Promise<void> {
    try {
        const multiAccountTokens = await this.loadMultiAccountTokens();
        multiAccountTokens[this.accountMode] = tokens;
        
        await this.saveMultiAccountTokens(multiAccountTokens);
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
      
      const multiAccountTokens = await this.loadMultiAccountTokens();
      delete multiAccountTokens[this.accountMode];
      
      // If no accounts left, delete the entire file
      if (Object.keys(multiAccountTokens).length === 0) {
        await fs.unlink(this.tokenPath);
        process.stderr.write(`All tokens cleared, file deleted\n`);
      } else {
        await this.saveMultiAccountTokens(multiAccountTokens);
        process.stderr.write(`Tokens cleared for ${this.accountMode} account\n`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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

  // Method to switch to a different account (useful for runtime switching)
  async switchAccount(newMode: 'normal' | 'test'): Promise<boolean> {
    this.accountMode = newMode;
    return this.loadSavedTokens();
  }
} 