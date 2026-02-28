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
    describe('string format (ISO 8601)', () => {
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

      it('should create date object for all-day events (date-only format)', () => {
        const date = '2024-01-01';
        const result = createTimeObject(date, 'America/Los_Angeles');

        expect(result).toEqual({
          date: date
        });
      });

      it('should handle datetime with positive offset', () => {
        const datetime = '2024-01-01T10:00:00+05:30';
        const result = createTimeObject(datetime, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: datetime
        });
      });

      it('should handle datetime with negative offset', () => {
        const datetime = '2024-01-01T10:00:00-08:00';
        const result = createTimeObject(datetime, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: datetime
        });
      });
    });

    describe('JSON object format (per-field timezone)', () => {
      it('should parse JSON with dateTime and timeZone', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00", "timeZone": "America/New_York"}';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: '2024-01-01T10:00:00',
          timeZone: 'America/New_York'  // Uses per-field timezone, not fallback
        });
      });

      it('should parse JSON with dateTime only (uses fallback timezone)', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00"}';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: '2024-01-01T10:00:00',
          timeZone: 'America/Los_Angeles'  // Falls back to provided timezone
        });
      });

      it('should parse JSON with timezone-aware dateTime (ignores timeZone field)', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00Z", "timeZone": "America/New_York"}';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: '2024-01-01T10:00:00Z'  // Embedded timezone takes precedence
        });
      });

      it('should parse JSON with date for all-day events', () => {
        const input = '{"date": "2024-01-01"}';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          date: '2024-01-01'
        });
      });

      it('should throw error for invalid JSON', () => {
        const input = '{invalid json}';

        expect(() => createTimeObject(input, 'America/Los_Angeles'))
          .toThrow('Invalid JSON in time input');
      });

      it('should not echo raw input in invalid JSON error', () => {
        const input = '{sensitive-data-here}';

        try {
          createTimeObject(input, 'America/Los_Angeles');
          expect.fail('Expected error to be thrown');
        } catch (e: any) {
          expect(e.message).toBe('Invalid JSON in time input');
          expect(e.message).not.toContain('sensitive-data-here');
        }
      });

      it('should throw error for JSON with neither date nor dateTime', () => {
        const input = '{"timeZone": "America/New_York"}';

        expect(() => createTimeObject(input, 'America/Los_Angeles'))
          .toThrow('Invalid time object: must have either dateTime or date');
      });

      it('should throw error for JSON with both date and dateTime', () => {
        const input = '{"date": "2024-01-01", "dateTime": "2024-01-01T10:00:00"}';

        expect(() => createTimeObject(input, 'America/Los_Angeles'))
          .toThrow("Cannot specify both 'date' and 'dateTime'");
      });

      it('should throw error for empty timeZone string', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00", "timeZone": ""}';

        expect(() => createTimeObject(input, 'America/Los_Angeles'))
          .toThrow('timeZone cannot be empty');
      });

      it('should throw error for whitespace-only timeZone string', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00", "timeZone": "   "}';

        expect(() => createTimeObject(input, 'America/Los_Angeles'))
          .toThrow('timeZone cannot be empty');
      });

      it('should handle JSON with extra whitespace in values', () => {
        const input = '{"dateTime": "2024-01-01T10:00:00", "timeZone": "America/New_York"}';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result.timeZone).toBe('America/New_York');
      });

      it('should handle JSON with leading/trailing whitespace', () => {
        const input = '  {"dateTime": "2024-01-01T10:00:00", "timeZone": "America/New_York"}  ';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: '2024-01-01T10:00:00',
          timeZone: 'America/New_York'
        });
      });

      it('should handle string datetime with leading/trailing whitespace', () => {
        const input = '  2024-01-01T10:00:00  ';
        const result = createTimeObject(input, 'America/Los_Angeles');

        expect(result).toEqual({
          dateTime: '2024-01-01T10:00:00',
          timeZone: 'America/Los_Angeles'
        });
      });
    });

    describe('flight booking use case (different start/end timezones)', () => {
      it('should support LA to NYC flight with correct timezones', () => {
        // Flight departs LA at 8am Pacific, arrives NYC at 4:30pm Eastern
        const startInput = '{"dateTime": "2024-01-15T08:00:00", "timeZone": "America/Los_Angeles"}';
        const endInput = '{"dateTime": "2024-01-15T16:30:00", "timeZone": "America/New_York"}';

        const startResult = createTimeObject(startInput, 'UTC');
        const endResult = createTimeObject(endInput, 'UTC');

        expect(startResult).toEqual({
          dateTime: '2024-01-15T08:00:00',
          timeZone: 'America/Los_Angeles'
        });
        expect(endResult).toEqual({
          dateTime: '2024-01-15T16:30:00',
          timeZone: 'America/New_York'
        });
      });
    });
  });
});