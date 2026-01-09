import { calendar_v3 } from "googleapis";

/**
 * Generates a Google Calendar event view URL
 */
export function generateEventUrl(calendarId: string, eventId: string): string {
    const encodedCalendarId = encodeURIComponent(calendarId);
    const encodedEventId = encodeURIComponent(eventId);
    return `https://calendar.google.com/calendar/event?eid=${encodedEventId}&cid=${encodedCalendarId}`;
}

/**
 * Gets the URL for a calendar event
 */
export function getEventUrl(event: calendar_v3.Schema$Event, calendarId?: string): string | null {
    if (event.htmlLink) {
        return event.htmlLink;
    } else if (calendarId && event.id) {
        return generateEventUrl(calendarId, event.id);
    }
    return null;
}
