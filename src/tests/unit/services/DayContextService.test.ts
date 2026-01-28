import { describe, it, expect, beforeEach } from 'vitest';
import { DayContextService } from '../../../services/day-context/DayContextService.js';
import { StructuredEvent } from '../../../types/structured-responses.js';

describe('DayContextService', () => {
  let service: DayContextService;

  beforeEach(() => {
    service = new DayContextService();
  });

  describe('calculateTimeRange', () => {
    it('should add 1 hour buffer on each side of events', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
        createEvent('2', '2026-01-27T14:00:00', '2026-01-27T15:00:00'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(9);  // 10:00 - 1 hour
      expect(range.endHour).toBe(16);   // 15:00 + 1 hour
    });

    it('should handle all-day events by using default range', () => {
      const events: StructuredEvent[] = [
        createAllDayEvent('1', '2026-01-27'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(8);   // Default start
      expect(range.endHour).toBe(18);    // Default end
    });

    it('should not go below hour 0 or above hour 24', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T00:30:00', '2026-01-27T23:30:00'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(0);
      expect(range.endHour).toBe(24);
    });

    it('should return default range when no events', () => {
      const range = service.calculateTimeRange([]);

      expect(range.startHour).toBe(8);
      expect(range.endHour).toBe(18);
    });

    it('should handle events ending exactly on the hour', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
      ];

      const range = service.calculateTimeRange(events);

      // Event ends at 11:00 exactly, so endHour is 11 + 1 buffer = 12
      expect(range.startHour).toBe(9);
      expect(range.endHour).toBe(12);
    });

    it('should handle events ending with minutes past the hour', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T10:00:00', '2026-01-27T11:30:00'),
      ];

      const range = service.calculateTimeRange(events);

      // Event ends at 11:30, so we need hour 12 visible, plus 1 buffer = 13
      expect(range.startHour).toBe(9);
      expect(range.endHour).toBe(13);
    });
  });

  describe('buildDayContext', () => {
    it('should build context with focus event centered', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createEvent('other-1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
      ];

      const context = service.buildDayContext(
        focusEvent,
        otherEvents,
        'America/Los_Angeles'
      );

      expect(context.focusEventId).toBe('focus-123');
      expect(context.date).toBe('2026-01-27');
      expect(context.events).toHaveLength(2);
      expect(context.timezone).toBe('America/Los_Angeles');
    });

    it('should separate all-day events', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createAllDayEvent('allday-1', '2026-01-27'),
      ];

      const context = service.buildDayContext(focusEvent, otherEvents, 'UTC');
      const allDayEvents = context.events.filter(e => e.isAllDay);
      const timedEvents = context.events.filter(e => !e.isAllDay);

      expect(allDayEvents).toHaveLength(1);
      expect(timedEvents).toHaveLength(1);
    });

    it('should deduplicate events by ID', () => {
      const focusEvent: StructuredEvent = createEvent(
        'event-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      // Same event ID appears in surrounding events
      const otherEvents: StructuredEvent[] = [
        createEvent('event-123', '2026-01-27T14:00:00', '2026-01-27T15:00:00'),
        createEvent('other-1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
      ];

      const context = service.buildDayContext(focusEvent, otherEvents, 'UTC');

      expect(context.events).toHaveLength(2); // Not 3
    });

    it('should sort events with all-day first, then by start time', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createEvent('later', '2026-01-27T16:00:00', '2026-01-27T17:00:00'),
        createAllDayEvent('allday', '2026-01-27'),
        createEvent('earlier', '2026-01-27T09:00:00', '2026-01-27T10:00:00'),
      ];

      const context = service.buildDayContext(focusEvent, otherEvents, 'UTC');

      expect(context.events[0].id).toBe('allday');  // All-day first
      expect(context.events[1].id).toBe('earlier'); // Then earliest timed
      expect(context.events[2].id).toBe('focus-123');
      expect(context.events[3].id).toBe('later');
    });

    it('should generate correct day link', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );

      const context = service.buildDayContext(focusEvent, [], 'UTC');

      expect(context.dayLink).toBe('https://calendar.google.com/calendar/r/day/2026/01/27');
    });

    it('should calculate time range from all events', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createEvent('earlier', '2026-01-27T09:00:00', '2026-01-27T10:00:00'),
      ];

      const context = service.buildDayContext(focusEvent, otherEvents, 'UTC');

      expect(context.timeRange.startHour).toBe(8);  // 9 - 1 buffer
      expect(context.timeRange.endHour).toBe(16);   // 15 + 1 buffer
    });

    it('should extract date from all-day focus event', () => {
      const focusEvent: StructuredEvent = createAllDayEvent('focus-123', '2026-01-27');

      const context = service.buildDayContext(focusEvent, [], 'UTC');

      expect(context.date).toBe('2026-01-27');
    });
  });
});

// Test helpers
function createEvent(id: string, start: string, end: string): StructuredEvent {
  return {
    id,
    summary: `Event ${id}`,
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    calendarId: 'primary',
  };
}

function createAllDayEvent(id: string, date: string): StructuredEvent {
  return {
    id,
    summary: `All Day ${id}`,
    start: { date },
    end: { date },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    calendarId: 'primary',
  };
}
