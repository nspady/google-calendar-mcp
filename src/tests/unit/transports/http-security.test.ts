import { describe, it, expect } from 'vitest';
import { isLocalhostOrigin } from '../../../transports/http.js';

describe('isLocalhostOrigin', () => {
  describe('valid localhost origins', () => {
    it('should accept http://localhost', () => {
      expect(isLocalhostOrigin('http://localhost')).toBe(true);
    });

    it('should accept http://localhost:3000', () => {
      expect(isLocalhostOrigin('http://localhost:3000')).toBe(true);
    });

    it('should accept https://localhost', () => {
      expect(isLocalhostOrigin('https://localhost')).toBe(true);
    });

    it('should accept https://localhost:8080', () => {
      expect(isLocalhostOrigin('https://localhost:8080')).toBe(true);
    });

    it('should accept http://127.0.0.1', () => {
      expect(isLocalhostOrigin('http://127.0.0.1')).toBe(true);
    });

    it('should accept http://127.0.0.1:3000', () => {
      expect(isLocalhostOrigin('http://127.0.0.1:3000')).toBe(true);
    });

    it('should accept https://127.0.0.1', () => {
      expect(isLocalhostOrigin('https://127.0.0.1')).toBe(true);
    });
  });

  describe('subdomain bypass attempts (security critical)', () => {
    it('should reject localhost.attacker.com', () => {
      expect(isLocalhostOrigin('http://localhost.attacker.com')).toBe(false);
    });

    it('should reject localhost.evil.com:3000', () => {
      expect(isLocalhostOrigin('http://localhost.evil.com:3000')).toBe(false);
    });

    it('should reject 127.0.0.1.attacker.com', () => {
      expect(isLocalhostOrigin('http://127.0.0.1.attacker.com')).toBe(false);
    });

    it('should reject localhostevil.com', () => {
      expect(isLocalhostOrigin('http://localhostevil.com')).toBe(false);
    });

    it('should reject subdomain.localhost.attacker.com', () => {
      expect(isLocalhostOrigin('http://subdomain.localhost.attacker.com')).toBe(false);
    });
  });

  describe('other invalid origins', () => {
    it('should reject external domains', () => {
      expect(isLocalhostOrigin('http://example.com')).toBe(false);
    });

    it('should reject external domains with localhost in path', () => {
      expect(isLocalhostOrigin('http://example.com/localhost')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isLocalhostOrigin('not-a-url')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isLocalhostOrigin('')).toBe(false);
    });

    it('should reject other loopback addresses', () => {
      // Only exact 127.0.0.1 is allowed, not other loopback addresses
      expect(isLocalhostOrigin('http://127.0.0.2')).toBe(false);
    });
  });
});
