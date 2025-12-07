import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManageAccountsHandler, ServerContext } from '../../../handlers/core/ManageAccountsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { AuthServer } from '../../../auth/server.js';
import { TokenManager } from '../../../auth/tokenManager.js';
import { google } from 'googleapis';

// Mock googleapis
const mockCalendarList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: {
        list: mockCalendarList
      }
    }))
  }
}));

describe('ManageAccountsHandler', () => {
  let handler: ManageAccountsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockContext: ServerContext;
  let mockAuthServer: Partial<AuthServer>;
  let mockTokenManager: Partial<TokenManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new ManageAccountsHandler();

    // Create mock OAuth2Client with credentials
    mockOAuth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');
    mockOAuth2Client.setCredentials({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_date: Date.now() + 3600000 // 1 hour from now
    });

    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Mock AuthServer
    mockAuthServer = {
      startForMcpTool: vi.fn()
    };

    // Mock TokenManager
    mockTokenManager = {
      setAccountMode: vi.fn(),
      removeAccount: vi.fn()
    };

    // Create mock context
    mockContext = {
      oauth2Client: mockOAuth2Client,
      tokenManager: mockTokenManager as TokenManager,
      authServer: mockAuthServer as AuthServer,
      accounts: mockAccounts,
      reloadAccounts: vi.fn().mockResolvedValue(mockAccounts)
    };

    // Setup calendar list mock response
    mockCalendarList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'test@example.com',
            summary: 'Test Calendar',
            timeZone: 'America/Los_Angeles',
            primary: true
          },
          {
            id: 'secondary@example.com',
            summary: 'Secondary Calendar',
            timeZone: 'America/New_York'
          }
        ]
      }
    });
  });

  // ==================== LIST ACTION ====================
  describe('list action', () => {
    it('should return all accounts when no account_id specified', async () => {
      const result = await handler.runTool({ action: 'list' }, mockContext);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const response = JSON.parse(result.content[0].text as string);
      expect(response.total_accounts).toBe(1);
      expect(response.accounts).toHaveLength(1);
      expect(response.accounts[0].account_id).toBe('test');
      expect(response.message).toContain('1 authenticated account');
    });

    it('should return specific account when account_id provided', async () => {
      const result = await handler.runTool({ action: 'list', account_id: 'test' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.total_accounts).toBe(1);
      expect(response.accounts[0].account_id).toBe('test');
      expect(response.message).toContain('Found account "test"');
    });

    it('should return empty list with helpful message when no accounts', async () => {
      mockContext.accounts = new Map();
      mockContext.reloadAccounts = vi.fn().mockResolvedValue(new Map());

      const result = await handler.runTool({ action: 'list' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.total_accounts).toBe(0);
      expect(response.accounts).toHaveLength(0);
      expect(response.message).toContain('No authenticated accounts found');
      expect(response.message).toContain("action 'add'");
    });

    it('should handle API errors gracefully (return error status per account)', async () => {
      mockCalendarList.mockRejectedValue(new Error('API Error'));

      const result = await handler.runTool({ action: 'list' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.accounts[0].status).toBe('active'); // Falls back to checking refresh_token
      expect(response.accounts[0].error).toContain('API Error');
    });

    it('should include email, calendar_count, primary_calendar, token_expiry', async () => {
      const result = await handler.runTool({ action: 'list' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      const account = response.accounts[0];

      expect(account.email).toBe('test@example.com');
      expect(account.calendar_count).toBe(2);
      expect(account.primary_calendar).toEqual({
        id: 'test@example.com',
        name: 'Test Calendar',
        timezone: 'America/Los_Angeles'
      });
      expect(account.token_expiry).toBeDefined();
    });

    it('should mark expired tokens as expired status', async () => {
      // Set expired credentials
      mockOAuth2Client.setCredentials({
        access_token: 'expired-token',
        refresh_token: 'test-refresh-token',
        expiry_date: Date.now() - 3600000 // 1 hour ago
      });

      const result = await handler.runTool({ action: 'list' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.accounts[0].status).toBe('expired');
    });

    it('should throw error for non-existent account_id', async () => {
      await expect(
        handler.runTool({ action: 'list', account_id: 'nonexistent' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'list', account_id: 'nonexistent' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('not found');
      }
    });
  });

  // ==================== ADD ACTION ====================
  describe('add action', () => {
    beforeEach(() => {
      (mockAuthServer.startForMcpTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?test=1',
        callbackUrl: 'http://localhost:3500/oauth2callback'
      });
    });

    it('should return auth URL when starting new account auth', async () => {
      const result = await handler.runTool({ action: 'add', account_id: 'newaccount' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.status).toBe('awaiting_authentication');
      expect(response.account_id).toBe('newaccount');
      expect(response.auth_url).toContain('accounts.google.com');
      expect(response.callback_url).toContain('oauth2callback');
      expect(response.instructions).toBeDefined();
      expect(response.expires_in_minutes).toBe(5);
      expect(response.next_step).toContain("action 'list'");
    });

    it('should return already_authenticated if account exists', async () => {
      const result = await handler.runTool({ action: 'add', account_id: 'test' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.status).toBe('already_authenticated');
      expect(response.account_id).toBe('test');
      expect(response.message).toContain('already connected');

      // Should NOT call startForMcpTool
      expect(mockAuthServer.startForMcpTool).not.toHaveBeenCalled();
    });

    it('should validate account_id format', async () => {
      // Note: uppercase is normalized to lowercase, so test with actually invalid chars
      await expect(
        handler.runTool({ action: 'add', account_id: 'invalid@email.com' }, mockContext)
      ).rejects.toThrow(McpError);
    });

    it('should reject invalid account_id (path traversal, special chars)', async () => {
      const invalidIds = ['../../../etc/passwd', 'test@email', 'test space'];

      for (const invalidId of invalidIds) {
        await expect(
          handler.runTool({ action: 'add', account_id: invalidId }, mockContext)
        ).rejects.toThrow();
      }
    });

    it('should throw error when no account_id provided', async () => {
      await expect(
        handler.runTool({ action: 'add' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'add' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('account_id is required');
      }
    });

    it('should include instructions and next_step in response', async () => {
      const result = await handler.runTool({ action: 'add', account_id: 'work' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.instructions).toContain('browser');
      expect(response.next_step).toContain('list');
    });

    it('should handle auth server start failure', async () => {
      (mockAuthServer.startForMcpTool as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Could not start auth server. Ports 3500-3505 may be in use.'
      });

      await expect(
        handler.runTool({ action: 'add', account_id: 'newaccount' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'add', account_id: 'newaccount' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InternalError);
        expect((error as McpError).message).toContain('Ports');
      }
    });

    it('should set account mode on tokenManager', async () => {
      await handler.runTool({ action: 'add', account_id: 'newwork' }, mockContext);

      expect(mockTokenManager.setAccountMode).toHaveBeenCalledWith('newwork');
    });
  });

  // ==================== REMOVE ACTION ====================
  describe('remove action', () => {
    beforeEach(() => {
      // Setup multiple accounts for remove tests
      const workClient = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');
      workClient.setCredentials({ access_token: 'work-token', refresh_token: 'work-refresh' });

      mockAccounts = new Map([
        ['test', mockOAuth2Client],
        ['work', workClient]
      ]);
      mockContext.accounts = mockAccounts;
      mockContext.reloadAccounts = vi.fn().mockResolvedValue(mockAccounts);
    });

    it('should remove existing account', async () => {
      // After removal, return only one account
      (mockContext.reloadAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockAccounts) // First call during validation
        .mockResolvedValueOnce(new Map([['test', mockOAuth2Client]])); // After removal

      const result = await handler.runTool({ action: 'remove', account_id: 'work' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.success).toBe(true);
      expect(response.account_id).toBe('work');
      expect(response.message).toContain('removed successfully');
      expect(response.remaining_accounts).toEqual(['test']);

      expect(mockTokenManager.removeAccount).toHaveBeenCalledWith('work');
    });

    it('should throw error if account_id not provided', async () => {
      await expect(
        handler.runTool({ action: 'remove' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'remove' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('required');
      }
    });

    it('should throw error if account not found', async () => {
      await expect(
        handler.runTool({ action: 'remove', account_id: 'nonexistent' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'remove', account_id: 'nonexistent' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('not found');
      }
    });

    it('should prevent removing last account', async () => {
      // Only one account
      mockAccounts = new Map([['test', mockOAuth2Client]]);
      mockContext.accounts = mockAccounts;
      mockContext.reloadAccounts = vi.fn().mockResolvedValue(mockAccounts);

      await expect(
        handler.runTool({ action: 'remove', account_id: 'test' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'remove', account_id: 'test' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('last authenticated account');
      }

      // Should NOT call removeAccount
      expect(mockTokenManager.removeAccount).not.toHaveBeenCalled();
    });

    it('should return remaining accounts after removal', async () => {
      (mockContext.reloadAccounts as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockAccounts)
        .mockResolvedValueOnce(new Map([['test', mockOAuth2Client]]));

      const result = await handler.runTool({ action: 'remove', account_id: 'work' }, mockContext);

      const response = JSON.parse(result.content[0].text as string);
      expect(response.remaining_accounts).toEqual(['test']);
    });

    it('should validate account_id format', async () => {
      await expect(
        handler.runTool({ action: 'remove', account_id: 'INVALID' }, mockContext)
      ).rejects.toThrow(McpError);
    });

    it('should handle tokenManager.removeAccount failure', async () => {
      (mockTokenManager.removeAccount as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('File system error')
      );

      await expect(
        handler.runTool({ action: 'remove', account_id: 'work' }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'remove', account_id: 'work' }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InternalError);
        expect((error as McpError).message).toContain('File system error');
      }
    });
  });

  // ==================== INVALID ACTION ====================
  describe('invalid action', () => {
    it('should throw error for unknown action', async () => {
      await expect(
        handler.runTool({ action: 'invalid' as any }, mockContext)
      ).rejects.toThrow(McpError);

      try {
        await handler.runTool({ action: 'unknown' as any }, mockContext);
      } catch (error) {
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('Invalid action');
      }
    });
  });
});
