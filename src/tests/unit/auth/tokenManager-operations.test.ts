import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn()
  }
}));

// Mock auth utilities
vi.mock('../../../auth/utils.js', () => ({
  getSecureTokenPath: vi.fn(() => '/mock/path/tokens.json'),
  getAccountMode: vi.fn(() => 'normal'),
  getLegacyTokenPath: vi.fn(() => '/mock/legacy/tokens.json')
}));

// Mock paths validation
vi.mock('../../../auth/paths.js', () => ({
  validateAccountId: vi.fn((id: string) => {
    if (id.includes('@') || id.includes('..')) {
      throw new Error('Invalid account ID');
    }
    return true;
  })
}));

describe('TokenManager - removeAccount', () => {
  let tokenManager: any;
  let mockOAuth2Client: OAuth2Client;
  const mockedFs = fs as any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock OAuth2Client
    mockOAuth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');

    // Default mock implementations
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.access.mockRejectedValue({ code: 'ENOENT' });

    // Import TokenManager fresh for each test
    const { TokenManager } = await import('../../../auth/tokenManager.js');
    tokenManager = new TokenManager(mockOAuth2Client);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should remove account from token file', async () => {
    // Setup: Token file with two accounts
    const existingTokens = {
      work: { access_token: 'work-token', refresh_token: 'work-refresh' },
      personal: { access_token: 'personal-token', refresh_token: 'personal-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
    mockedFs.writeFile.mockResolvedValue(undefined);

    await tokenManager.removeAccount('work');

    // Verify writeFile was called with personal only
    expect(mockedFs.writeFile).toHaveBeenCalled();
    const writeCall = mockedFs.writeFile.mock.calls[0];
    const writtenData = JSON.parse(writeCall[1]);
    expect(writtenData.work).toBeUndefined();
    expect(writtenData.personal).toBeDefined();
  });

  it('should throw error if account not found', async () => {
    // Setup: Token file without the requested account
    const existingTokens = {
      personal: { access_token: 'personal-token', refresh_token: 'personal-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));

    await expect(tokenManager.removeAccount('nonexistent'))
      .rejects.toThrow('Account "nonexistent" not found');
  });

  it('should delete file if last account removed', async () => {
    // Setup: Token file with only one account
    const existingTokens = {
      work: { access_token: 'work-token', refresh_token: 'work-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
    mockedFs.unlink.mockResolvedValue(undefined);

    await tokenManager.removeAccount('work');

    // Verify unlink was called instead of writeFile
    expect(mockedFs.unlink).toHaveBeenCalledWith('/mock/path/tokens.json');
  });

  it('should preserve other accounts when removing one', async () => {
    // Setup: Token file with three accounts
    const existingTokens = {
      work: { access_token: 'work-token', refresh_token: 'work-refresh' },
      personal: { access_token: 'personal-token', refresh_token: 'personal-refresh' },
      family: { access_token: 'family-token', refresh_token: 'family-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
    mockedFs.writeFile.mockResolvedValue(undefined);

    await tokenManager.removeAccount('personal');

    // Verify writeFile preserves other accounts
    const writeCall = mockedFs.writeFile.mock.calls[0];
    const writtenData = JSON.parse(writeCall[1]);
    expect(writtenData.work).toBeDefined();
    expect(writtenData.family).toBeDefined();
    expect(writtenData.personal).toBeUndefined();
  });

  it('should normalize account ID to lowercase', async () => {
    const existingTokens = {
      work: { access_token: 'work-token', refresh_token: 'work-refresh' },
      personal: { access_token: 'personal-token', refresh_token: 'personal-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
    mockedFs.writeFile.mockResolvedValue(undefined);

    // Remove with uppercase
    await tokenManager.removeAccount('WORK');

    // Should still remove the account
    const writeCall = mockedFs.writeFile.mock.calls[0];
    const writtenData = JSON.parse(writeCall[1]);
    expect(writtenData.work).toBeUndefined();
    expect(writtenData.personal).toBeDefined();
  });

  it('should set secure file permissions (0o600)', async () => {
    const existingTokens = {
      work: { access_token: 'work-token', refresh_token: 'work-refresh' },
      personal: { access_token: 'personal-token', refresh_token: 'personal-refresh' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
    mockedFs.writeFile.mockResolvedValue(undefined);

    await tokenManager.removeAccount('work');

    // Verify writeFile was called with correct options
    const writeCall = mockedFs.writeFile.mock.calls[0];
    expect(writeCall[2]).toEqual({ mode: 0o600 });
  });
});

describe('TokenManager - listAvailableAccounts', () => {
  let tokenManager: any;
  let mockOAuth2Client: OAuth2Client;
  const mockedFs = fs as any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockOAuth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');

    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.access.mockRejectedValue({ code: 'ENOENT' });

    const { TokenManager } = await import('../../../auth/tokenManager.js');
    tokenManager = new TokenManager(mockOAuth2Client);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should return list of account IDs', async () => {
    const existingTokens = {
      work: { access_token: 'work-token' },
      personal: { access_token: 'personal-token' },
      family: { access_token: 'family-token' }
    };

    mockedFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));

    const accounts = await tokenManager.listAvailableAccounts();

    expect(accounts).toContain('work');
    expect(accounts).toContain('personal');
    expect(accounts).toContain('family');
    expect(accounts).toHaveLength(3);
  });

  it('should return empty array when no accounts exist', async () => {
    mockedFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const accounts = await tokenManager.listAvailableAccounts();

    expect(accounts).toEqual([]);
  });

  it('should return empty array on file read error', async () => {
    mockedFs.readFile.mockRejectedValue(new Error('Permission denied'));

    const accounts = await tokenManager.listAvailableAccounts();

    expect(accounts).toEqual([]);
  });
});

describe('TokenManager - setAccountMode', () => {
  let tokenManager: any;
  let mockOAuth2Client: OAuth2Client;
  const mockedFs = fs as any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockOAuth2Client = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');

    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.access.mockRejectedValue({ code: 'ENOENT' });

    const { TokenManager } = await import('../../../auth/tokenManager.js');
    tokenManager = new TokenManager(mockOAuth2Client);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should update account mode', () => {
    tokenManager.setAccountMode('work');
    expect(tokenManager.getAccountMode()).toBe('work');
  });

  it('should allow switching between modes', () => {
    tokenManager.setAccountMode('work');
    expect(tokenManager.getAccountMode()).toBe('work');

    tokenManager.setAccountMode('personal');
    expect(tokenManager.getAccountMode()).toBe('personal');

    tokenManager.setAccountMode('family');
    expect(tokenManager.getAccountMode()).toBe('family');
  });
});
