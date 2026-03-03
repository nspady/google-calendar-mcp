import { StructuredEvent } from './structured-responses.js';

/**
 * Base view event shared by day view and multi-day view.
 * Contains the common fields needed for calendar UI display.
 */
export interface BaseViewEvent {
  id: string;
  summary: string;
  start: string;           // ISO datetime or date
  end: string;             // ISO datetime or date
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  /** Resolved background color (hex, e.g., "#7986cb") - from event colorId or calendar default */
  backgroundColor?: string;
  calendarId: string;
  /** Calendar display name (user's summaryOverride or calendar's summary) */
  calendarName?: string;
  accountId?: string;
  attendeeCount?: number;
  selfResponseStatus?: string;
  hasConferenceLink?: boolean;
  eventType?: string;
  isRecurring?: boolean;
}

/**
 * Converts a StructuredEvent to BaseViewEvent fields.
 */
export function toBaseViewEvent(event: StructuredEvent): BaseViewEvent {
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
    calendarId: event.calendarId || '',
    calendarName: event.calendarName,
    accountId: event.accountId,
    attendeeCount: event.attendees?.length,
    selfResponseStatus: event.attendees?.find(a => a.self)?.responseStatus,
    hasConferenceLink: !!event.conferenceData?.entryPoints?.some(ep => ep.entryPointType === 'video'),
    eventType: event.eventType !== 'default' ? event.eventType : undefined,
    isRecurring: !!event.recurringEventId,
  };
}

/**
 * Sort view events: all-day events first, then by start time.
 */
export function sortViewEvents<T extends BaseViewEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return a.start.localeCompare(b.start);
  });
}

/**
 * Build a Google Calendar link for a specific view and date.
 */
export function buildCalendarLink(date: string, view: 'day' | 'week'): string {
  return `https://calendar.google.com/calendar/r/${view}/${date.replace(/-/g, '/')}`;
}
