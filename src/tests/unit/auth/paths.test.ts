import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSecureTokenPath } from '../../../auth/paths.js';
import path from 'path';
import { homedir } from 'os';

describe('getSecureTokenPath', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('Priority 1: GOOGLE_CALENDAR_MCP_TOKEN_PATH', () => {
    it('should use GOOGLE_CALENDAR_MCP_TOKEN_PATH when set (absolute path)', () => {
      process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH = '/custom/path/tokens.json';
      expect(getSecureTokenPath()).toBe('/custom/path/tokens.json');
    });

    it('should resolve relative GOOGLE_CALENDAR_MCP_TOKEN_PATH to absolute', () => {
      process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH = './tokens.json';
      const result = getSecureTokenPath();
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(path.resolve('./tokens.json'));
    });

    it('should prioritize GOOGLE_CALENDAR_MCP_TOKEN_PATH over XDG_CONFIG_HOME', () => {
      process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH = '/custom/tokens.json';
      process.env.XDG_CONFIG_HOME = '/xdg/config';
      expect(getSecureTokenPath()).toBe('/custom/tokens.json');
    });
  });

  describe('Priority 2: XDG_CONFIG_HOME', () => {
    it('should use XDG_CONFIG_HOME when set and no custom token path', () => {
      process.env.XDG_CONFIG_HOME = '/custom/xdg/config';
      expect(getSecureTokenPath()).toBe('/custom/xdg/config/google-calendar-mcp/tokens.json');
    });
  });

  describe('Priority 3: Default ~/.config', () => {
    it('should fall back to ~/.config when no env vars set', () => {
      const expected = path.join(homedir(), '.config', 'google-calendar-mcp', 'tokens.json');
      expect(getSecureTokenPath()).toBe(expected);
    });
  });
});
