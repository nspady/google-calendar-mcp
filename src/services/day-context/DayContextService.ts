import { StructuredEvent } from '../../types/structured-responses.js';
import { DayContext, DayViewEvent, toDayViewEvent } from '../../types/day-context.js';
import { sortViewEvents, buildCalendarLink } from '../../types/view-event.js';

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
const BUFFER_HOURS = 1;

/**
 * Service for building day context data for the day view UI.
 * Handles time range calculations and event organization.
 */
export class DayContextService {
  /**
   * Extract the hour component of a dateTime string in the given timezone.
   * Falls back to local Date parsing if Intl fails.
   */
  private getHourInTimezone(dateTime: string, timezone: string): number {
    const date = new Date(dateTime);
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const hour = Number(parts.find(p => p.type === 'hour')?.value ?? date.getHours());
      return hour === 24 ? 0 : hour;
    } catch {
      return date.getHours();
    }
  }

  /**
   * Extract the minutes component of a dateTime string in the given timezone.
   * Falls back to local Date parsing if Intl fails.
   */
  private getMinutesInTimezone(dateTime: string, timezone: string): number {
    const date = new Date(dateTime);
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        minute: '2-digit',
      }).formatToParts(date);
      return Number(parts.find(p => p.type === 'minute')?.value ?? date.getMinutes());
    } catch {
      return date.getMinutes();
    }
  }

  /**
   * Extract the calendar date (YYYY-MM-DD) of a dateTime string in the given timezone.
   * Used for detecting events that span into the next day.
   */
  private getDatePartsInTimezone(dateTime: string, timezone: string): { year: number; month: number; day: number } {
    const date = new Date(dateTime);
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      return {
        year: Number(parts.find(p => p.type === 'year')?.value),
        month: Number(parts.find(p => p.type === 'month')?.value),
        day: Number(parts.find(p => p.type === 'day')?.value),
      };
    } catch {
      return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
    }
  }

  /**
   * Calculate the time range to display based on events.
   * Adds a buffer hour on each side of the event range.
   * Uses timezone-aware parsing so the grid reflects the user's local time.
   */
  calculateTimeRange(events: StructuredEvent[], timezone: string): { startHour: number; endHour: number } {
    const timedEvents = events.filter(e => e.start.dateTime);

    if (timedEvents.length === 0) {
      return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    }

    let minHour = 24;
    let maxHour = 0;

    for (const event of timedEvents) {
      if (event.start.dateTime) {
        const startHour = this.getHourInTimezone(event.start.dateTime, timezone);
        minHour = Math.min(minHour, startHour);
      }
      if (event.end.dateTime) {
        const endHour = this.getHourInTimezone(event.end.dateTime, timezone);
        const endMinutes = this.getMinutesInTimezone(event.end.dateTime, timezone);

        const spansIntoNextDay = event.start.dateTime
          ? (() => {
              const startParts = this.getDatePartsInTimezone(event.start.dateTime!, timezone);
              const endParts = this.getDatePartsInTimezone(event.end.dateTime!, timezone);
              return startParts.year !== endParts.year ||
                     startParts.month !== endParts.month ||
                     startParts.day !== endParts.day;
            })()
          : false;

        // If an event extends past midnight, clamp to end-of-day for this day view.
        if (spansIntoNextDay) {
          maxHour = Math.max(maxHour, 24);
        } else {
          // If event ends with minutes past the hour, we need to show that hour
          maxHour = Math.max(maxHour, endMinutes > 0 ? endHour + 1 : endHour);
        }
      }
    }

    return {
      startHour: Math.max(0, minHour - BUFFER_HOURS),
      endHour: Math.min(24, maxHour + BUFFER_HOURS),
    };
  }

  /**
   * Common logic for building day context.
   * Converts events, sorts them, calculates time range, and builds day link.
   */
  private _buildCommonDayContext(
    events: StructuredEvent[],
    date: string,
    timezone: string,
    focusEventId: string
  ): DayContext {
    // Convert to day view events and sort
    const dayViewEvents: DayViewEvent[] = sortViewEvents(events.map(toDayViewEvent));

    // Calculate time range
    const timeRange = this.calculateTimeRange(events, timezone);

    return {
      date,
      timezone,
      events: dayViewEvents,
      focusEventId,
      timeRange,
      dayLink: buildCalendarLink(date, 'day'),
    };
  }

  /**
   * Build the day context for list operations (no focus event by default).
   * Used when listing events for a single day.
   */
  buildDayContextForList(
    events: StructuredEvent[],
    date: string,
    timezone: string,
    focusEventId: string = ''
  ): DayContext {
    return this._buildCommonDayContext(events, date, timezone, focusEventId);
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

    return this._buildCommonDayContext(allEvents, date, timezone, focusEvent.id);
  }
}
