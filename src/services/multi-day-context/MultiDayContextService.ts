import { StructuredEvent } from '../../types/structured-responses.js';
import { MultiDayContext, MultiDayViewEvent, toMultiDayViewEvent } from '../../types/multi-day-context.js';
import { sortViewEvents, buildCalendarLink } from '../../types/view-event.js';

interface BuildOptions {
  timeRange?: { start: string; end: string };
  query?: string;
  focusEventId?: string;
}

/**
 * Service for building multi-day context data for the multi-day view UI.
 * Groups events by date and prepares them for list-based display.
 */
export class MultiDayContextService {
  /**
   * Extract the date (YYYY-MM-DD) from a datetime string or date string.
   * Handles both ISO datetime with timezone and plain dates.
   */
  private extractDate(dateTimeOrDate: string, timezone: string): string {
    // If it's already a date (YYYY-MM-DD), return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeOrDate)) {
      return dateTimeOrDate;
    }

    // Parse the datetime and extract the date in the given timezone
    try {
      const date = new Date(dateTimeOrDate);
      if (isNaN(date.getTime())) {
        return dateTimeOrDate.split('T')[0];
      }

      // Use Intl.DateTimeFormat to get the date parts in the target timezone
      // Then manually construct YYYY-MM-DD to avoid locale variations
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;

      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }

      // Fallback: split on T
      return dateTimeOrDate.split('T')[0];
    } catch {
      // Fallback: split on T
      return dateTimeOrDate.split('T')[0];
    }
  }

  /**
   * Group events by their start date.
   */
  groupEventsByDate(
    events: MultiDayViewEvent[],
    timezone: string
  ): Record<string, MultiDayViewEvent[]> {
    const grouped: Record<string, MultiDayViewEvent[]> = {};

    for (const event of events) {
      const date = this.extractDate(event.start, timezone);
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(event);
    }

    return grouped;
  }

  /**
   * Build the multi-day context for UI display.
   *
   * @param events - Array of structured events to display
   * @param timezone - Timezone for date grouping
   * @param options - Optional configuration (timeRange, query, focusEventId)
   * @returns MultiDayContext ready for UI rendering
   */
  buildMultiDayContext(
    events: StructuredEvent[],
    timezone: string,
    options: BuildOptions = {}
  ): MultiDayContext {
    // Convert to display format
    const displayEvents = events.map(toMultiDayViewEvent);

    // Group by date
    const eventsByDate = this.groupEventsByDate(displayEvents, timezone);

    // Sort events within each date group
    for (const date of Object.keys(eventsByDate)) {
      eventsByDate[date] = sortViewEvents(eventsByDate[date]);
    }

    // Get sorted list of dates
    const dates = Object.keys(eventsByDate).sort();

    return {
      dates,
      timezone,
      eventsByDate,
      totalEventCount: events.length,
      focusEventId: options.focusEventId,
      timeRange: options.timeRange,
      query: options.query,
      calendarLink: dates.length > 0
        ? buildCalendarLink(dates[0], 'week')
        : 'https://calendar.google.com/calendar'
    };
  }
}
