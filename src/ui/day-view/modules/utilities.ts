/**
 * Utility functions for day view and multi-day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { MultiDayViewEvent, CalendarSummary, AvailableSlot, DayViewEvent, CalendarFilter } from './types.js';
import { formatCalendarName } from './formatting.js';

/**
 * Get event color class based on colorId
 */
export function getEventColorClass(colorId?: string): string {
  if (!colorId) return '';
  const num = parseInt(colorId, 10);
  if (num >= 1 && num <= 11) {
    return `event-color-${num}`;
  }
  return '';
}

/**
 * Open a link using the MCP Apps API (required in sandboxed iframe)
 * The API expects an object with url property, not a raw string
 */
export function openLink(url: string, appInstance: App | null): void {
  if (appInstance) {
    // MCP Apps openLink expects { url: string }, not a raw string
    appInstance.openLink({ url }).catch((err) => {
      console.error('Failed to open link:', err);
    });
  } else {
    // Fallback for testing outside iframe
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Check if a date string is today
 */
export function isToday(dateStr: string): boolean {
  const today = new Date();
  const date = new Date(dateStr + 'T00:00:00');
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

/**
 * Compute calendar summary for a day's events (for collapsed view)
 * Groups by calendar (calendarId) and shows the actual calendar name
 */
export function computeCalendarSummary(events: MultiDayViewEvent[]): CalendarSummary[] {
  const byCalendar = new Map<string, CalendarSummary>();

  for (const event of events) {
    // Use calendarId as the grouping key
    const key = event.calendarId;
    const existing = byCalendar.get(key);
    if (existing) {
      existing.count++;
    } else {
      byCalendar.set(key, {
        calendarId: event.calendarId,
        calendarName: event.calendarName || formatCalendarName(event.calendarId, event.calendarName),
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        count: 1
      });
    }
  }

  return Array.from(byCalendar.values());
}

/**
 * Calculate available time slots from events for scheduling mode
 * Finds gaps between events that can fit meetings of the specified duration
 */
export function calculateAvailableSlots(
  events: DayViewEvent[] | MultiDayViewEvent[],
  durationMinutes: number,
  workStartHour: number = 9,
  workEndHour: number = 17
): AvailableSlot[] {
  const workStart = workStartHour * 60;
  const workEnd = workEndHour * 60;
  const slots: AvailableSlot[] = [];

  // Filter to timed events only and sort by start time
  const timedEvents = events
    .filter(e => !e.isAllDay)
    .map(e => {
      const startDate = new Date(e.start);
      const endDate = new Date(e.end);
      return {
        start: startDate.getHours() * 60 + startDate.getMinutes(),
        end: endDate.getHours() * 60 + endDate.getMinutes()
      };
    })
    .sort((a, b) => a.start - b.start);

  // Find gaps and split into meeting-duration slots
  let currentTime = workStart;
  for (const event of timedEvents) {
    if (event.start > currentTime) {
      const gapEnd = event.start;
      if (gapEnd - currentTime >= durationMinutes) {
        // Create multiple slots at meeting-duration intervals
        let slotStart = currentTime;
        while (slotStart + durationMinutes <= gapEnd) {
          slots.push({
            startMinutes: slotStart,
            endMinutes: slotStart + durationMinutes,
            duration: durationMinutes
          });
          slotStart += durationMinutes;
        }
      }
    }
    currentTime = Math.max(currentTime, event.end);
  }

  // Check gap after last event until end of work day
  if (workEnd > currentTime && workEnd - currentTime >= durationMinutes) {
    let slotStart = currentTime;
    while (slotStart + durationMinutes <= workEnd) {
      slots.push({
        startMinutes: slotStart,
        endMinutes: slotStart + durationMinutes,
        duration: durationMinutes
      });
      slotStart += durationMinutes;
    }
  }

  return slots;
}

/**
 * Compute calendar filters for the day view legend
 * Groups events by calendarId and shows actual calendar names
 */
export function computeCalendarFilters(events: DayViewEvent[]): CalendarFilter[] {
  const filterMap = new Map<string, CalendarFilter>();

  for (const event of events) {
    // Use calendarId as the grouping key
    const key = event.calendarId;

    const existing = filterMap.get(key);
    if (existing) {
      existing.eventCount++;
    } else {
      // Use calendar name if available, otherwise format calendar ID
      const displayName = (event as any).calendarName || formatCalendarName(event.calendarId);
      filterMap.set(key, {
        calendarId: event.calendarId,
        accountId: event.accountId,
        displayName,
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        eventCount: 1,
        visible: true
      });
    }
  }

  return Array.from(filterMap.values());
}

/**
 * Filter events based on calendar visibility
 */
export function filterVisibleEvents<T extends DayViewEvent | MultiDayViewEvent>(
  events: T[],
  filters: CalendarFilter[]
): T[] {
  const hiddenCalendars = new Set<string>();

  for (const filter of filters) {
    if (!filter.visible) {
      const key = filter.accountId
        ? `${filter.accountId}:${filter.calendarId}`
        : filter.calendarId;
      hiddenCalendars.add(key);
    }
  }

  if (hiddenCalendars.size === 0) return events;

  return events.filter(event => {
    const key = event.accountId
      ? `${event.accountId}:${event.calendarId}`
      : event.calendarId;
    return !hiddenCalendars.has(key);
  });
}
