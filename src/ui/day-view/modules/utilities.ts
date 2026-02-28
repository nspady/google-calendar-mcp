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

export function getDateKeyInTimeZone(date: Date, timeZone?: string): string {
  if (!timeZone) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall through to local date key.
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMinutesSinceMidnight(value: string, timeZone?: string): number {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return 0;
  }

  if (!timeZone) {
    return date.getHours() * 60 + date.getMinutes();
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    return (hour === 24 ? 0 : hour) * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/**
 * Check if a date string is today
 */
export function isToday(dateStr: string, timeZone?: string): boolean {
  const today = new Date();
  return getDateKeyInTimeZone(today, timeZone) === dateStr;
}

/**
 * Compute calendar summary for a day's events (for collapsed view)
 * Groups by calendar (calendarId) and shows the actual calendar name
 */
export function computeCalendarSummary(events: MultiDayViewEvent[]): CalendarSummary[] {
  const byCalendar = new Map<string, { summary: CalendarSummary; accountId?: string }>();

  for (const event of events) {
    // Use account+calendar composite key to avoid collapsing distinct "primary" calendars.
    const key = event.accountId ? `${event.accountId}:${event.calendarId}` : event.calendarId;
    const existing = byCalendar.get(key);
    if (existing) {
      existing.summary.count++;
    } else {
      byCalendar.set(key, {
        summary: {
          calendarId: event.calendarId,
          calendarName: event.calendarName || formatCalendarName(event.calendarId, event.calendarName),
          backgroundColor: event.backgroundColor || 'var(--accent-color)',
          count: 1
        },
        accountId: event.accountId
      });
    }
  }

  const summary = Array.from(byCalendar.values());
  const nameCounts = new Map<string, number>();
  for (const item of summary) {
    nameCounts.set(item.summary.calendarName, (nameCounts.get(item.summary.calendarName) || 0) + 1);
  }

  return summary.map((item) => {
    if (item.accountId && (nameCounts.get(item.summary.calendarName) || 0) > 1) {
      return { ...item.summary, calendarName: `${item.accountId} · ${item.summary.calendarName}` };
    }
    return item.summary;
  });
}

/**
 * Calculate available time slots from events for scheduling mode
 * Finds gaps between events that can fit meetings of the specified duration
 */
export function calculateAvailableSlots(
  events: DayViewEvent[] | MultiDayViewEvent[],
  durationMinutes: number,
  workStartHour: number = 9,
  workEndHour: number = 17,
  timeZone?: string
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
      const start = getMinutesSinceMidnight(e.start, timeZone);
      const rawDurationMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
      const durationMinutes = Number.isFinite(rawDurationMinutes) ? Math.max(0, Math.round(rawDurationMinutes)) : 0;
      let end = start + durationMinutes;

      // Cross-midnight events should block through end-of-day in a single-day view.
      if (getDateKeyInTimeZone(endDate, timeZone) !== getDateKeyInTimeZone(startDate, timeZone)) {
        end = 24 * 60;
      } else {
        end = Math.min(end, 24 * 60);
      }

      return {
        start,
        end
      };
    })
    .filter(event => event.end > workStart && event.start < workEnd)
    .map(event => ({
      start: Math.max(event.start, workStart),
      end: Math.min(event.end, workEnd)
    }))
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
export function computeCalendarFilters(events: DayViewEvent[], hiddenCalendarIds?: string[]): CalendarFilter[] {
  const hiddenSet = hiddenCalendarIds ? new Set(hiddenCalendarIds) : null;
  const filterMap = new Map<string, CalendarFilter>();

  for (const event of events) {
    // Use account+calendar composite key to avoid collapsing distinct "primary" calendars.
    const key = event.accountId ? `${event.accountId}:${event.calendarId}` : event.calendarId;

    const existing = filterMap.get(key);
    if (existing) {
      existing.eventCount++;
    } else {
      // Use calendar name if available, otherwise format calendar ID
      const displayName = event.calendarName || formatCalendarName(event.calendarId);
      const compositeKey = key;
      filterMap.set(key, {
        calendarId: event.calendarId,
        accountId: event.accountId,
        displayName,
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        eventCount: 1,
        visible: hiddenSet ? !hiddenSet.has(compositeKey) : true
      });
    }
  }

  const filters = Array.from(filterMap.values());
  const nameCounts = new Map<string, number>();
  for (const filter of filters) {
    nameCounts.set(filter.displayName, (nameCounts.get(filter.displayName) || 0) + 1);
  }

  // Disambiguate duplicate calendar names in multi-account views.
  for (const filter of filters) {
    if (filter.accountId && (nameCounts.get(filter.displayName) || 0) > 1) {
      filter.displayName = `${filter.accountId} · ${filter.displayName}`;
    }
  }

  return filters;
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
