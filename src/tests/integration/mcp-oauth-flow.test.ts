/**
 * End-to-end MCP OAuth flow integration test.
 *
 * Starts the real Express server in-process with only Google OAuth mocked
 * (the sole external dependency), then walks through every step Claude Desktop
 * would perform:
 *
 *   discovery → registration → authorization → Google callback →
 *   token exchange → MCP initialize → tools/list
 *
 * On failure the step name tells you exactly where in the flow the problem is.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — only Google OAuth; everything else is real
// ---------------------------------------------------------------------------

// Mock google-auth-library so no real Google credentials are needed
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    generateAuthUrl(opts: { state?: string; [k: string]: unknown }) {
      // Return a fake "Google" auth URL that preserves the state param
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

// Mock loadCredentials — avoid needing a real credentials file
vi.mock('../../auth/client.js', () => ({
  loadCredentials: async () => ({
    client_id: 'fake-client-id',
    client_secret: 'fake-client-secret',
  }),
}));

// Mock persistence — no disk I/O, stores run purely in-memory
vi.mock('../../auth/mcp-oauth/persistence.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../auth/mcp-oauth/persistence.js')>();
  return {
    ...real,
    saveJsonFile: async () => {},
    loadJsonFile: async () => undefined,
  };
});

// Mock CalendarRegistry.clearCache to avoid side effects
vi.mock('../../services/CalendarRegistry.js', () => ({
  CalendarRegistry: {
    getInstance: () => ({ clearCache: () => {} }),
  },
}));

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HttpTransportHandler } from '../../transports/http.js';
import { TokenManager } from '../../auth/tokenManager.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MCP OAuth end-to-end flow', () => {
  let handler: HttpTransportHandler;
  let baseUrl: string;

  beforeAll(async () => {
    // Build a factory that returns a real McpServer with one echo tool
    const serverFactory = async () => {
      const server = new McpServer({ name: 'test-server', version: '0.0.1' });
      server.tool('echo', 'Echoes input back', { message: z.string() }, async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }));
      return server;
    };

    // Create a stub TokenManager (only used by McpOAuthProvider to store Google tokens)
    const tokenManager = {
      getAccountMode: () => 'default',
      setAccountMode: () => {},
      saveTokens: async () => {},
      clearTokens: async () => {},
      listAccounts: async () => [],
    } as unknown as TokenManager;

    // Use port 0 so the OS assigns a free port
    handler = new HttpTransportHandler(serverFactory, {
      port: 0,
      host: '127.0.0.1',
      mcpOAuth: { enabled: true, issuerUrl: 'http://127.0.0.1:0' },
    }, tokenManager);

    // connect() starts the Express server; we need to patch the issuerUrl
    // after it binds so that the URL includes the real port.
    // To accomplish this we set issuerUrl to a placeholder, then fix the
    // McpOAuthProvider's internal URLs post-bind. However, the mcpAuthRouter
    // in the SDK captures issuerUrl at setup time so we need the correct URL
    // from the start.
    //
    // Approach: listen on port 0, find the port, then re-create.
    // Simpler: just start, get the port, close, then start on that port.
    // Even simpler: we'll start once with issuerUrl containing port 0, then
    // use the actual port in our requests. The OAuth metadata endpoints
    // will advertise port 0 URLs, but we just need to verify the response
    // *shape*, then use the real port for all subsequent calls.

    // Actually, let's be smarter — start a throwaway server to grab a port,
    // then start the real one on that port with the correct issuerUrl.
    const net = await import('net');
    const freePort = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as import('net').AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });

    // Re-create with the correct port baked into issuerUrl
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

  // -----------------------------------------------------------------------
  // The test walks through every step of the MCP OAuth flow
  // -----------------------------------------------------------------------

  it('completes the full OAuth flow: discovery → registration → auth → token → MCP', async () => {
    // =====================================================================
    // Step 1: GET /.well-known/oauth-protected-resource/mcp
    // =====================================================================
    const resourceRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(resourceRes.status, 'Step 1: protected resource metadata status').toBe(200);
    const resourceMeta = await resourceRes.json() as Record<string, unknown>;
    expect(resourceMeta, 'Step 1: resource field present').toHaveProperty('resource');
    expect(resourceMeta, 'Step 1: authorization_servers present').toHaveProperty('authorization_servers');
    const authServers = resourceMeta.authorization_servers as string[];
    expect(authServers.length, 'Step 1: at least one auth server').toBeGreaterThanOrEqual(1);

    // =====================================================================
    // Step 2: GET /.well-known/oauth-authorization-server
    // =====================================================================
    const asMeta = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(asMeta.status, 'Step 2: AS metadata status').toBe(200);
    const asMetaJson = await asMeta.json() as Record<string, unknown>;
    expect(asMetaJson, 'Step 2: authorization_endpoint').toHaveProperty('authorization_endpoint');
    expect(asMetaJson, 'Step 2: token_endpoint').toHaveProperty('token_endpoint');
    expect(asMetaJson, 'Step 2: registration_endpoint').toHaveProperty('registration_endpoint');

    // =====================================================================
    // Step 3: POST /register (Dynamic Client Registration)
    // =====================================================================
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://localhost:9999/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        client_name: 'Test Client',
      }),
    });
    expect(regRes.status, 'Step 3: registration status').toBe(201);
    const regJson = await regRes.json() as Record<string, string>;
    expect(regJson, 'Step 3: client_id').toHaveProperty('client_id');
    expect(regJson, 'Step 3: client_secret').toHaveProperty('client_secret');
    const clientId = regJson.client_id;
    const clientSecret = regJson.client_secret;

    // =====================================================================
    // Step 4: GET /authorize (with PKCE)
    // =====================================================================
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = crypto.randomUUID();

    const authUrl = new URL(`${baseUrl}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('redirect_uri', 'http://localhost:9999/callback');
    authUrl.searchParams.set('state', state);

    const authRes = await fetch(authUrl.toString(), { redirect: 'manual' });
    expect(authRes.status, 'Step 4: authorize redirects (302)').toBe(302);
    const googleRedirect = authRes.headers.get('location')!;
    expect(googleRedirect, 'Step 4: redirects to Google').toContain('accounts.google.example');

    // Extract the encoded MCP state from the Google redirect URL
    const googleUrl = new URL(googleRedirect);
    const encodedMcpState = googleUrl.searchParams.get('state')!;
    expect(encodedMcpState, 'Step 4: MCP state in Google redirect').toBeTruthy();

    // =====================================================================
    // Step 5: GET /oauth2callback (simulate Google completing OAuth)
    // =====================================================================
    const callbackUrl = new URL(`${baseUrl}/oauth2callback`);
    callbackUrl.searchParams.set('code', 'fake-google-auth-code');
    callbackUrl.searchParams.set('state', encodedMcpState);

    const cbRes = await fetch(callbackUrl.toString(), { redirect: 'manual' });
    expect(cbRes.status, 'Step 5: callback redirects (302)').toBe(302);
    const clientRedirect = new URL(cbRes.headers.get('location')!);
    expect(clientRedirect.origin, 'Step 5: redirects to client redirect_uri').toBe('http://localhost:9999');

    // Extract MCP authorization code
    const mcpAuthCode = clientRedirect.searchParams.get('code')!;
    expect(mcpAuthCode, 'Step 5: MCP auth code starts with mcp_ac_').toMatch(/^mcp_ac_/);

    // Verify original state is preserved
    const returnedState = clientRedirect.searchParams.get('state');
    expect(returnedState, 'Step 5: original state preserved').toBe(state);

    // =====================================================================
    // Step 6: POST /token (exchange auth code for tokens)
    // =====================================================================
    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: mcpAuthCode,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'http://localhost:9999/callback',
      }).toString(),
    });
    expect(tokenRes.status, 'Step 6: token exchange status').toBe(200);
    const tokenJson = await tokenRes.json() as Record<string, string>;
    expect(tokenJson.access_token, 'Step 6: access_token starts with mcp_at_').toMatch(/^mcp_at_/);
    expect(tokenJson.refresh_token, 'Step 6: refresh_token starts with mcp_rt_').toMatch(/^mcp_rt_/);
    expect(tokenJson.token_type?.toLowerCase(), 'Step 6: token_type is bearer').toBe('bearer');
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;

    // =====================================================================
    // Step 7: POST /mcp with Bearer token (initialize)
    // =====================================================================
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
        id: 1,
      }),
    });
    expect(initRes.status, 'Step 7: initialize status').toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId, 'Step 7: mcp-session-id header present').toBeTruthy();

    // Parse response — may be SSE (text/event-stream) or JSON (enableJsonResponse)
    const initBody = await initRes.text();
    const contentType = initRes.headers.get('content-type') || '';
    let initData: { result?: { serverInfo?: unknown } };
    if (contentType.includes('text/event-stream')) {
      const initDataLine = initBody.split('\n').find(l => l.startsWith('data: '));
      expect(initDataLine, 'Step 7: SSE data line present').toBeTruthy();
      initData = JSON.parse(initDataLine!.slice(6));
    } else {
      initData = JSON.parse(initBody);
    }
    expect(initData.result, 'Step 7: result has serverInfo').toHaveProperty('serverInfo');

    // =====================================================================
    // Step 8: POST /mcp with session (notifications/initialized)
    // =====================================================================
    const notifRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    expect(notifRes.status, 'Step 8: notification accepted (202)').toBe(202);

    // =====================================================================
    // Step 9: POST /mcp with session (tools/list)
    // =====================================================================
    const toolsRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2,
      }),
    });
    expect(toolsRes.status, 'Step 9: tools/list status').toBe(200);
    const toolsBody = await toolsRes.text();
    const toolsContentType = toolsRes.headers.get('content-type') || '';
    let toolsData: { result?: { tools?: Array<{ name: string }> } };
    if (toolsContentType.includes('text/event-stream')) {
      const toolsDataLine = toolsBody.split('\n').find(l => l.startsWith('data: '));
      expect(toolsDataLine, 'Step 9: SSE data line present').toBeTruthy();
      toolsData = JSON.parse(toolsDataLine!.slice(6));
    } else {
      toolsData = JSON.parse(toolsBody);
    }
    const toolNames = toolsData.result?.tools?.map(t => t.name) ?? [];
    expect(toolNames, 'Step 9: echo tool present').toContain('echo');

    // =====================================================================
    // Step 10: POST /token with refresh_token (token refresh)
    // =====================================================================
    const refreshRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    expect(refreshRes.status, 'Step 10: refresh token status').toBe(200);
    const refreshJson = await refreshRes.json() as Record<string, string>;
    expect(refreshJson.access_token, 'Step 10: new access_token starts with mcp_at_').toMatch(/^mcp_at_/);
    expect(refreshJson.access_token, 'Step 10: new token differs from original').not.toBe(accessToken);
  }, 30_000);
});
