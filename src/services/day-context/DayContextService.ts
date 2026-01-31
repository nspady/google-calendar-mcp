import { StructuredEvent } from '../../types/structured-responses.js';
import { DayContext, DayViewEvent, toDayViewEvent } from '../../types/day-context.js';

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
const BUFFER_HOURS = 1;

/**
 * Service for building day context data for the day view UI.
 * Handles time range calculations and event organization.
 */
export class DayContextService {
  /**
   * Calculate the time range to display based on events.
   * Adds a buffer hour on each side of the event range.
   */
  calculateTimeRange(events: StructuredEvent[]): { startHour: number; endHour: number } {
    const timedEvents = events.filter(e => e.start.dateTime);

    if (timedEvents.length === 0) {
      return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    }

    let minHour = 24;
    let maxHour = 0;

    for (const event of timedEvents) {
      if (event.start.dateTime) {
        const startHour = new Date(event.start.dateTime).getHours();
        minHour = Math.min(minHour, startHour);
      }
      if (event.end.dateTime) {
        const endHour = new Date(event.end.dateTime).getHours();
        const endMinutes = new Date(event.end.dateTime).getMinutes();
        // If event ends with minutes past the hour, we need to show that hour
        maxHour = Math.max(maxHour, endMinutes > 0 ? endHour + 1 : endHour);
      }
    }

    return {
      startHour: Math.max(0, minHour - BUFFER_HOURS),
      endHour: Math.min(24, maxHour + BUFFER_HOURS),
    };
  }

  /**
   * Build the day context for list operations (no focus event).
   * Used when listing events for a single day.
   */
  buildDayContextForList(
    events: StructuredEvent[],
    date: string,
    timezone: string
  ): DayContext {
    // Convert to day view events
    const dayViewEvents: DayViewEvent[] = events.map(toDayViewEvent);

    // Sort: all-day first, then by start time
    dayViewEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start.localeCompare(b.start);
    });

    // Calculate time range
    const timeRange = this.calculateTimeRange(events);

    // Build Google Calendar day link
    const dayLink = `https://calendar.google.com/calendar/r/day/${date.replace(/-/g, '/')}`;

    // Use first event as focus, or empty string if no events
    const focusEventId = dayViewEvents.length > 0 ? dayViewEvents[0].id : '';

    return {
      date,
      timezone,
      events: dayViewEvents,
      focusEventId,
      timeRange,
      dayLink,
    };
  }

  /**
   * Build the day context for the UI.
   * Combines focus event with surrounding events, deduplicates, and organizes them.
   */
  buildDayContext(
    focusEvent: StructuredEvent,
    surroundingEvents: StructuredEvent[],
    timezone: string
  ): DayContext {
    // Extract date from focus event
    const dateStr = focusEvent.start.dateTime || focusEvent.start.date || '';
    const date = dateStr.split('T')[0];

    // Combine focus event with surrounding events, deduplicate by ID
    const eventMap = new Map<string, StructuredEvent>();
    eventMap.set(focusEvent.id, focusEvent);
    for (const event of surroundingEvents) {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }
    const allEvents = Array.from(eventMap.values());

    // Convert to day view events
    const dayViewEvents: DayViewEvent[] = allEvents.map(toDayViewEvent);

    // Sort: all-day first, then by start time
    dayViewEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start.localeCompare(b.start);
    });

    // Calculate time range
    const timeRange = this.calculateTimeRange(allEvents);

    // Build Google Calendar day link
    const dayLink = `https://calendar.google.com/calendar/r/day/${date.replace(/-/g, '/')}`;

    return {
      date,
      timezone,
      events: dayViewEvents,
      focusEventId: focusEvent.id,
      timeRange,
      dayLink,
    };
  }
}
