import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  }
}));

vi.mock('../../../auth/utils.js', () => ({
  getSecureTokenPath: vi.fn(() => '/tmp/test/tokens.json'),
}));

import { McpTokenStore } from '../../../auth/mcp-oauth/McpTokenStore.js';
import { MCP_TOKEN_PREFIX } from '../../../auth/mcp-oauth/persistence.js';

describe('McpTokenStore', () => {
  let store: McpTokenStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new McpTokenStore();
    await store.initialize();
  });

  afterEach(() => {
    store.shutdown();
  });

  describe('Auth Codes', () => {
    it('creates and retrieves an auth code', () => {
      const code = store.createAuthCode('client-1', 'challenge123', 'https://example.com/callback', 'session-1');

      expect(code).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.AUTH_CODE}`));

      const stored = store.getAuthCode(code);
      expect(stored).toBeDefined();
      expect(stored!.clientId).toBe('client-1');
      expect(stored!.codeChallenge).toBe('challenge123');
      expect(stored!.redirectUri).toBe('https://example.com/callback');
      expect(stored!.sessionId).toBe('session-1');
    });

    it('consumes an auth code (single use)', () => {
      const code = store.createAuthCode('client-1', 'challenge', 'https://example.com/cb', 'session-1');

      const first = store.consumeAuthCode(code);
      expect(first).toBeDefined();

      const second = store.consumeAuthCode(code);
      expect(second).toBeUndefined();
    });

    it('returns undefined for nonexistent auth code', () => {
      expect(store.getAuthCode(`${MCP_TOKEN_PREFIX.AUTH_CODE}nonexistent`)).toBeUndefined();
    });

    it('returns undefined for expired auth code', () => {
      const code = store.createAuthCode('client-1', 'challenge', 'https://example.com/cb', 'session-1');

      const stored = store.getAuthCode(code)!;
      stored.expiresAt = Date.now() - 1000;

      expect(store.getAuthCode(code)).toBeUndefined();
    });
  });

  describe('Access Tokens', () => {
    it('creates and retrieves an access token', () => {
      const token = store.createAccessToken('client-1', ['calendar'], `${MCP_TOKEN_PREFIX.REFRESH_TOKEN}123`);

      expect(token.token).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.ACCESS_TOKEN}`));
      expect(token.clientId).toBe('client-1');
      expect(token.scopes).toEqual(['calendar']);
      expect(token.refreshToken).toBe(`${MCP_TOKEN_PREFIX.REFRESH_TOKEN}123`);

      const retrieved = store.getAccessToken(token.token);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe('client-1');
    });

    it('returns undefined for expired access token', () => {
      const token = store.createAccessToken('client-1', []);
      token.expiresAt = Date.now() - 1000;

      expect(store.getAccessToken(token.token)).toBeUndefined();
    });

    it('revokes an access token', () => {
      const token = store.createAccessToken('client-1', []);

      expect(store.revokeAccessToken(token.token)).toBe(true);
      expect(store.getAccessToken(token.token)).toBeUndefined();
    });

    it('returns false when revoking nonexistent token', () => {
      expect(store.revokeAccessToken(`${MCP_TOKEN_PREFIX.ACCESS_TOKEN}nonexistent`)).toBe(false);
    });
  });

  describe('Refresh Tokens', () => {
    it('creates and retrieves a refresh token', () => {
      const token = store.createRefreshToken('client-1', ['calendar']);

      expect(token.token).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.REFRESH_TOKEN}`));
      expect(token.clientId).toBe('client-1');

      const retrieved = store.getRefreshToken(token.token);
      expect(retrieved).toBeDefined();
    });

    it('revokes a refresh token', () => {
      const token = store.createRefreshToken('client-1', []);

      expect(store.revokeRefreshToken(token.token)).toBe(true);
      expect(store.getRefreshToken(token.token)).toBeUndefined();
    });

    it('revokes all tokens by refresh token', () => {
      const rt = store.createRefreshToken('client-1', []);
      const at1 = store.createAccessToken('client-1', [], rt.token);
      const at2 = store.createAccessToken('client-1', [], rt.token);
      const atOther = store.createAccessToken('client-1', [], 'other_rt');

      store.revokeTokensByRefreshToken(rt.token);

      expect(store.getRefreshToken(rt.token)).toBeUndefined();
      expect(store.getAccessToken(at1.token)).toBeUndefined();
      expect(store.getAccessToken(at2.token)).toBeUndefined();
      expect(store.getAccessToken(atOther.token)).toBeDefined();
    });
  });
});
