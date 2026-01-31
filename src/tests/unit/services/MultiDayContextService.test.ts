import { describe, it, expect, beforeEach } from 'vitest';
import { MultiDayContextService } from '../../../services/multi-day-context/MultiDayContextService.js';
import { StructuredEvent } from '../../../types/structured-responses.js';

describe('MultiDayContextService', () => {
  let service: MultiDayContextService;

  beforeEach(() => {
    service = new MultiDayContextService();
  });

  describe('buildMultiDayContext', () => {
    it('should create context with empty events', () => {
      const context = service.buildMultiDayContext([], 'America/Los_Angeles');

      expect(context.dates).toEqual([]);
      expect(context.eventsByDate).toEqual({});
      expect(context.totalEventCount).toBe(0);
      expect(context.timezone).toBe('America/Los_Angeles');
      expect(context.calendarLink).toBe('https://calendar.google.com/calendar');
    });

    it('should group events by date', () => {
      const events: StructuredEvent[] = [
        createEvent('1', 'Event 1', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
        createEvent('2', 'Event 2', '2025-01-15T14:00:00', '2025-01-15T15:00:00'),
        createEvent('3', 'Event 3', '2025-01-16T09:00:00', '2025-01-16T10:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      expect(context.dates).toEqual(['2025-01-15', '2025-01-16']);
      expect(context.eventsByDate['2025-01-15'].length).toBe(2);
      expect(context.eventsByDate['2025-01-16'].length).toBe(1);
      expect(context.totalEventCount).toBe(3);
    });

    it('should sort all-day events before timed events within a day', () => {
      const events: StructuredEvent[] = [
        createEvent('1', 'Timed Event', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
        createAllDayEvent('2', 'All Day Event', '2025-01-15', '2025-01-16'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      const dayEvents = context.eventsByDate['2025-01-15'];
      expect(dayEvents[0].summary).toBe('All Day Event');
      expect(dayEvents[0].isAllDay).toBe(true);
      expect(dayEvents[1].summary).toBe('Timed Event');
      expect(dayEvents[1].isAllDay).toBe(false);
    });

    it('should sort timed events by start time', () => {
      // Use UTC-qualified timestamps to ensure consistent date extraction
      const events: StructuredEvent[] = [
        createEvent('1', 'Late Event', '2025-01-15T16:00:00Z', '2025-01-15T17:00:00Z'),
        createEvent('2', 'Early Event', '2025-01-15T08:00:00Z', '2025-01-15T09:00:00Z'),
        createEvent('3', 'Mid Event', '2025-01-15T12:00:00Z', '2025-01-15T13:00:00Z'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      const dayEvents = context.eventsByDate['2025-01-15'];
      expect(dayEvents).toHaveLength(3);
      expect(dayEvents[0].summary).toBe('Early Event');
      expect(dayEvents[1].summary).toBe('Mid Event');
      expect(dayEvents[2].summary).toBe('Late Event');
    });

    it('should include timeRange when provided', () => {
      const events: StructuredEvent[] = [
        createEvent('1', 'Event', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC', {
        timeRange: { start: '2025-01-01T00:00:00Z', end: '2025-01-31T23:59:59Z' }
      });

      expect(context.timeRange).toEqual({
        start: '2025-01-01T00:00:00Z',
        end: '2025-01-31T23:59:59Z'
      });
    });

    it('should include query when provided', () => {
      const events: StructuredEvent[] = [
        createEvent('1', 'Meeting', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC', {
        query: 'meeting'
      });

      expect(context.query).toBe('meeting');
    });

    it('should include focusEventId when provided', () => {
      const events: StructuredEvent[] = [
        createEvent('event-123', 'Focus Event', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC', {
        focusEventId: 'event-123'
      });

      expect(context.focusEventId).toBe('event-123');
    });

    it('should generate calendar link with first date', () => {
      const events: StructuredEvent[] = [
        createEvent('1', 'Event', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      expect(context.calendarLink).toBe('https://calendar.google.com/calendar/r/week/2025/01/15');
    });

    it('should preserve event colors in output', () => {
      const events: StructuredEvent[] = [
        {
          ...createEvent('1', 'Colored Event', '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
          backgroundColor: '#7986cb',
          foregroundColor: '#ffffff',
        },
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      const dayEvents = context.eventsByDate['2025-01-15'];
      expect(dayEvents[0].backgroundColor).toBe('#7986cb');
      expect(dayEvents[0].foregroundColor).toBe('#ffffff');
    });

    it('should handle events without title', () => {
      const events: StructuredEvent[] = [
        createEvent('1', undefined as any, '2025-01-15T10:00:00', '2025-01-15T11:00:00'),
      ];

      const context = service.buildMultiDayContext(events, 'UTC');

      const dayEvents = context.eventsByDate['2025-01-15'];
      expect(dayEvents[0].summary).toBe('(No title)');
    });
  });

  describe('groupEventsByDate', () => {
    it('should group events by their start date', () => {
      const events = [
        { id: '1', summary: 'Event 1', start: '2025-01-15T10:00:00', end: '2025-01-15T11:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
        { id: '2', summary: 'Event 2', start: '2025-01-15T14:00:00', end: '2025-01-15T15:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
        { id: '3', summary: 'Event 3', start: '2025-01-16T09:00:00', end: '2025-01-16T10:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
      ];

      const grouped = service.groupEventsByDate(events, 'UTC');

      expect(Object.keys(grouped)).toEqual(['2025-01-15', '2025-01-16']);
      expect(grouped['2025-01-15'].length).toBe(2);
      expect(grouped['2025-01-16'].length).toBe(1);
    });

    it('should handle all-day events (date format)', () => {
      const events = [
        { id: '1', summary: 'All Day', start: '2025-01-15', end: '2025-01-16', isAllDay: true, htmlLink: '', calendarId: 'primary' },
      ];

      const grouped = service.groupEventsByDate(events, 'UTC');

      expect(Object.keys(grouped)).toEqual(['2025-01-15']);
      expect(grouped['2025-01-15'][0].summary).toBe('All Day');
    });
  });

  describe('sortEventsWithinDate', () => {
    it('should put all-day events first', () => {
      const events = [
        { id: '1', summary: 'Timed', start: '2025-01-15T10:00:00', end: '2025-01-15T11:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
        { id: '2', summary: 'All Day', start: '2025-01-15', end: '2025-01-16', isAllDay: true, htmlLink: '', calendarId: 'primary' },
      ];

      const sorted = service.sortEventsWithinDate(events);

      expect(sorted[0].summary).toBe('All Day');
      expect(sorted[1].summary).toBe('Timed');
    });

    it('should sort timed events by start time', () => {
      const events = [
        { id: '1', summary: 'Late', start: '2025-01-15T16:00:00', end: '2025-01-15T17:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
        { id: '2', summary: 'Early', start: '2025-01-15T08:00:00', end: '2025-01-15T09:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
      ];

      const sorted = service.sortEventsWithinDate(events);

      expect(sorted[0].summary).toBe('Early');
      expect(sorted[1].summary).toBe('Late');
    });

    it('should not mutate original array', () => {
      const events = [
        { id: '1', summary: 'Late', start: '2025-01-15T16:00:00', end: '2025-01-15T17:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
        { id: '2', summary: 'Early', start: '2025-01-15T08:00:00', end: '2025-01-15T09:00:00', isAllDay: false, htmlLink: '', calendarId: 'primary' },
      ];

      service.sortEventsWithinDate(events);

      expect(events[0].summary).toBe('Late'); // Original unchanged
    });
  });

  describe('Timezone Edge Cases', () => {
    describe('Date format handling', () => {
      it('should handle plain date format (YYYY-MM-DD)', () => {
        const events: StructuredEvent[] = [
          createAllDayEvent('1', 'All Day Event', '2025-01-15', '2025-01-16'),
        ];

        const context = service.buildMultiDayContext(events, 'America/Los_Angeles');

        expect(context.dates).toEqual(['2025-01-15']);
        expect(context.eventsByDate['2025-01-15']).toHaveLength(1);
      });

      it('should handle ISO datetime with timezone offset', () => {
        const events: StructuredEvent[] = [
          createEvent('1', 'Event', '2025-01-15T10:00:00-08:00', '2025-01-15T11:00:00-08:00'),
        ];

        const context = service.buildMultiDayContext(events, 'America/Los_Angeles');

        expect(context.dates).toEqual(['2025-01-15']);
        expect(context.eventsByDate['2025-01-15']).toHaveLength(1);
      });

      it('should handle ISO datetime without timezone (Z format)', () => {
        const events: StructuredEvent[] = [
          createEvent('1', 'Event', '2025-01-15T18:00:00Z', '2025-01-15T19:00:00Z'),
        ];

        const context = service.buildMultiDayContext(events, 'UTC');

        expect(context.dates).toEqual(['2025-01-15']);
        expect(context.eventsByDate['2025-01-15']).toHaveLength(1);
      });
    });

    describe('Invalid date parsing', () => {
      it('should fallback gracefully on malformed datetime strings', () => {
        const events: StructuredEvent[] = [
          createEvent('1', 'Bad Date Event', 'invalid-datetime', '2025-01-15T10:00:00'),
        ];

        // Should not crash, should use fallback logic (split on T)
        expect(() => {
          service.buildMultiDayContext(events, 'UTC');
        }).not.toThrow();
      });

      it('should handle datetime with T but invalid date components', () => {
        const events: StructuredEvent[] = [
          createEvent('1', 'Event', '2025-99-99T10:00:00', '2025-01-15T11:00:00'),
        ];

        const context = service.buildMultiDayContext(events, 'UTC');

        // Should use fallback: split on T to get '2025-99-99'
        expect(context.dates).toContain('2025-99-99');
      });

      it('should handle completely malformed strings without T', () => {
        const events: StructuredEvent[] = [
          createEvent('1', 'Event', 'not-a-date-at-all', '2025-01-15T11:00:00'),
        ];

        // Should not crash
        expect(() => {
          service.buildMultiDayContext(events, 'UTC');
        }).not.toThrow();
      });
    });

    describe('Midnight timezone edge cases', () => {
      it('should group event at 23:59 to correct date in timezone', () => {
        // Event: 2025-01-15T23:59:00-08:00 (11:59 PM Pacific on Jan 15)
        // This is 2025-01-16T07:59:00Z (7:59 AM UTC on Jan 16)
        const events: StructuredEvent[] = [
          createEvent('1', 'Late Night Event', '2025-01-15T23:59:00-08:00', '2025-01-16T00:30:00-08:00'),
        ];

        // Should group to 2025-01-15 in America/Los_Angeles
        const contextLA = service.buildMultiDayContext(events, 'America/Los_Angeles');
        expect(contextLA.dates).toEqual(['2025-01-15']);
        expect(contextLA.eventsByDate['2025-01-15']).toHaveLength(1);

        // Should group to 2025-01-16 in UTC (different date!)
        const contextUTC = service.buildMultiDayContext(events, 'UTC');
        expect(contextUTC.dates).toEqual(['2025-01-16']);
        expect(contextUTC.eventsByDate['2025-01-16']).toHaveLength(1);
      });

      it('should group event at 00:01 to correct date in timezone', () => {
        // Event: 2025-01-16T00:01:00-08:00 (12:01 AM Pacific on Jan 16)
        // This is 2025-01-16T08:01:00Z (8:01 AM UTC on Jan 16)
        const events: StructuredEvent[] = [
          createEvent('1', 'Early Morning Event', '2025-01-16T00:01:00-08:00', '2025-01-16T01:00:00-08:00'),
        ];

        // Should group to 2025-01-16 in both timezones
        const contextLA = service.buildMultiDayContext(events, 'America/Los_Angeles');
        expect(contextLA.dates).toEqual(['2025-01-16']);

        const contextUTC = service.buildMultiDayContext(events, 'UTC');
        expect(contextUTC.dates).toEqual(['2025-01-16']);
      });

      it('should handle event crossing midnight in different timezones', () => {
        // Event: 2025-01-15T23:30:00-08:00 to 2025-01-16T00:30:00-08:00
        // Start: 11:30 PM Pacific on Jan 15 (7:30 AM UTC on Jan 16)
        // End: 12:30 AM Pacific on Jan 16 (8:30 AM UTC on Jan 16)
        const events: StructuredEvent[] = [
          createEvent('1', 'Midnight Crosser', '2025-01-15T23:30:00-08:00', '2025-01-16T00:30:00-08:00'),
        ];

        // In Pacific: starts on Jan 15
        const contextLA = service.buildMultiDayContext(events, 'America/Los_Angeles');
        expect(contextLA.dates).toEqual(['2025-01-15']);

        // In UTC: starts on Jan 16
        const contextUTC = service.buildMultiDayContext(events, 'UTC');
        expect(contextUTC.dates).toEqual(['2025-01-16']);
      });

      it('should handle multi-timezone scenarios (PST, UTC, JST)', () => {
        // Same UTC moment viewed in three timezones
        // 2025-01-16T08:00:00Z
        // = 2025-01-16T00:00:00-08:00 (PST - midnight Jan 16)
        // = 2025-01-16T08:00:00+00:00 (UTC - 8am Jan 16)
        // = 2025-01-16T17:00:00+09:00 (JST - 5pm Jan 16)
        const events: StructuredEvent[] = [
          createEvent('1', 'Global Event', '2025-01-16T08:00:00Z', '2025-01-16T09:00:00Z'),
        ];

        // All should show Jan 16, but this tests timezone parsing doesn't break
        const contextPST = service.buildMultiDayContext(events, 'America/Los_Angeles');
        expect(contextPST.dates).toEqual(['2025-01-16']);

        const contextUTC = service.buildMultiDayContext(events, 'UTC');
        expect(contextUTC.dates).toEqual(['2025-01-16']);

        const contextJST = service.buildMultiDayContext(events, 'Asia/Tokyo');
        expect(contextJST.dates).toEqual(['2025-01-16']);
      });

      it('should correctly group event that is on different date in UTC vs PST', () => {
        // Event at 2025-01-15T01:00:00Z (1 AM UTC on Jan 15)
        // In PST (UTC-8): 2025-01-14T17:00:00-08:00 (5 PM on Jan 14)
        const events: StructuredEvent[] = [
          createEvent('1', 'Cross-Day Event', '2025-01-15T01:00:00Z', '2025-01-15T02:00:00Z'),
        ];

        // Should be Jan 15 in UTC
        const contextUTC = service.buildMultiDayContext(events, 'UTC');
        expect(contextUTC.dates).toEqual(['2025-01-15']);

        // Should be Jan 14 in PST
        const contextPST = service.buildMultiDayContext(events, 'America/Los_Angeles');
        expect(contextPST.dates).toEqual(['2025-01-14']);
      });
    });
  });
});

// Helper functions for creating test events
function createEvent(id: string, summary: string, startDateTime: string, endDateTime: string): StructuredEvent {
  return {
    id,
    summary,
    start: { dateTime: startDateTime },
    end: { dateTime: endDateTime },
    calendarId: 'primary',
  };
}

function createAllDayEvent(id: string, summary: string, startDate: string, endDate: string): StructuredEvent {
  return {
    id,
    summary,
    start: { date: startDate },
    end: { date: endDate },
    calendarId: 'primary',
  };
}
