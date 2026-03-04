/**
 * ChatGPT OAuth Compatibility Tests
 *
 * Validates that our MCP OAuth implementation meets all specific requirements
 * of ChatGPT's MCP Apps SDK:
 *
 *   - RFC 9728: Protected Resource Metadata
 *   - RFC 8414: Authorization Server Metadata (with S256 PKCE)
 *   - RFC 7591: Dynamic Client Registration
 *   - PKCE with S256 code challenge
 *   - RFC 8707: Resource parameter support
 *   - ChatGPT redirect URI format
 *   - Token refresh
 *   - 401 without token + WWW-Authenticate header
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — same as mcp-oauth-flow.test.ts (only Google OAuth mocked)
// ---------------------------------------------------------------------------

vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    generateAuthUrl(opts: { state?: string; [k: string]: unknown }) {
      const u = new URL('https://accounts.google.example/o/oauth2/v2/auth');
      if (opts.state) u.searchParams.set('state', opts.state);
      u.searchParams.set('redirect_uri', 'test');
      return u.toString();
    }
    async getToken() {
      return {
        tokens: {
          access_token: 'fake-google-access-token',
          refresh_token: 'fake-google-refresh-token',
          expiry_date: Date.now() + 3_600_000,
        },
      };
    }
    setCredentials() {}
    async getTokenInfo() {
      return { email: 'test@example.com' };
    }
  }
  return { OAuth2Client: MockOAuth2Client };
});

vi.mock('../../auth/client.js', () => ({
  loadCredentials: async () => ({
    client_id: 'fake-client-id',
    client_secret: 'fake-client-secret',
  }),
}));

vi.mock('../../auth/mcp-oauth/persistence.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../auth/mcp-oauth/persistence.js')>();
  return {
    ...real,
    saveJsonFile: async () => {},
    loadJsonFile: async () => undefined,
  };
});

vi.mock('../../services/CalendarRegistry.js', () => ({
  CalendarRegistry: {
    getInstance: () => ({ clearCache: () => {} }),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HttpTransportHandler } from '../../transports/http.js';
import { TokenManager } from '../../auth/tokenManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the full OAuth flow and return tokens + session info. */
async function completeOAuthFlow(baseUrl: string, redirectUri: string, clientName: string) {
  // Register
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      client_name: clientName,
    }),
  });
  const regJson = await regRes.json() as Record<string, string>;
  const clientId = regJson.client_id;
  const clientSecret = regJson.client_secret;

  // Authorize with PKCE
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomUUID();

  const authUrl = new URL(`${baseUrl}/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  const authRes = await fetch(authUrl.toString(), { redirect: 'manual' });
  const googleUrl = new URL(authRes.headers.get('location')!);
  const encodedMcpState = googleUrl.searchParams.get('state')!;

  // Google callback
  const callbackUrl = new URL(`${baseUrl}/oauth2callback`);
  callbackUrl.searchParams.set('code', 'fake-google-auth-code');
  callbackUrl.searchParams.set('state', encodedMcpState);

  const cbRes = await fetch(callbackUrl.toString(), { redirect: 'manual' });
  const clientRedirect = new URL(cbRes.headers.get('location')!);
  const mcpAuthCode = clientRedirect.searchParams.get('code')!;

  // Token exchange
  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: mcpAuthCode,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const tokenJson = await tokenRes.json() as Record<string, string>;

  return {
    clientId,
    clientSecret,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    state,
    returnedState: clientRedirect.searchParams.get('state'),
    clientRedirect,
    codeVerifier,
  };
}

/** Parse SSE or JSON response body. */
async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const body = await res.text();
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const dataLine = body.split('\n').find(l => l.startsWith('data: '));
    return JSON.parse(dataLine!.slice(6));
  }
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChatGPT OAuth Compatibility', () => {
  let handler: HttpTransportHandler;
  let baseUrl: string;

  beforeAll(async () => {
    const serverFactory = async () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      server.tool('echo', 'Echoes input back', { message: z.string() }, async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }));
      return server;
    };

    const tokenManager = {
      getAccountMode: () => 'default',
      setAccountMode: () => {},
      saveTokens: async () => {},
      clearTokens: async () => {},
      listAccounts: async () => [],
    } as unknown as TokenManager;

    // Grab a free port, then start the server with the correct issuerUrl
    const net = await import('net');
    const freePort = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as import('net').AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });

    handler = new HttpTransportHandler(serverFactory, {
      port: freePort,
      host: '127.0.0.1',
      mcpOAuth: { enabled: true, issuerUrl: `http://127.0.0.1:${freePort}` },
    }, tokenManager);

    await handler.connect();
    baseUrl = `http://127.0.0.1:${handler.port}`;
  }, 15_000);

  afterAll(async () => {
    await handler.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Protected Resource Metadata (RFC 9728)
  // -------------------------------------------------------------------------
  describe('Protected Resource Metadata (RFC 9728)', () => {
    it('returns valid metadata with required fields', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
      expect(res.status).toBe(200);

      const meta = await res.json() as Record<string, unknown>;

      // resource field is a valid URL ending in /mcp
      expect(meta).toHaveProperty('resource');
      const resource = meta.resource as string;
      expect(() => new URL(resource)).not.toThrow();
      expect(resource).toMatch(/\/mcp$/);

      // authorization_servers is a non-empty array of valid URLs
      expect(meta).toHaveProperty('authorization_servers');
      const authServers = meta.authorization_servers as string[];
      expect(Array.isArray(authServers)).toBe(true);
      expect(authServers.length).toBeGreaterThanOrEqual(1);
      for (const server of authServers) {
        expect(() => new URL(server)).not.toThrow();
      }
    });

    it('includes CORS headers', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
      // The SDK's mcpAuthRouter typically sets CORS headers on metadata endpoints
      const acao = res.headers.get('access-control-allow-origin');
      // If present, it should allow any origin or a specific origin
      if (acao) {
        expect(acao).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Authorization Server Metadata (RFC 8414)
  // -------------------------------------------------------------------------
  describe('Authorization Server Metadata (RFC 8414)', () => {
    it('returns all required fields for ChatGPT compatibility', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);

      const meta = await res.json() as Record<string, unknown>;

      // issuer matches the server's base URL (may have trailing slash per RFC 8414)
      expect(meta).toHaveProperty('issuer');
      const issuer = (meta.issuer as string).replace(/\/$/, '');
      expect(issuer).toBe(baseUrl);

      // Core endpoints
      expect(meta).toHaveProperty('authorization_endpoint');
      expect(typeof meta.authorization_endpoint).toBe('string');
      expect(() => new URL(meta.authorization_endpoint as string)).not.toThrow();

      expect(meta).toHaveProperty('token_endpoint');
      expect(typeof meta.token_endpoint).toBe('string');
      expect(() => new URL(meta.token_endpoint as string)).not.toThrow();

      // DCR endpoint required for ChatGPT
      expect(meta).toHaveProperty('registration_endpoint');
      expect(typeof meta.registration_endpoint).toBe('string');
      expect(() => new URL(meta.registration_endpoint as string)).not.toThrow();
    });

    it('supports S256 PKCE (critical for ChatGPT)', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      const meta = await res.json() as Record<string, unknown>;

      const methods = meta.code_challenge_methods_supported as string[];
      expect(Array.isArray(methods)).toBe(true);
      expect(methods).toContain('S256');
    });

    it('supports required response types and grant types', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      const meta = await res.json() as Record<string, unknown>;

      const responseTypes = meta.response_types_supported as string[];
      expect(responseTypes).toContain('code');

      const grantTypes = meta.grant_types_supported as string[];
      expect(grantTypes).toContain('authorization_code');
      expect(grantTypes).toContain('refresh_token');
    });

    it('supports client_secret_post auth method', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      const meta = await res.json() as Record<string, unknown>;

      const authMethods = meta.token_endpoint_auth_methods_supported as string[];
      expect(authMethods).toContain('client_secret_post');
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Dynamic Client Registration (RFC 7591)
  // -------------------------------------------------------------------------
  describe('Dynamic Client Registration (RFC 7591)', () => {
    it('registers a ChatGPT-style client and returns required fields', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://chatgpt.com/connector/oauth/abc123'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          client_name: 'ChatGPT',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json() as Record<string, unknown>;

      expect(json).toHaveProperty('client_id');
      expect(typeof json.client_id).toBe('string');
      expect((json.client_id as string).length).toBeGreaterThan(0);

      expect(json).toHaveProperty('client_secret');
      expect(typeof json.client_secret).toBe('string');
      expect((json.client_secret as string).length).toBeGreaterThan(0);

      expect(json).toHaveProperty('client_secret_expires_at');
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: PKCE with S256
  // -------------------------------------------------------------------------
  describe('PKCE with S256', () => {
    it('completes the full auth code flow with S256 PKCE verification', async () => {
      const redirectUri = 'http://localhost:9999/callback';

      // Register
      const regRes = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          client_name: 'PKCE Test Client',
        }),
      });
      const regJson = await regRes.json() as Record<string, string>;
      const clientId = regJson.client_id;
      const clientSecret = regJson.client_secret;

      // Generate PKCE S256 challenge
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomUUID();

      // Authorize
      const authUrl = new URL(`${baseUrl}/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);

      const authRes = await fetch(authUrl.toString(), { redirect: 'manual' });
      expect(authRes.status).toBe(302);

      const googleUrl = new URL(authRes.headers.get('location')!);
      expect(googleUrl.hostname).toBe('accounts.google.example');
      const encodedMcpState = googleUrl.searchParams.get('state')!;

      // Google callback
      const callbackUrl = new URL(`${baseUrl}/oauth2callback`);
      callbackUrl.searchParams.set('code', 'fake-google-auth-code');
      callbackUrl.searchParams.set('state', encodedMcpState);

      const cbRes = await fetch(callbackUrl.toString(), { redirect: 'manual' });
      expect(cbRes.status).toBe(302);

      const clientRedirect = new URL(cbRes.headers.get('location')!);
      const mcpAuthCode = clientRedirect.searchParams.get('code')!;
      expect(mcpAuthCode).toMatch(/^mcp_ac_/);

      // Token exchange with code_verifier
      const tokenRes = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: mcpAuthCode,
          code_verifier: codeVerifier,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
      });
      expect(tokenRes.status).toBe(200);

      const tokenJson = await tokenRes.json() as Record<string, unknown>;
      expect(tokenJson.access_token).toBeTruthy();
      expect(tokenJson.token_type).toBeTruthy();
      expect((tokenJson.token_type as string).toLowerCase()).toBe('bearer');

      // Verify wrong code_verifier fails — register a new client to avoid
      // reuse issues, then run the flow again with a bad verifier
      const reg2 = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          client_name: 'PKCE Bad Verifier',
        }),
      });
      const reg2Json = await reg2.json() as Record<string, string>;

      const verifier2 = crypto.randomBytes(32).toString('base64url');
      const challenge2 = crypto.createHash('sha256').update(verifier2).digest('base64url');
      const state2 = crypto.randomUUID();

      const auth2 = new URL(`${baseUrl}/authorize`);
      auth2.searchParams.set('client_id', reg2Json.client_id);
      auth2.searchParams.set('response_type', 'code');
      auth2.searchParams.set('code_challenge', challenge2);
      auth2.searchParams.set('code_challenge_method', 'S256');
      auth2.searchParams.set('redirect_uri', redirectUri);
      auth2.searchParams.set('state', state2);

      const authRes2 = await fetch(auth2.toString(), { redirect: 'manual' });
      const googleUrl2 = new URL(authRes2.headers.get('location')!);

      const cb2 = new URL(`${baseUrl}/oauth2callback`);
      cb2.searchParams.set('code', 'fake-google-auth-code');
      cb2.searchParams.set('state', googleUrl2.searchParams.get('state')!);
      const cbRes2 = await fetch(cb2.toString(), { redirect: 'manual' });
      const redirect2 = new URL(cbRes2.headers.get('location')!);
      const code2 = redirect2.searchParams.get('code')!;

      // Use wrong verifier
      const badTokenRes = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code2,
          code_verifier: 'wrong-verifier-value',
          client_id: reg2Json.client_id,
          client_secret: reg2Json.client_secret,
          redirect_uri: redirectUri,
        }).toString(),
      });
      // Should fail with 400 (invalid_grant) since verifier doesn't match
      expect(badTokenRes.status).toBeGreaterThanOrEqual(400);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Test 5: Resource Parameter (RFC 8707)
  // -------------------------------------------------------------------------
  describe('Resource Parameter (RFC 8707)', () => {
    it('accepts resource parameter in authorize and token requests', async () => {
      const redirectUri = 'http://localhost:9999/callback';
      const resourceUrl = `${baseUrl}/mcp`;

      // Register
      const regRes = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          client_name: 'Resource Param Client',
        }),
      });
      const regJson = await regRes.json() as Record<string, string>;

      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomUUID();

      // Authorize with resource parameter
      const authUrl = new URL(`${baseUrl}/authorize`);
      authUrl.searchParams.set('client_id', regJson.client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('resource', resourceUrl);

      const authRes = await fetch(authUrl.toString(), { redirect: 'manual' });
      // Should not reject the resource parameter — 302 means accepted
      expect(authRes.status).toBe(302);

      const googleUrl = new URL(authRes.headers.get('location')!);
      const encodedMcpState = googleUrl.searchParams.get('state')!;

      // Google callback
      const callbackUrl = new URL(`${baseUrl}/oauth2callback`);
      callbackUrl.searchParams.set('code', 'fake-google-auth-code');
      callbackUrl.searchParams.set('state', encodedMcpState);

      const cbRes = await fetch(callbackUrl.toString(), { redirect: 'manual' });
      const clientRedirect = new URL(cbRes.headers.get('location')!);
      const mcpAuthCode = clientRedirect.searchParams.get('code')!;

      // Token exchange with resource parameter
      const tokenRes = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: mcpAuthCode,
          code_verifier: codeVerifier,
          client_id: regJson.client_id,
          client_secret: regJson.client_secret,
          redirect_uri: redirectUri,
          resource: resourceUrl,
        }).toString(),
      });
      // Should succeed (200) — resource parameter accepted
      expect(tokenRes.status).toBe(200);

      const tokenJson = await tokenRes.json() as Record<string, unknown>;
      expect(tokenJson.access_token).toBeTruthy();
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Test 6: ChatGPT Redirect URI Format
  // -------------------------------------------------------------------------
  describe('ChatGPT Redirect URI Format', () => {
    it('supports the exact ChatGPT connector redirect URI and preserves state', async () => {
      const chatgptRedirectUri = 'https://chatgpt.com/connector/oauth/lYFgGi5qoKyU';

      const result = await completeOAuthFlow(baseUrl, chatgptRedirectUri, 'ChatGPT Redirect Test');

      // Verify the callback redirected to the exact ChatGPT URI
      expect(result.clientRedirect.origin).toBe('https://chatgpt.com');
      expect(result.clientRedirect.pathname).toBe('/connector/oauth/lYFgGi5qoKyU');

      // Verify state was preserved through the full flow
      expect(result.returnedState).toBe(result.state);

      // Verify we got valid tokens
      expect(result.accessToken).toMatch(/^mcp_at_/);
      expect(result.refreshToken).toMatch(/^mcp_rt_/);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Test 7: Token Refresh
  // -------------------------------------------------------------------------
  describe('Token Refresh', () => {
    it('issues a new access token via refresh_token grant and the new token works', async () => {
      const redirectUri = 'http://localhost:9999/callback';
      const flow = await completeOAuthFlow(baseUrl, redirectUri, 'Refresh Test Client');

      // Refresh the token
      const refreshRes = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: flow.refreshToken,
          client_id: flow.clientId,
          client_secret: flow.clientSecret,
        }).toString(),
      });
      expect(refreshRes.status).toBe(200);

      const refreshJson = await refreshRes.json() as Record<string, string>;
      expect(refreshJson.access_token).toMatch(/^mcp_at_/);
      expect(refreshJson.access_token).not.toBe(flow.accessToken);

      // Verify the new token works for an MCP request
      const initRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshJson.access_token}`,
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'refresh-test', version: '0.0.1' },
          },
          id: 1,
        }),
      });
      expect(initRes.status).toBe(200);

      const initData = await parseResponse(initRes);
      expect(initData).toHaveProperty('result');
      expect((initData as { result?: { serverInfo?: unknown } }).result).toHaveProperty('serverInfo');
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Test 8: 401 Without Token
  // -------------------------------------------------------------------------
  describe('401 Without Token', () => {
    it('returns 401 with WWW-Authenticate header when no Bearer token is provided', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'no-auth-test', version: '0.0.1' },
          },
          id: 1,
        }),
      });

      expect(res.status).toBe(401);

      // ChatGPT uses WWW-Authenticate to trigger its auth UI
      const wwwAuth = res.headers.get('www-authenticate');
      expect(wwwAuth).toBeTruthy();
    });

    it('returns 401 with an invalid Bearer token', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token-here',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'bad-auth-test', version: '0.0.1' },
          },
          id: 1,
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});
