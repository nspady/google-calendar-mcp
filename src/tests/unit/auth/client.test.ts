/**
 * Unit tests for Auth Method Selection in client.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectAuthMethod, readAuthMethodPreference } from '../../../auth/client.js';
import { AuthMethod } from '../../../auth/types.js';

describe('Auth Method Selection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readAuthMethodPreference', () => {
    it('should return GCLOUD when GOOGLE_AUTH_METHOD=gcloud', () => {
      process.env.GOOGLE_AUTH_METHOD = 'gcloud';

      const result = readAuthMethodPreference();

      expect(result).toBe(AuthMethod.GCLOUD);
    });

    it('should return OAUTH when GOOGLE_AUTH_METHOD=oauth', () => {
      process.env.GOOGLE_AUTH_METHOD = 'oauth';

      const result = readAuthMethodPreference();

      expect(result).toBe(AuthMethod.OAUTH);
    });

    it('should return auto when GOOGLE_AUTH_METHOD is unset', () => {
      delete process.env.GOOGLE_AUTH_METHOD;

      const result = readAuthMethodPreference();

      expect(result).toBe('auto');
    });

    it('should return null and log warning for invalid value', () => {
      process.env.GOOGLE_AUTH_METHOD = 'invalid_value';
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = readAuthMethodPreference();

      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('should handle case-insensitive values', () => {
      process.env.GOOGLE_AUTH_METHOD = 'GCLOUD';

      const result = readAuthMethodPreference();

      expect(result).toBe(AuthMethod.GCLOUD);
    });
  });

  describe('selectAuthMethod', () => {
    const requiredScopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    it('should use gcloud when GOOGLE_AUTH_METHOD=gcloud and ADC available', async () => {
      process.env.GOOGLE_AUTH_METHOD = 'gcloud';

      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result.method).toBe(AuthMethod.GCLOUD);
      expect(result.oauth2Client).toBeTruthy();
      expect(result.source).toContain('Application Default Credentials');
    });

    it('should use oauth when GOOGLE_AUTH_METHOD=oauth', async () => {
      process.env.GOOGLE_AUTH_METHOD = 'oauth';

      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result.method).toBe(AuthMethod.OAUTH);
      expect(result.oauth2Client).toBeTruthy();
      expect(result.source).toContain('OAuth');
    });

    it('should auto-select gcloud when unset and ADC available', async () => {
      delete process.env.GOOGLE_AUTH_METHOD;

      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result.method).toBe(AuthMethod.GCLOUD);
      expect(result.source).toContain('auto-detected');
    });

    it('should fallback to oauth when unset and ADC unavailable', async () => {
      delete process.env.GOOGLE_AUTH_METHOD;

      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result.method).toBe(AuthMethod.OAUTH);
      expect(result.source).toContain('ADC not available');
    });

    it('should throw error when GOOGLE_AUTH_METHOD=gcloud but ADC invalid', async () => {
      process.env.GOOGLE_AUTH_METHOD = 'gcloud';

      // This test will fail until implementation exists
      await expect(selectAuthMethod(requiredScopes)).rejects.toThrow();
      await expect(selectAuthMethod(requiredScopes)).rejects.toThrow(/gcloud/i);
    });

    it('should include account email in CredentialSource when available', async () => {
      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result).toHaveProperty('accountEmail');
    });

    it('should include scopes in CredentialSource', async () => {
      // This test will fail until implementation exists
      const result = await selectAuthMethod(requiredScopes);

      expect(result.scopes).toBeDefined();
      expect(Array.isArray(result.scopes)).toBe(true);
      expect(result.scopes.length).toBeGreaterThan(0);
    });
  });
});
