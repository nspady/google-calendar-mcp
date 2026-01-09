import { describe, it, expect } from 'vitest';
import { hasTimezoneInDatetime, convertToRFC3339, createTimeObject } from '../../../utils/datetime.js';

describe('Datetime Utilities', () => {
  describe('hasTimezoneInDatetime', () => {
    it('should return true for timezone-aware datetime strings', () => {
      expect(hasTimezoneInDatetime('2024-01-01T10:00:00Z')).toBe(true);
      expect(hasTimezoneInDatetime('2024-01-01T10:00:00+05:00')).toBe(true);
      expect(hasTimezoneInDatetime('2024-01-01T10:00:00-08:00')).toBe(true);
    });

    it('should return false for timezone-naive datetime strings', () => {
      expect(hasTimezoneInDatetime('2024-01-01T10:00:00')).toBe(false);
      expect(hasTimezoneInDatetime('2024-01-01 10:00:00')).toBe(false);
    });
  });

  describe('convertToRFC3339', () => {
    it('should return timezone-aware datetime unchanged', () => {
      const datetime = '2024-01-01T10:00:00Z';
      expect(convertToRFC3339(datetime, 'America/Los_Angeles')).toBe(datetime);
    });

    it('should return timezone-aware datetime with offset unchanged', () => {
      const datetime = '2024-01-01T10:00:00-08:00';
      expect(convertToRFC3339(datetime, 'America/Los_Angeles')).toBe(datetime);
    });

    it('should convert timezone-naive datetime using fallback timezone', () => {
      const datetime = '2024-06-15T14:30:00';
      const result = convertToRFC3339(datetime, 'UTC');
      
      // Should result in a timezone-aware string (the exact time depends on system timezone)
      expect(result).toMatch(/2024-06-15T\d{2}:\d{2}:\d{2}Z/);
      expect(result).not.toBe(datetime); // Should be different from input
    });

    it('should fallback to UTC for invalid timezone conversion', () => {
      const datetime = '2024-01-01T10:00:00';
      const result = convertToRFC3339(datetime, 'Invalid/Timezone');
      
      // Should fallback to UTC
      expect(result).toBe('2024-01-01T10:00:00Z');
    });
  });

  describe('createTimeObject', () => {
    it('should create time object without timeZone for timezone-aware datetime', () => {
      const datetime = '2024-01-01T10:00:00Z';
      const result = createTimeObject(datetime, 'America/Los_Angeles');
      
      expect(result).toEqual({
        dateTime: datetime
      });
    });

    it('should create time object with timeZone for timezone-naive datetime', () => {
      const datetime = '2024-01-01T10:00:00';
      const timezone = 'America/Los_Angeles';
      const result = createTimeObject(datetime, timezone);
      
      expect(result).toEqual({
        dateTime: datetime,
        timeZone: timezone
      });
    });
  });
});