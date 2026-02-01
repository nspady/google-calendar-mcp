/**
 * Formatting functions for day view and multi-day view
 */

import type { MultiDayViewEvent, MultiDayContext } from './types.js';

// Host context for locale/timezone formatting
let hostLocale: string | undefined;
let hostTimeZone: string | undefined;

/**
 * Set host locale and timezone for formatting
 */
export function setHostContext(locale?: string, timeZone?: string): void {
  hostLocale = locale;
  hostTimeZone = timeZone;
}

/**
 * Format hour for display (e.g., "9 AM", "12 PM", "5 PM")
 */
export function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Format time for event display (e.g., "9:00 AM", "2:30 PM")
 * Uses host locale when available for localized formatting
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  // Use Intl.DateTimeFormat with host locale if available
  if (hostLocale) {
    return date.toLocaleTimeString(hostLocale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: hostTimeZone
    });
  }
  // Fallback to manual formatting
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHour}:${displayMinutes} ${ampm}`;
}

/**
 * Format date for heading (e.g., "Tuesday, January 27, 2025")
 * Uses host locale when available for localized formatting
 */
export function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(hostLocale || 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format all-day event date range
 * Returns single date for single-day events, or date range for multi-day
 */
export function formatAllDayRange(startStr: string, endStr: string): { text: string; dateRange: string; isMultiDay: boolean } {
  // All-day events: start is inclusive, end is exclusive (next day)
  const start = new Date(startStr);
  const end = new Date(endStr);

  // Calculate the actual end date (exclusive end means subtract 1 day for display)
  const actualEnd = new Date(end);
  actualEnd.setDate(actualEnd.getDate() - 1);

  const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startFormatted = start.toLocaleDateString(hostLocale || 'en-US', formatOptions);

  // Check if it's a single day event
  if (start.toDateString() === actualEnd.toDateString()) {
    return { text: 'All day', dateRange: startFormatted, isMultiDay: false };
  }

  // Multi-day event - format as date range with en-dash
  const endFormatted = actualEnd.toLocaleDateString(hostLocale || 'en-US', formatOptions);
  return { text: 'All day', dateRange: `${startFormatted}–${endFormatted}`, isMultiDay: true };
}

/**
 * Format date for multi-day view header (e.g., "22 OCT 2025, WED")
 */
export function formatMultiDayDate(dateStr: string): { day: string; monthYearDay: string } {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate().toString();
  const month = date.toLocaleDateString(hostLocale || 'en-US', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  const weekday = date.toLocaleDateString(hostLocale || 'en-US', { weekday: 'short' }).toUpperCase();

  return {
    day,
    monthYearDay: `${month} ${year}, ${weekday}`
  };
}

/**
 * Format time for multi-day event display (e.g., "3:30 - 5pm")
 */
export function formatMultiDayEventTime(event: MultiDayViewEvent): string {
  if (event.isAllDay) {
    return 'All day';
  }

  const startDate = new Date(event.start);
  const endDate = new Date(event.end);

  // Format start time
  const startOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: startDate.getMinutes() > 0 ? '2-digit' : undefined,
    timeZone: hostTimeZone
  };
  const startStr = startDate.toLocaleTimeString(hostLocale || 'en-US', startOptions);

  // Format end time (simpler, just hour + am/pm)
  const endOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: endDate.getMinutes() > 0 ? '2-digit' : undefined,
    timeZone: hostTimeZone
  };
  const endStr = endDate.toLocaleTimeString(hostLocale || 'en-US', endOptions);

  return `${startStr} - ${endStr}`;
}

/**
 * Format the calendar display name.
 * Shows calendarName if available, otherwise a friendly version of calendarId.
 */
export function formatCalendarName(calendarId: string, calendarName?: string): string {
  if (calendarName) {
    return calendarName;
  }
  // For 'primary', show as 'Primary'
  if (calendarId === 'primary') {
    return 'Primary';
  }
  // For email-style IDs, show just the email
  if (calendarId.includes('@')) {
    return calendarId;
  }
  return calendarId;
}

/**
 * Format overlap duration for display
 */
export function formatOverlapDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${mins} min`;
}

/**
 * Format duration for display (e.g., "2h 30m")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Format time range for multi-day view subheading
 */
export function formatTimeRangeSubheading(context: MultiDayContext): string {
  const parts: string[] = [];

  if (context.query) {
    parts.push(`Search: "${context.query}"`);
  }

  if (context.timeRange?.start && context.timeRange?.end) {
    const startDate = new Date(context.timeRange.start);
    const endDate = new Date(context.timeRange.end);
    const formatOptions: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    };
    const startStr = startDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
    const endStr = endDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
    parts.push(`${startStr} - ${endStr}`);
  }

  parts.push(`${context.totalEventCount} event${context.totalEventCount !== 1 ? 's' : ''}`);

  return parts.join(' · ');
}

/**
 * Format slot time from minutes since midnight (e.g., 540 -> "9 AM", 810 -> "1:30 PM")
 */
export function formatSlotTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const h = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  return mins === 0 ? `${h} ${ampm}` : `${h}:${String(mins).padStart(2, '0')} ${ampm}`;
}
