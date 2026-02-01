/**
 * Utility functions for day view and multi-day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { MultiDayViewEvent, CalendarSummary, AvailableSlot, DayViewEvent } from './types.js';
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
 * Groups by account nickname (accountId) for cleaner display
 */
export function computeCalendarSummary(events: MultiDayViewEvent[]): CalendarSummary[] {
  const byAccount = new Map<string, CalendarSummary>();

  for (const event of events) {
    // Use accountId as the grouping key, fall back to calendarId if no account
    const key = event.accountId || event.calendarId;
    const existing = byAccount.get(key);
    if (existing) {
      existing.count++;
    } else {
      byAccount.set(key, {
        calendarId: event.calendarId,
        calendarName: event.accountId || formatCalendarName(event.calendarId),
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        count: 1
      });
    }
  }

  return Array.from(byAccount.values());
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
