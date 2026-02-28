import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';

// Mock http module
vi.mock('http', () => {
  const mockServer = {
    listen: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    address: vi.fn()
  };
  return {
    default: {
      createServer: vi.fn(() => mockServer)
    }
  };
});

// Mock open module
vi.mock('open', () => ({
  default: vi.fn()
}));

// Mock loadCredentials
vi.mock('../../../auth/client.js', () => ({
  loadCredentials: vi.fn().mockResolvedValue({
    client_id: 'test-client-id',
    client_secret: 'test-client-secret'
  })
}));

// Mock TokenManager
vi.mock('../../../auth/tokenManager.js', () => ({
  TokenManager: class {
    validateTokens = vi.fn().mockResolvedValue(false);
    setAccountMode = vi.fn();
    saveTokens = vi.fn();
    getTokenPath = vi.fn().mockReturnValue('/mock/path/tokens.json');
    getAccountMode = vi.fn().mockReturnValue('test');
  }
}));

// Mock utils
vi.mock('../../../auth/utils.js', () => ({
  getAccountMode: vi.fn().mockReturnValue('normal')
}));

// Mock web templates
vi.mock('../../../web/templates.js', () => ({
  renderAuthSuccess: vi.fn().mockResolvedValue('<html>Success</html>'),
  renderAuthError: vi.fn().mockResolvedValue('<html>Error</html>'),
  renderAuthLanding: vi.fn().mockResolvedValue('<html>Landing</html>'),
  loadWebFile: vi.fn().mockResolvedValue('/* CSS */')
}));

describe('AuthServer', () => {
  let authServer: any;
  let mockOAuth2Client: OAuth2Client;
  let mockHttpServer: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock OAuth2Client
    mockOAuth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');

    // Setup mock http server
    mockHttpServer = {
      listen: vi.fn((port: number, callback: () => void) => {
        callback();
      }),
      close: vi.fn((callback?: (err?: Error) => void) => {
        if (callback) callback();
      }),
      on: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 3500 })
    };

    (http.createServer as any).mockReturnValue(mockHttpServer);

    // Import AuthServer fresh
    const { AuthServer } = await import('../../../auth/server.js');
    authServer = new AuthServer(mockOAuth2Client);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  describe('startForMcpTool', () => {
    it('should start server and return auth URL', async () => {
      const result = await authServer.startForMcpTool('work');

      expect(result.success).toBe(true);
      expect(result.authUrl).toBeDefined();
      expect(result.authUrl).toContain('accounts.google.com');
      expect(result.callbackUrl).toContain('oauth2callback');
      expect(result.callbackUrl).toContain('3500');
    });

    it('should stop existing server before starting new one', async () => {
      // Start first server
      await authServer.startForMcpTool('work');

      // Start second server - should stop first
      const closeSpy = mockHttpServer.close;
      await authServer.startForMcpTool('personal');

      // close should have been called to stop the first server
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should return error if no ports available', async () => {
      // Make all ports fail by not calling callback
      mockHttpServer.listen.mockImplementation((_port: number, _callback: () => void) => {
        // Don't call callback - simulate listen never succeeding
      });
      mockHttpServer.on.mockImplementation((event: string, handler: (err: any) => void) => {
        if (event === 'error') {
          // Simulate EADDRINUSE immediately
          handler({ code: 'EADDRINUSE' });
        }
      });

      const result = await authServer.startForMcpTool('work');

      // Should fail because no ports were available
      expect(result.success).toBe(false);
      expect(result.error).toContain('Ports');
    });

    it('should return error if credentials fail to load', async () => {
      const { loadCredentials } = await import('../../../auth/client.js');
      (loadCredentials as any).mockRejectedValueOnce(new Error('Credentials not found'));

      const result = await authServer.startForMcpTool('work');

      expect(result.success).toBe(false);
      expect(result.error).toContain('credentials');
    });

    it('should enable autoShutdownOnSuccess flag', async () => {
      await authServer.startForMcpTool('work');

      // Access private property for testing
      expect(authServer.autoShutdownOnSuccess).toBe(true);
    });

    it('should set authCompletedSuccessfully to false initially', async () => {
      await authServer.startForMcpTool('work');

      expect(authServer.authCompletedSuccessfully).toBe(false);
    });
  });

  describe('getRunningPort', () => {
    it('should return port when server is running', async () => {
      await authServer.startForMcpTool('work');

      const port = authServer.getRunningPort();
      expect(port).toBe(3500);
    });

    it('should return null when server is not running', () => {
      const port = authServer.getRunningPort();
      expect(port).toBeNull();
    });
  });

  describe('stop', () => {
    it('should close server gracefully', async () => {
      await authServer.startForMcpTool('work');

      await authServer.stop();

      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should clear mcpToolTimeout on stop', async () => {
      await authServer.startForMcpTool('work');

      // There should be a timeout set
      expect(authServer.mcpToolTimeout).not.toBeNull();

      await authServer.stop();

      expect(authServer.mcpToolTimeout).toBeNull();
    });

    it('should reset autoShutdownOnSuccess on stop', async () => {
      await authServer.startForMcpTool('work');
      expect(authServer.autoShutdownOnSuccess).toBe(true);

      await authServer.stop();

      expect(authServer.autoShutdownOnSuccess).toBe(false);
    });

    it('should resolve immediately if no server running', async () => {
      // Should not throw
      await expect(authServer.stop()).resolves.not.toThrow();
    });
  });

  describe('PKCE (Proof Key for Code Exchange)', () => {
    it('should include code_challenge in the auth URL', async () => {
      const result = await authServer.startForMcpTool('work');

      expect(result.success).toBe(true);
      const url = new URL(result.authUrl!);
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('should include code_challenge_method=S256 in the auth URL', async () => {
      const result = await authServer.startForMcpTool('work');

      expect(result.success).toBe(true);
      const url = new URL(result.authUrl!);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should store pendingAuthFlow when generating auth URL', async () => {
      expect(authServer.pendingAuthFlow).toBeNull();

      await authServer.startForMcpTool('work');

      expect(authServer.pendingAuthFlow).not.toBeNull();
      expect(typeof authServer.pendingAuthFlow.codeVerifier).toBe('string');
      expect(typeof authServer.pendingAuthFlow.codeChallenge).toBe('string');
      expect(typeof authServer.pendingAuthFlow.state).toBe('string');
    });

    it('should generate a fresh code verifier for each auth flow', async () => {
      await authServer.startForMcpTool('work');
      const firstVerifier = authServer.pendingAuthFlow!.codeVerifier;

      // Stop and start a new flow to get a new verifier
      await authServer.stop();
      await authServer.startForMcpTool('personal');
      const secondVerifier = authServer.pendingAuthFlow!.codeVerifier;

      expect(firstVerifier).toBeTruthy();
      expect(secondVerifier).toBeTruthy();
      expect(firstVerifier).not.toBe(secondVerifier);
    });

    it('should reuse the same PKCE values when auth URL is regenerated (race condition fix)', async () => {
      await authServer.startForMcpTool('work');
      const verifierAfterStart = authServer.pendingAuthFlow!.codeVerifier;
      const challengeAfterStart = authServer.pendingAuthFlow!.codeChallenge;

      // Simulate landing page visit by invoking the HTTP handler for '/'
      const handler = (http.createServer as any).mock.calls[0][0];
      const mockRes = { writeHead: vi.fn(), end: vi.fn() };
      await handler(
        { url: '/', headers: { host: 'localhost:3500' } },
        mockRes
      );

      // PKCE values should not have been regenerated
      expect(authServer.pendingAuthFlow!.codeVerifier).toBe(verifierAfterStart);
      expect(authServer.pendingAuthFlow!.codeChallenge).toBe(challengeAfterStart);
    });
  });

  describe('OAuth state parameter (CSRF protection)', () => {
    it('should include state parameter in auth URL', async () => {
      const result = await authServer.startForMcpTool('work');

      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('state=');
    });

    it('should generate a new state for each auth flow', async () => {
      const result1 = await authServer.startForMcpTool('work');
      const state1 = new URL(result1.authUrl!).searchParams.get('state');

      await authServer.stop();
      const result2 = await authServer.startForMcpTool('personal');
      const state2 = new URL(result2.authUrl!).searchParams.get('state');

      expect(state1).toBeDefined();
      expect(state2).toBeDefined();
      expect(state1).not.toBe(state2);
    });

    it('should store state in pendingAuthFlow', async () => {
      await authServer.startForMcpTool('work');

      expect(authServer.pendingAuthFlow).not.toBeNull();
      expect(typeof authServer.pendingAuthFlow!.state).toBe('string');
      expect(authServer.pendingAuthFlow!.state.length).toBe(64); // 32 bytes hex-encoded
    });

    it('should include state that matches pendingAuthFlow.state in auth URL', async () => {
      const result = await authServer.startForMcpTool('work');

      const authUrl = new URL(result.authUrl!);
      const urlState = authUrl.searchParams.get('state');

      expect(urlState).toBe(authServer.pendingAuthFlow!.state);
    });
  });

  describe('OAuth callback handler', () => {
    let handler: any;
    let mockRes: any;

    beforeEach(async () => {
      await authServer.startForMcpTool('work');
      handler = (http.createServer as any).mock.calls[0][0];
      mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      };
    });

    it('should return 403 when state parameter does not match', async () => {
      await handler(
        { url: '/oauth2callback?code=test-code&state=wrong-state', headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(mockRes.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    });

    it('should return 403 when state parameter is missing', async () => {
      await handler(
        { url: '/oauth2callback?code=test-code', headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(mockRes.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    });

    it('should return 403 when pendingAuthFlow is null (expired session)', async () => {
      // Clear the auth flow to simulate expiration
      authServer.pendingAuthFlow = null;

      await handler(
        { url: '/oauth2callback?code=test-code&state=some-state', headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(mockRes.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    });

    it('should pass codeVerifier to getToken on valid callback', async () => {
      const state = authServer.pendingAuthFlow!.state;
      const expectedVerifier = authServer.pendingAuthFlow!.codeVerifier;

      // Mock getToken on the flowOAuth2Client
      const flowClient = authServer.flowOAuth2Client;
      const getTokenSpy = vi.spyOn(flowClient, 'getToken').mockResolvedValue({
        tokens: { access_token: 'test-token', refresh_token: 'test-refresh' },
        res: null
      } as any);

      await handler(
        { url: `/oauth2callback?code=test-code&state=${state}`, headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(getTokenSpy).toHaveBeenCalledWith({
        code: 'test-code',
        codeVerifier: expectedVerifier
      });
    });

    it('should clear pendingAuthFlow after successful token exchange', async () => {
      const state = authServer.pendingAuthFlow!.state;

      vi.spyOn(authServer.flowOAuth2Client, 'getToken').mockResolvedValue({
        tokens: { access_token: 'test-token', refresh_token: 'test-refresh' },
        res: null
      } as any);

      await handler(
        { url: `/oauth2callback?code=test-code&state=${state}`, headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(authServer.pendingAuthFlow).toBeNull();
    });

    it('should clear pendingAuthFlow after failed token exchange', async () => {
      const state = authServer.pendingAuthFlow!.state;

      vi.spyOn(authServer.flowOAuth2Client, 'getToken').mockRejectedValue(new Error('Token exchange failed'));

      await handler(
        { url: `/oauth2callback?code=test-code&state=${state}`, headers: { host: 'localhost:3500' } },
        mockRes
      );

      expect(authServer.pendingAuthFlow).toBeNull();
      expect(mockRes.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    });
  });

  describe('stop cleanup', () => {
    it('should clear pendingAuthFlow on stop', async () => {
      await authServer.startForMcpTool('work');
      expect(authServer.pendingAuthFlow).not.toBeNull();

      await authServer.stop();

      expect(authServer.pendingAuthFlow).toBeNull();
    });
  });

  describe('timeout behavior', () => {
    it('should set 5-minute timeout for auto-shutdown', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      await authServer.startForMcpTool('work');

      // Find the 5-minute timeout call (5 * 60 * 1000 = 300000ms)
      const timeoutCalls = setTimeoutSpy.mock.calls;
      const fiveMinuteTimeout = timeoutCalls.find(call => call[1] === 5 * 60 * 1000);

      expect(fiveMinuteTimeout).toBeDefined();
    });

    it('should shutdown after timeout if auth not completed', async () => {
      await authServer.startForMcpTool('work');

      // Ensure auth is not completed
      expect(authServer.authCompletedSuccessfully).toBe(false);

      // Advance time by 5 minutes
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      // Server should have been stopped
      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should not shutdown if auth completed before timeout', async () => {
      await authServer.startForMcpTool('work');

      // Simulate successful auth
      authServer.authCompletedSuccessfully = true;

      // Advance time by 5 minutes
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      // close should not have been called by timeout
      // (it may have been called for other reasons in setup)
      const closeCalls = mockHttpServer.close.mock.calls.length;
      expect(closeCalls).toBe(0);
    });
  });
});
