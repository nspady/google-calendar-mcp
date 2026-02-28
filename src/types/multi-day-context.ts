import { StructuredEvent } from './structured-responses.js';
import { BaseViewEvent, toBaseViewEvent } from './view-event.js';

/**
 * Simplified event for multi-day view display.
 * Extends BaseViewEvent with foreground color for multi-day rendering.
 */
export interface MultiDayViewEvent extends BaseViewEvent {
  /** Resolved foreground/text color (hex, e.g., "#ffffff") */
  foregroundColor?: string;
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
  return {
    ...toBaseViewEvent(event),
    foregroundColor: event.foregroundColor,
  };
}
