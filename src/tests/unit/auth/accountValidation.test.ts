import { describe, it, expect } from 'vitest';
import { getAccountMode } from '../../../auth/utils.js';
import { getAccountMode as getAccountModeJS } from '../../../auth/paths.js';

describe('Account ID Validation', () => {
  describe('Valid Account IDs', () => {
    it('should accept "work"', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'work';
      expect(getAccountMode()).toBe('work');
      expect(getAccountModeJS()).toBe('work');
    });

    it('should accept "personal"', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'personal';
      expect(getAccountMode()).toBe('personal');
      expect(getAccountModeJS()).toBe('personal');
    });

    it('should accept "client-abc"', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'client-abc';
      expect(getAccountMode()).toBe('client-abc');
      expect(getAccountModeJS()).toBe('client-abc');
    });

    it('should accept "project_2024"', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'project_2024';
      expect(getAccountMode()).toBe('project_2024');
      expect(getAccountModeJS()).toBe('project_2024');
    });

    it('should accept single character "a"', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'a';
      expect(getAccountMode()).toBe('a');
      expect(getAccountModeJS()).toBe('a');
    });

    it('should accept 64 character account ID', () => {
      const longId = 'a'.repeat(64);
      process.env.GOOGLE_ACCOUNT_MODE = longId;
      expect(getAccountMode()).toBe(longId);
      expect(getAccountModeJS()).toBe(longId);
    });
  });

  describe('Invalid Account IDs - Format', () => {
    it('should reject uppercase letters', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'Work';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject spaces', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'my work';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject special characters', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'work@account';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject forward slashes', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'work/personal';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject path traversal attempts', () => {
      process.env.GOOGLE_ACCOUNT_MODE = '../../../etc/passwd';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject empty string', () => {
      process.env.GOOGLE_ACCOUNT_MODE = '';
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });

    it('should reject account ID longer than 64 characters', () => {
      const tooLong = 'a'.repeat(65);
      process.env.GOOGLE_ACCOUNT_MODE = tooLong;
      expect(() => getAccountMode()).toThrow(/Invalid account ID/i);
      expect(() => getAccountModeJS()).toThrow(/Invalid account ID/i);
    });
  });

  describe('Invalid Account IDs - Reserved Names', () => {
    it('should reject "." (current directory)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = '.';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });

    it('should reject ".." (parent directory)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = '..';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });

    it('should reject "con" (Windows reserved)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'con';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });

    it('should reject "prn" (Windows reserved)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'prn';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });

    it('should reject "aux" (Windows reserved)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'aux';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });

    it('should reject "nul" (Windows reserved)', () => {
      process.env.GOOGLE_ACCOUNT_MODE = 'nul';
      expect(() => getAccountMode()).toThrow(/reserved/i);
      expect(() => getAccountModeJS()).toThrow(/reserved/i);
    });
  });

  describe('Default Behavior', () => {
    it('should default to "normal" when env var not set', () => {
      delete process.env.GOOGLE_ACCOUNT_MODE;
      process.env.NODE_ENV = 'production';
      expect(getAccountMode()).toBe('normal');
      expect(getAccountModeJS()).toBe('normal');
    });

    it('should default to "test" in test environment', () => {
      delete process.env.GOOGLE_ACCOUNT_MODE;
      process.env.NODE_ENV = 'test';
      expect(getAccountMode()).toBe('test');
      expect(getAccountModeJS()).toBe('test');
    });
  });
});
