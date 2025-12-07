import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { EventEmitter } from 'events';

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
  TokenManager: vi.fn().mockImplementation(() => ({
    validateTokens: vi.fn().mockResolvedValue(false),
    setAccountMode: vi.fn(),
    saveTokens: vi.fn(),
    getTokenPath: vi.fn().mockReturnValue('/mock/path/tokens.json'),
    getAccountMode: vi.fn().mockReturnValue('test')
  }))
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
