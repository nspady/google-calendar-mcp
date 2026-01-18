import { describe, it, expect } from 'vitest';
import { convertGoogleEventToStructured, StructuredEvent } from '../../../types/structured-responses.js';
import { calendar_v3 } from 'googleapis';

describe('structured-responses', () => {
  describe('convertGoogleEventToStructured', () => {
    describe('startDayOfWeek and endDayOfWeek', () => {
      it('should derive day of week from dateTime with timezone', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-1',
          summary: 'Test Event',
          start: {
            dateTime: '2026-01-19T13:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: '2026-01-19T14:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // January 19, 2026 is a Monday
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Monday');
      });

      it('should derive day of week from date-only (all-day event)', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-2',
          summary: 'All Day Event',
          start: {
            date: '2026-01-20'
          },
          end: {
            date: '2026-01-21'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // January 20, 2026 is a Tuesday
        expect(result.startDayOfWeek).toBe('Tuesday');
        // January 21, 2026 is a Wednesday
        expect(result.endDayOfWeek).toBe('Wednesday');
      });

      it('should handle events spanning different days', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-3',
          summary: 'Multi-day Event',
          start: {
            dateTime: '2026-01-17T18:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: '2026-01-19T12:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // January 17, 2026 is a Saturday
        expect(result.startDayOfWeek).toBe('Saturday');
        // January 19, 2026 is a Monday
        expect(result.endDayOfWeek).toBe('Monday');
      });

      it('should return undefined when start/end is missing', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-4',
          summary: 'Event without dates'
        };

        const result = convertGoogleEventToStructured(event);

        expect(result.startDayOfWeek).toBeUndefined();
        expect(result.endDayOfWeek).toBeUndefined();
      });

      it('should handle different timezones correctly', () => {
        // This event is at 1 AM UTC on January 20
        // In America/New_York (UTC-5), this is still January 19 at 8 PM
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-5',
          summary: 'Timezone Test Event',
          start: {
            dateTime: '2026-01-20T01:00:00Z',
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: '2026-01-20T02:00:00Z',
            timeZone: 'America/New_York'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // In New York timezone, this is Monday evening (Jan 19)
        // Note: The function uses the provided timeZone for formatting
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Monday');
      });

      it('should preserve all other fields while adding day of week', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-6',
          summary: 'Full Event',
          description: 'Test description',
          location: 'Test Location',
          start: {
            dateTime: '2026-01-21T10:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: '2026-01-21T11:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          },
          status: 'confirmed',
          colorId: '1'
        };

        const result = convertGoogleEventToStructured(event, 'primary', 'test-account');

        expect(result.id).toBe('test-event-6');
        expect(result.summary).toBe('Full Event');
        expect(result.description).toBe('Test description');
        expect(result.location).toBe('Test Location');
        expect(result.status).toBe('confirmed');
        expect(result.colorId).toBe('1');
        expect(result.calendarId).toBe('primary');
        expect(result.accountId).toBe('test-account');
        // January 21, 2026 is a Wednesday
        expect(result.startDayOfWeek).toBe('Wednesday');
        expect(result.endDayOfWeek).toBe('Wednesday');
      });

      it('should handle weekend dates correctly', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-7',
          summary: 'Weekend Event',
          start: {
            date: '2026-01-24'  // Saturday
          },
          end: {
            date: '2026-01-26'  // Monday (end date is exclusive for all-day)
          }
        };

        const result = convertGoogleEventToStructured(event);

        expect(result.startDayOfWeek).toBe('Saturday');
        // End date in all-day events is exclusive, but we still derive the day
        expect(result.endDayOfWeek).toBe('Monday');
      });

      // Additional edge case tests for timezone handling

      it('should handle event at midnight UTC showing different day in western timezone', () => {
        // Event at exactly midnight UTC on January 20
        // In Los Angeles (UTC-8), this is January 19 at 4 PM
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-midnight-utc',
          summary: 'Midnight UTC Event',
          start: {
            dateTime: '2026-01-20T00:00:00Z',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: '2026-01-20T01:00:00Z',
            timeZone: 'America/Los_Angeles'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // In Los Angeles, midnight UTC on Jan 20 is 4 PM on Jan 19 (Monday)
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Monday');
      });

      it('should handle timezone with non-hour offset (India UTC+5:30)', () => {
        // Event at 2:00 AM UTC on January 20
        // In India (UTC+5:30), this is 7:30 AM on January 20
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-india',
          summary: 'India Timezone Event',
          start: {
            dateTime: '2026-01-20T02:00:00Z',
            timeZone: 'Asia/Kolkata'
          },
          end: {
            dateTime: '2026-01-20T03:00:00Z',
            timeZone: 'Asia/Kolkata'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // In Kolkata, 2 AM UTC on Jan 20 is 7:30 AM on Jan 20 (Tuesday)
        expect(result.startDayOfWeek).toBe('Tuesday');
        expect(result.endDayOfWeek).toBe('Tuesday');
      });

      it('should handle timezone with 45-minute offset (Nepal UTC+5:45)', () => {
        // Event at 18:00 UTC on January 19
        // In Nepal (UTC+5:45), this is 23:45 on January 19
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-nepal',
          summary: 'Nepal Timezone Event',
          start: {
            dateTime: '2026-01-19T18:00:00Z',
            timeZone: 'Asia/Kathmandu'
          },
          end: {
            dateTime: '2026-01-19T19:00:00Z',
            timeZone: 'Asia/Kathmandu'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // In Kathmandu, 18:00 UTC on Jan 19 is 23:45 on Jan 19 (Monday)
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Tuesday'); // 19:00 UTC = 00:45 Jan 20
      });

      it('should gracefully handle invalid timezone by returning undefined', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-invalid-tz',
          summary: 'Invalid Timezone Event',
          start: {
            dateTime: '2026-01-20T10:00:00Z',
            timeZone: 'Invalid/Timezone'
          },
          end: {
            dateTime: '2026-01-20T11:00:00Z',
            timeZone: 'Invalid/Timezone'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // Invalid timezone should result in undefined (graceful degradation)
        expect(result.startDayOfWeek).toBeUndefined();
        expect(result.endDayOfWeek).toBeUndefined();
      });

      it('should handle invalid date string by returning undefined', () => {
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-invalid-date',
          summary: 'Invalid Date Event',
          start: {
            dateTime: 'not-a-valid-date',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: 'also-invalid',
            timeZone: 'America/Los_Angeles'
          }
        };

        const result = convertGoogleEventToStructured(event);

        expect(result.startDayOfWeek).toBeUndefined();
        expect(result.endDayOfWeek).toBeUndefined();
      });

      it('should handle event crossing date boundary in local timezone', () => {
        // Event starts at 11 PM and ends at 1 AM the next day
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-overnight',
          summary: 'Overnight Event',
          start: {
            dateTime: '2026-01-19T23:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: '2026-01-20T01:00:00-08:00',
            timeZone: 'America/Los_Angeles'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // Starts on Monday (Jan 19), ends on Tuesday (Jan 20)
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Tuesday');
      });

      it('should handle far eastern timezone (Pacific/Auckland +13)', () => {
        // Event at 10:00 UTC on January 19
        // In Auckland (UTC+13 in Jan), this is 23:00 on January 19
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-auckland',
          summary: 'Auckland Timezone Event',
          start: {
            dateTime: '2026-01-19T10:00:00Z',
            timeZone: 'Pacific/Auckland'
          },
          end: {
            dateTime: '2026-01-19T12:00:00Z',
            timeZone: 'Pacific/Auckland'
          }
        };

        const result = convertGoogleEventToStructured(event);

        // In Auckland (NZDT, UTC+13), 10:00 UTC = 23:00 local (Monday)
        // End at 12:00 UTC = 01:00 Jan 20 local (Tuesday)
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Tuesday');
      });

      it('should handle all-day event without timezone (uses UTC)', () => {
        // All-day events typically don't have timezone
        // The date should be interpreted consistently
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-allday-no-tz',
          summary: 'All Day Without Timezone',
          start: {
            date: '2026-01-22'  // Thursday
          },
          end: {
            date: '2026-01-23'  // Friday
          }
        };

        const result = convertGoogleEventToStructured(event);

        // Date-only strings are interpreted as midnight UTC
        // Jan 22, 2026 is a Thursday
        expect(result.startDayOfWeek).toBe('Thursday');
        expect(result.endDayOfWeek).toBe('Friday');
      });

      it('should handle dateTime with offset but WITHOUT timeZone field', () => {
        // Edge case: Google API sometimes returns dateTime with offset but no timeZone field.
        // When timeZone is absent, we should extract the local date from the ISO string
        // to determine the correct day-of-week, NOT convert to UTC.
        //
        // This event is at 11 PM Pacific on Monday (Jan 19).
        // If we incorrectly default to UTC, this becomes 7 AM UTC on Tuesday (Jan 20).
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-offset-no-tz',
          summary: 'Late Night Event Without Timezone Field',
          start: {
            dateTime: '2026-01-19T23:00:00-08:00'
            // Note: NO timeZone field - this is the edge case
          },
          end: {
            dateTime: '2026-01-20T00:30:00-08:00'
            // Note: NO timeZone field
          }
        };

        const result = convertGoogleEventToStructured(event);

        // The local date in the ISO string is 2026-01-19, which is Monday
        // This should NOT be Tuesday (which would happen if we defaulted to UTC)
        expect(result.startDayOfWeek).toBe('Monday');
        // End time crosses midnight, local date is 2026-01-20, which is Tuesday
        expect(result.endDayOfWeek).toBe('Tuesday');
      });

      it('should handle dateTime with positive offset but WITHOUT timeZone field', () => {
        // Similar edge case but with positive offset (e.g., India +05:30)
        // Event at 11:30 PM IST on Monday (Jan 19)
        const event: calendar_v3.Schema$Event = {
          id: 'test-event-positive-offset-no-tz',
          summary: 'Late Night India Event Without Timezone Field',
          start: {
            dateTime: '2026-01-19T23:30:00+05:30'
            // Note: NO timeZone field
          },
          end: {
            dateTime: '2026-01-20T00:30:00+05:30'
            // Note: NO timeZone field
          }
        };

        const result = convertGoogleEventToStructured(event);

        // The local date in the ISO string is 2026-01-19, which is Monday
        expect(result.startDayOfWeek).toBe('Monday');
        expect(result.endDayOfWeek).toBe('Tuesday');
      });
    });
  });
});
