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
    });
  });
});
