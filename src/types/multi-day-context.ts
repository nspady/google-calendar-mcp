import { StructuredEvent } from './structured-responses.js';

/**
 * Simplified event for multi-day view display
 */
export interface MultiDayViewEvent {
  id: string;
  summary: string;
  start: string;           // ISO datetime or date
  end: string;             // ISO datetime or date
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  /** Resolved background color (hex, e.g., "#7986cb") - from event colorId or calendar default */
  backgroundColor?: string;
  /** Resolved foreground/text color (hex, e.g., "#ffffff") */
  foregroundColor?: string;
  calendarId: string;
  calendarName?: string;
  accountId?: string;
}

/**
 * Context data passed to the multi-day view UI
 */
export interface MultiDayContext {
  /** Array of dates being displayed (YYYY-MM-DD), sorted chronologically */
  dates: string[];
  /** Timezone for display */
  timezone: string;
  /** Events grouped by date (key is YYYY-MM-DD) */
  eventsByDate: Record<string, MultiDayViewEvent[]>;
  /** Total number of events across all dates */
  totalEventCount: number;
  /** Optional event ID to highlight (for search results or focus) */
  focusEventId?: string;
  /** Time range for display in header */
  timeRange?: { start: string; end: string };
  /** Search query (for search results) */
  query?: string;
  /** Link to open Google Calendar */
  calendarLink: string;
}

/**
 * Converts a StructuredEvent to MultiDayViewEvent
 */
export function toMultiDayViewEvent(event: StructuredEvent): MultiDayViewEvent {
  const isAllDay = !event.start.dateTime && !!event.start.date;
  return {
    id: event.id,
    summary: event.summary || '(No title)',
    start: event.start.dateTime || event.start.date || '',
    end: event.end.dateTime || event.end.date || '',
    isAllDay,
    location: event.location,
    htmlLink: event.htmlLink || '',
    backgroundColor: event.backgroundColor,
    foregroundColor: event.foregroundColor,
    calendarId: event.calendarId || '',
    calendarName: event.calendarName,
    accountId: event.accountId,
  };
}
