import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenManager } from '../../../auth/tokenManager.js';
import { OAuth2Client, Credentials } from 'google-auth-library';
import fs from 'fs/promises';

// Mock the entire fs/promises module
vi.mock('fs/promises');

describe('TokenManager - Multi-Account Support', () => {
  let oauth2Client: OAuth2Client;
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    oauth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');
    tokenManager = new TokenManager(oauth2Client);
  });

  describe('loadAllAccounts', () => {
    it('should load all accounts from token file', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh',
          expiry_date: Date.now() + 3600000
        },
        personal: {
          access_token: 'personal-access',
          refresh_token: 'personal-refresh',
          expiry_date: Date.now() + 3600000
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));

      const accounts = await tokenManager.loadAllAccounts();

      expect(accounts.size).toBe(2);
      expect(accounts.has('work')).toBe(true);
      expect(accounts.has('personal')).toBe(true);
      expect(accounts.get('work')).toBeInstanceOf(OAuth2Client);
      expect(accounts.get('personal')).toBeInstanceOf(OAuth2Client);
    });

    it('should return empty map when no token file exists', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const accounts = await tokenManager.loadAllAccounts();

      expect(accounts.size).toBe(0);
    });

    it('should skip invalid account entries', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh'
        },
        invalid: null, // Invalid entry
        personal: {
          access_token: 'personal-access',
          refresh_token: 'personal-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));

      const accounts = await tokenManager.loadAllAccounts();

      expect(accounts.size).toBe(2);
      expect(accounts.has('work')).toBe(true);
      expect(accounts.has('personal')).toBe(true);
      expect(accounts.has('invalid')).toBe(false);
    });

    it('should validate account IDs when loading', async () => {
      const mockTokens = {
        'valid-account': {
          access_token: 'valid-access',
          refresh_token: 'valid-refresh'
        },
        '../../../etc/passwd': { // Invalid account ID
          access_token: 'bad-access',
          refresh_token: 'bad-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));

      const accounts = await tokenManager.loadAllAccounts();

      expect(accounts.size).toBe(1);
      expect(accounts.has('valid-account')).toBe(true);
      expect(accounts.has('../../../etc/passwd')).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return OAuth2Client for existing account', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));
      await tokenManager.loadAllAccounts();

      const client = tokenManager.getClient('work');

      expect(client).toBeInstanceOf(OAuth2Client);
      expect(client.credentials.access_token).toBe('work-access');
    });

    it('should throw error for non-existent account', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      await tokenManager.loadAllAccounts();

      expect(() => tokenManager.getClient('nonexistent'))
        .toThrow(/Account "nonexistent" not found/i);
    });

    it('should validate account ID before lookup', () => {
      expect(() => tokenManager.getClient('../../../etc/passwd'))
        .toThrow(/Invalid account ID/i);
    });
  });

  describe('listAccounts', () => {
    it('should return list of account IDs with email addresses', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh'
        },
        personal: {
          access_token: 'personal-access',
          refresh_token: 'personal-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));

      // Mock getUserEmail calls
      vi.spyOn(tokenManager as any, 'getUserEmail')
        .mockResolvedValueOnce('user@company.com')
        .mockResolvedValueOnce('user@gmail.com');

      const accounts = await tokenManager.listAccounts();

      expect(accounts).toEqual([
        { id: 'work', email: 'user@company.com', status: 'active', calendars: [] },
        { id: 'personal', email: 'user@gmail.com', status: 'active', calendars: [] }
      ]);
    });

    it('should return empty array when no accounts exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const accounts = await tokenManager.listAccounts();

      expect(accounts).toEqual([]);
    });

    it('should include status for each account', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh',
          expiry_date: Date.now() + 3600000 // Valid access token
        },
        personal: {
          // No refresh_token and expired access token = truly expired
          access_token: 'personal-access',
          expiry_date: Date.now() - 3600000 // Expired
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));
      vi.spyOn(tokenManager as any, 'getUserEmail')
        .mockResolvedValue('user@example.com');

      const accounts = await tokenManager.listAccounts();

      // Account with refresh_token should always be active (can refresh)
      expect(accounts[0].status).toBe('active');
      // Account without refresh_token and expired access token should be expired
      expect(accounts[1].status).toBe('expired');
    });

    it('should mark account with refresh_token as active even if access token expired', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh',
          expiry_date: Date.now() - 3600000 // Expired access token, but has refresh
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));
      vi.spyOn(tokenManager as any, 'getUserEmail')
        .mockResolvedValue('user@example.com');

      const accounts = await tokenManager.listAccounts();

      // Has refresh_token, so can get new access tokens = active
      expect(accounts[0].status).toBe('active');
    });
  });

  describe('Account Isolation', () => {
    it('should keep tokens isolated between accounts', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access',
          refresh_token: 'work-refresh'
        },
        personal: {
          access_token: 'personal-access',
          refresh_token: 'personal-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));
      await tokenManager.loadAllAccounts();

      const workClient = tokenManager.getClient('work');
      const personalClient = tokenManager.getClient('personal');

      expect(workClient.credentials.access_token).toBe('work-access');
      expect(personalClient.credentials.access_token).toBe('personal-access');
      expect(workClient).not.toBe(personalClient);
    });

    it('should not leak tokens when one account refreshes', async () => {
      const mockTokens = {
        work: {
          access_token: 'work-access-old',
          refresh_token: 'work-refresh'
        },
        personal: {
          access_token: 'personal-access',
          refresh_token: 'personal-refresh'
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTokens));
      await tokenManager.loadAllAccounts();

      const workClient = tokenManager.getClient('work');
      const personalClient = tokenManager.getClient('personal');

      // Simulate token refresh for work account
      workClient.setCredentials({
        access_token: 'work-access-new',
        refresh_token: 'work-refresh'
      });

      // Personal account should be unaffected
      expect(personalClient.credentials.access_token).toBe('personal-access');
    });
  });
});
