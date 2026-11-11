import { describe, expect, it, vi } from 'vitest';
import { platform } from 'os';
import { getTokenProtection, loadAppConfig } from '../../../config/AppConfig.js';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, platform: vi.fn(actual.platform) };
});

describe('token protection configuration', () => {
  it('defaults to the plaintext compatibility format', () => {
    expect(getTokenProtection({})).toBe('plaintext');
    expect(loadAppConfig([], {}).tokenProtection).toBe('plaintext');
  });
  it('rejects invalid and empty modes without fallback', () => {
    for (const value of ['', 'invalid', 'DPAPI']) {
      expect(() => getTokenProtection({ GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION: value }))
        .toThrow('TOKEN_PROTECTION');
    }
  });
  it('validates platform support and resolves DPAPI at startup', () => {
    const mock = vi.mocked(platform);
    try {
      mock.mockReturnValue('linux');
      expect(() => getTokenProtection({ GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION: 'dpapi' }))
        .toThrow('requires Windows');
      mock.mockReturnValue('win32');
      expect(loadAppConfig([], { GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION: 'dpapi' }).tokenProtection)
        .toBe('dpapi');
    } finally { mock.mockRestore(); }
  });
});
