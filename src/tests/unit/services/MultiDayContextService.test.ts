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
