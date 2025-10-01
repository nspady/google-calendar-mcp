/**
 * Unit tests for ADCDetector
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADCDetector } from '../../../auth/adcDetector.js';
import { OAuth2Client } from 'google-auth-library';

describe('ADCDetector', () => {
  let detector: ADCDetector;

  beforeEach(() => {
    detector = new ADCDetector();
    vi.clearAllMocks();
  });

  describe('getADCPath', () => {
    it('should return correct path for macOS/Linux', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const path = detector.getADCPath();

      expect(path).toContain('.config/gcloud/application_default_credentials.json');
      expect(path).toMatch(/^\/.*\.config\/gcloud\/application_default_credentials\.json$/);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return correct path for Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const path = detector.getADCPath();

      // Use forward slash for path since path.join normalizes separators
      expect(path).toContain('gcloud');
      expect(path).toContain('application_default_credentials.json');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('detectAndValidate', () => {
    const requiredScopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    it('should return valid result with valid ADC credentials', async () => {
      // This test will fail until implementation exists
      const result = await detector.detectAndValidate(requiredScopes);

      expect(result.available).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.oauth2Client).toBeInstanceOf(OAuth2Client);
      expect(result.missingScopes).toEqual([]);
      expect(result.error).toBeNull();
      expect(result.source).toBeTruthy();
    });

    it('should return unavailable result when ADC not found', async () => {
      // This test will fail until implementation exists
      const result = await detector.detectAndValidate(requiredScopes);

      expect(result.available).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.oauth2Client).toBeNull();
      expect(result.missingScopes).toEqual([]);
      expect(result.error).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should return invalid result when ADC lacks required scopes', async () => {
      // This test will fail until implementation exists
      const result = await detector.detectAndValidate(requiredScopes);

      expect(result.available).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.oauth2Client).toBeNull();
      expect(result.missingScopes).toContain('https://www.googleapis.com/auth/calendar');
      expect(result.error).toContain('lack required Calendar API scopes');
      expect(result.source).toBeTruthy();
    });

    it('should return error result when ADC file is corrupted', async () => {
      // This test will fail until implementation exists
      const result = await detector.detectAndValidate(requiredScopes);

      expect(result.available).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.oauth2Client).toBeNull();
      expect(result.error).toContain('Failed to parse');
      expect(result.source).toBeTruthy();
    });

    it('should handle missing scopes gracefully', async () => {
      // This test will fail until implementation exists
      const result = await detector.detectAndValidate(requiredScopes);

      expect(result).toHaveProperty('missingScopes');
      expect(Array.isArray(result.missingScopes)).toBe(true);
    });
  });
});
