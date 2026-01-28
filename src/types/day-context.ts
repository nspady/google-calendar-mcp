import { StructuredEvent } from './structured-responses.js';

/**
 * Simplified event for day view display
 */
export interface DayViewEvent {
  id: string;
  summary: string;
  start: string;           // ISO datetime or date
  end: string;             // ISO datetime or date
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  colorId?: string;
  calendarId: string;
  accountId?: string;
}

/**
 * Context data passed to the day view UI
 */
export interface DayContext {
  /** The date being displayed (YYYY-MM-DD) */
  date: string;
  /** Timezone for display */
  timezone: string;
  /** All events for the day */
  events: DayViewEvent[];
  /** ID of the newly created/updated event */
  focusEventId: string;
  /** Calculated time range to display */
  timeRange: {
    /** Start hour (0-23) */
    startHour: number;
    /** End hour (0-23) */
    endHour: number;
  };
  /** Link to open the day in Google Calendar */
  dayLink: string;
}

/**
 * Converts a StructuredEvent to DayViewEvent
 */
export function toDayViewEvent(event: StructuredEvent): DayViewEvent {
  const isAllDay = !event.start.dateTime && !!event.start.date;
  return {
    id: event.id,
    summary: event.summary || '(No title)',
    start: event.start.dateTime || event.start.date || '',
    end: event.end.dateTime || event.end.date || '',
    isAllDay,
    location: event.location,
    htmlLink: event.htmlLink || '',
    colorId: event.colorId,
    calendarId: event.calendarId || '',
    accountId: event.accountId,
  };
}
