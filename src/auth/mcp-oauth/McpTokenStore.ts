import crypto from 'crypto';
import { getMcpStoragePath, loadJsonFile, saveJsonFile, MCP_TOKEN_PREFIX } from './persistence.js';

interface StoredAccessToken {
  token: string;
  clientId: string;
  expiresAt: number; // epoch ms
  scopes: string[];
  refreshToken?: string;
}

interface StoredRefreshToken {
  token: string;
  clientId: string;
  expiresAt: number; // epoch ms
  scopes: string[];
}

interface StoredAuthCode {
  code: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number; // epoch ms
  sessionId: string;
}

interface PersistedTokenData {
  accessTokens: Record<string, StoredAccessToken>;
  refreshTokens: Record<string, StoredRefreshToken>;
  authCodes: Record<string, StoredAuthCode>;
}

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PERSIST_DEBOUNCE_MS = 500; // Debounce disk writes

export class McpTokenStore {
  private accessTokens = new Map<string, StoredAccessToken>();
  private refreshTokens = new Map<string, StoredRefreshToken>();
  private authCodes = new Map<string, StoredAuthCode>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistPath: string;

  constructor() {
    this.persistPath = getMcpStoragePath('mcp-tokens.json');
  }

  async initialize(): Promise<void> {
    await this.loadFromDisk();
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // --- Auth Codes ---

  createAuthCode(clientId: string, codeChallenge: string, redirectUri: string, sessionId: string): string {
    const code = `${MCP_TOKEN_PREFIX.AUTH_CODE}${crypto.randomUUID()}`;
    this.authCodes.set(code, {
      code,
      clientId,
      codeChallenge,
      redirectUri,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      sessionId,
    });
    this.schedulePersist();
    return code;
  }

  getAuthCode(code: string): StoredAuthCode | undefined {
    const stored = this.authCodes.get(code);
    if (!stored) return undefined;
    if (Date.now() > stored.expiresAt) {
      this.authCodes.delete(code);
      return undefined;
    }
    return stored;
  }

  consumeAuthCode(code: string): StoredAuthCode | undefined {
    const stored = this.getAuthCode(code);
    if (stored) {
      this.authCodes.delete(code);
      this.schedulePersist();
    }
    return stored;
  }

  // --- Access Tokens ---

  createAccessToken(clientId: string, scopes: string[], refreshToken?: string): StoredAccessToken {
    const token = `${MCP_TOKEN_PREFIX.ACCESS_TOKEN}${crypto.randomUUID()}`;
    const stored: StoredAccessToken = {
      token,
      clientId,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
      scopes,
      refreshToken,
    };
    this.accessTokens.set(token, stored);
    this.schedulePersist();
    return stored;
  }

  getAccessToken(token: string): StoredAccessToken | undefined {
    const stored = this.accessTokens.get(token);
    if (!stored) return undefined;
    if (Date.now() > stored.expiresAt) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return stored;
  }

  revokeAccessToken(token: string): boolean {
    const deleted = this.accessTokens.delete(token);
    if (deleted) this.schedulePersist();
    return deleted;
  }

  // --- Refresh Tokens ---

  createRefreshToken(clientId: string, scopes: string[]): StoredRefreshToken {
    const token = `${MCP_TOKEN_PREFIX.REFRESH_TOKEN}${crypto.randomUUID()}`;
    const stored: StoredRefreshToken = {
      token,
      clientId,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      scopes,
    };
    this.refreshTokens.set(token, stored);
    this.schedulePersist();
    return stored;
  }

  getRefreshToken(token: string): StoredRefreshToken | undefined {
    const stored = this.refreshTokens.get(token);
    if (!stored) return undefined;
    if (Date.now() > stored.expiresAt) {
      this.refreshTokens.delete(token);
      return undefined;
    }
    return stored;
  }

  revokeRefreshToken(token: string): boolean {
    const deleted = this.refreshTokens.delete(token);
    if (deleted) this.schedulePersist();
    return deleted;
  }

  revokeTokensByRefreshToken(refreshToken: string): void {
    for (const [key, at] of this.accessTokens) {
      if (at.refreshToken === refreshToken) {
        this.accessTokens.delete(key);
      }
    }
    this.refreshTokens.delete(refreshToken);
    this.schedulePersist();
  }

  // --- Cleanup ---

  private cleanupExpired(): void {
    const now = Date.now();
    let changed = false;

    for (const [key, token] of this.accessTokens) {
      if (now > token.expiresAt) {
        this.accessTokens.delete(key);
        changed = true;
      }
    }

    for (const [key, token] of this.refreshTokens) {
      if (now > token.expiresAt) {
        this.refreshTokens.delete(key);
        changed = true;
      }
    }

    for (const [key, code] of this.authCodes) {
      if (now > code.expiresAt) {
        this.authCodes.delete(key);
        changed = true;
      }
    }

    if (changed) this.schedulePersist();
  }

  // --- Persistence ---

  private async loadFromDisk(): Promise<void> {
    try {
      const data = await loadJsonFile<PersistedTokenData>(this.persistPath);
      if (!data) return;

      if (data.accessTokens) {
        for (const [key, val] of Object.entries(data.accessTokens)) {
          this.accessTokens.set(key, val);
        }
      }
      if (data.refreshTokens) {
        for (const [key, val] of Object.entries(data.refreshTokens)) {
          this.refreshTokens.set(key, val);
        }
      }
      if (data.authCodes) {
        for (const [key, val] of Object.entries(data.authCodes)) {
          this.authCodes.set(key, val);
        }
      }

      this.cleanupExpired();
    } catch (error) {
      process.stderr.write(`Warning: Failed to load MCP tokens: ${error}\n`);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return; // Already scheduled
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushToDisk();
    }, PERSIST_DEBOUNCE_MS);
    if (this.persistTimer.unref) {
      this.persistTimer.unref();
    }
  }

  private flushToDisk(): void {
    const data: PersistedTokenData = {
      accessTokens: Object.fromEntries(this.accessTokens),
      refreshTokens: Object.fromEntries(this.refreshTokens),
      authCodes: Object.fromEntries(this.authCodes),
    };
    saveJsonFile(this.persistPath, data)
      .catch((err) => process.stderr.write(`Warning: Failed to persist MCP tokens: ${err}\n`));
  }
}
