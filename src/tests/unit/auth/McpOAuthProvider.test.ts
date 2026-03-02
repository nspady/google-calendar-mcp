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

vi.mock('../../../auth/client.js', () => ({
  loadCredentials: vi.fn(async () => ({
    client_id: 'google-client-id',
    client_secret: 'google-client-secret',
  })),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    generateAuthUrl = vi.fn(() => 'https://accounts.google.com/o/oauth2/auth?mock=true');
    getToken = vi.fn(async () => ({
      tokens: { access_token: 'google-at', refresh_token: 'google-rt' }
    }));
    setCredentials = vi.fn();
    getTokenInfo = vi.fn(async () => ({ email: 'user@gmail.com' }));
  }
}));

vi.mock('../../../services/CalendarRegistry.js', () => ({
  CalendarRegistry: {
    getInstance: vi.fn(() => ({
      clearCache: vi.fn()
    }))
  }
}));

import { McpOAuthProvider } from '../../../auth/mcp-oauth/McpOAuthProvider.js';
import { MCP_TOKEN_PREFIX, MCP_AUTH_STATE_TYPE } from '../../../auth/mcp-oauth/persistence.js';

function createMockTokenManager() {
  return {
    getAccountMode: vi.fn(() => 'normal'),
    setAccountMode: vi.fn(),
    saveTokens: vi.fn(async () => undefined),
  } as any;
}

function createMockResponse() {
  return {
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    json: vi.fn(),
  } as any;
}

describe('McpOAuthProvider', () => {
  let provider: McpOAuthProvider;
  let tokenManager: ReturnType<typeof createMockTokenManager>;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenManager = createMockTokenManager();
    provider = new McpOAuthProvider({
      tokenManager,
      issuerUrl: 'https://example.railway.app',
    });
    await provider.initialize();
  });

  afterEach(() => {
    provider.shutdown();
  });

  describe('clientsStore', () => {
    it('returns a clients store instance', () => {
      expect(provider.clientsStore).toBeDefined();
    });

    it('supports client registration', async () => {
      const store = provider.clientsStore;
      const registered = await store.registerClient!({
        redirect_uris: [new URL('https://claude.ai/api/mcp/auth_callback')],
        client_name: 'Claude Desktop',
      });
      expect(registered.client_id).toBeDefined();

      const retrieved = await store.getClient(registered.client_id);
      expect(retrieved).toBeDefined();
    });
  });

  describe('authorize', () => {
    it('redirects to Google OAuth with encoded MCP state', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://claude.ai/api/mcp/auth_callback')],
      });

      const res = createMockResponse();
      await provider.authorize(
        client,
        {
          codeChallenge: 'test-challenge-abc',
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          state: 'client-state-xyz',
        },
        res
      );

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirect.mock.calls[0][0];
      expect(redirectUrl).toContain('accounts.google.com');
    });
  });

  describe('token exchange', () => {
    it('exchanges auth code for tokens', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://claude.ai/callback')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'test-challenge',
        'https://claude.ai/callback',
        'session-1'
      );

      const tokens = await provider.exchangeAuthorizationCode(client, code);

      expect(tokens.access_token).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.ACCESS_TOKEN}`));
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBe(3600);
      expect(tokens.refresh_token).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.REFRESH_TOKEN}`));
    });

    it('rejects invalid auth code', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://claude.ai/callback')],
      });

      await expect(
        provider.exchangeAuthorizationCode(client, `${MCP_TOKEN_PREFIX.AUTH_CODE}invalid`)
      ).rejects.toThrow('Invalid or expired authorization code');
    });

    it('rejects auth code issued to different client', async () => {
      const client1 = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://a.example.com/cb')],
      });
      const client2 = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://b.example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client1.client_id,
        'challenge',
        'https://a.example.com/cb',
        'session-1'
      );

      await expect(
        provider.exchangeAuthorizationCode(client2, code)
      ).rejects.toThrow('not issued to this client');
    });

    it('enforces single-use auth codes', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'challenge',
        'https://example.com/cb',
        'session-1'
      );

      await provider.exchangeAuthorizationCode(client, code);
      await expect(
        provider.exchangeAuthorizationCode(client, code)
      ).rejects.toThrow('Invalid or expired authorization code');
    });
  });

  describe('refresh token exchange', () => {
    it('issues new access token from refresh token', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'challenge',
        'https://example.com/cb',
        'session-1'
      );
      const initialTokens = await provider.exchangeAuthorizationCode(client, code);

      const refreshed = await provider.exchangeRefreshToken(client, initialTokens.refresh_token!);
      expect(refreshed.access_token).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.ACCESS_TOKEN}`));
      expect(refreshed.access_token).not.toBe(initialTokens.access_token);
      expect(refreshed.token_type).toBe('Bearer');
    });

    it('rejects invalid refresh token', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      await expect(
        provider.exchangeRefreshToken(client, `${MCP_TOKEN_PREFIX.REFRESH_TOKEN}invalid`)
      ).rejects.toThrow('Invalid or expired refresh token');
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid access token', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'challenge',
        'https://example.com/cb',
        'session-1'
      );
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      const authInfo = await provider.verifyAccessToken(tokens.access_token);
      expect(authInfo.token).toBe(tokens.access_token);
      expect(authInfo.clientId).toBe(client.client_id);
      expect(authInfo.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('rejects invalid access token', async () => {
      await expect(
        provider.verifyAccessToken(`${MCP_TOKEN_PREFIX.ACCESS_TOKEN}invalid`)
      ).rejects.toThrow('Invalid or expired access token');
    });
  });

  describe('revokeToken', () => {
    it('revokes an access token', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'challenge',
        'https://example.com/cb',
        'session-1'
      );
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      await provider.revokeToken!(client, {
        token: tokens.access_token,
        token_type_hint: 'access_token',
      });

      await expect(
        provider.verifyAccessToken(tokens.access_token)
      ).rejects.toThrow();
    });

    it('revokes a refresh token and associated access tokens', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'challenge',
        'https://example.com/cb',
        'session-1'
      );
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      await provider.revokeToken!(client, {
        token: tokens.refresh_token!,
        token_type_hint: 'refresh_token',
      });

      await expect(
        provider.verifyAccessToken(tokens.access_token)
      ).rejects.toThrow();

      await expect(
        provider.exchangeRefreshToken(client, tokens.refresh_token!)
      ).rejects.toThrow();
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the code challenge for a valid auth code', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      const code = (provider as any)._tokenStore.createAuthCode(
        client.client_id,
        'my-challenge-value',
        'https://example.com/cb',
        'session-1'
      );

      const challenge = await provider.challengeForAuthorizationCode(client, code);
      expect(challenge).toBe('my-challenge-value');
    });

    it('throws for invalid auth code', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://example.com/cb')],
      });

      await expect(
        provider.challengeForAuthorizationCode(client, `${MCP_TOKEN_PREFIX.AUTH_CODE}invalid`)
      ).rejects.toThrow('Invalid or expired authorization code');
    });
  });

  describe('parseMcpAuthState', () => {
    it('parses valid MCP auth state', () => {
      const stateData = { type: MCP_AUTH_STATE_TYPE, sessionId: 'sess-123', account: 'default' };
      const encoded = Buffer.from(JSON.stringify(stateData)).toString('base64url');

      const result = McpOAuthProvider.parseMcpAuthState(encoded);
      expect(result).toEqual(stateData);
    });

    it('returns undefined for null state', () => {
      expect(McpOAuthProvider.parseMcpAuthState(null)).toBeUndefined();
    });

    it('returns undefined for non-MCP state', () => {
      const encoded = Buffer.from(JSON.stringify({ type: 'other' })).toString('base64url');
      expect(McpOAuthProvider.parseMcpAuthState(encoded)).toBeUndefined();
    });

    it('returns undefined for invalid base64', () => {
      expect(McpOAuthProvider.parseMcpAuthState('not-valid-base64!!!')).toBeUndefined();
    });
  });

  describe('completeMcpAuth', () => {
    it('completes the MCP auth flow and redirects with code', async () => {
      const client = await provider.clientsStore.registerClient!({
        redirect_uris: [new URL('https://claude.ai/api/mcp/auth_callback')],
      });

      const res1 = createMockResponse();
      await provider.authorize(
        client,
        {
          codeChallenge: 'test-challenge',
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          state: 'client-state',
        },
        res1
      );

      // Get sessionId from pending sessions
      const pendingSessions = (provider as any).pendingSessions as Map<string, any>;
      const [sessionId] = Array.from(pendingSessions.keys());

      const res2 = createMockResponse();
      await provider.completeMcpAuth('google-auth-code', sessionId, 'default', res2);

      expect(res2.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = new URL(res2.redirect.mock.calls[0][0]);
      expect(redirectUrl.origin).toBe('https://claude.ai');
      expect(redirectUrl.searchParams.get('code')).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.AUTH_CODE}`));
      expect(redirectUrl.searchParams.get('state')).toBe('client-state');

      expect(tokenManager.saveTokens).toHaveBeenCalled();
    });

    it('returns 400 for invalid session', async () => {
      const res = createMockResponse();
      await provider.completeMcpAuth('code', 'nonexistent-session', 'default', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Invalid or expired MCP auth session');
    });
  });
});
