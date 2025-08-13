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

/**
 * Formats a date/time with timezone abbreviation
 */
function formatDateTime(dateTime?: string | null, date?: string | null, timeZone?: string): string {
    if (!dateTime && !date) return "unspecified";
    
    try {
        const dt = dateTime || date;
        if (!dt) return "unspecified";
        
        const parsedDate = new Date(dt);
        if (isNaN(parsedDate.getTime())) return dt;
        
        // If it's a date-only event, just return the date
        if (date && !dateTime) {
            return parsedDate.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        
        // For timed events, include timezone
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        };
        
        if (timeZone) {
            options.timeZone = timeZone;
        }
        
        return parsedDate.toLocaleString('en-US', options);
    } catch (error) {
        return dateTime || date || "unspecified";
    }
}

/**
 * Formats attendees with their response status
 */
function formatAttendees(attendees?: calendar_v3.Schema$EventAttendee[]): string {
    if (!attendees || attendees.length === 0) return "";
    
    const formatted = attendees.map(attendee => {
        const email = attendee.email || "unknown";
        const name = attendee.displayName || email;
        const status = attendee.responseStatus || "unknown";
        
        const statusText = {
            'accepted': 'accepted',
            'declined': 'declined', 
            'tentative': 'tentative',
            'needsAction': 'pending'
        }[status] || 'unknown';
        
        return `${name} (${statusText})`;
    }).join(", ");
    
    return `\nGuests: ${formatted}`;
}

/**
 * Formats a single event with rich details
 */
export function formatEventWithDetails(event: calendar_v3.Schema$Event, calendarId?: string): string {
    const title = event.summary ? `Event: ${event.summary}` : "Untitled Event";
    const eventId = event.id ? `\nEvent ID: ${event.id}` : "";
    const description = event.description ? `\nDescription: ${event.description}` : "";
    const location = event.location ? `\nLocation: ${event.location}` : "";
    const colorId = event.colorId ? `\nColor ID: ${event.colorId}` : "";

    // Format start and end times with timezone
    const startTime = formatDateTime(event.start?.dateTime, event.start?.date, event.start?.timeZone || undefined);
    const endTime = formatDateTime(event.end?.dateTime, event.end?.date, event.end?.timeZone || undefined);
    
    let timeInfo: string;
    if (event.start?.date) {
        // All-day event
        if (event.start.date === event.end?.date) {
            // Single day all-day event
            timeInfo = `\nDate: ${startTime}`;
        } else {
            // Multi-day all-day event - end date is exclusive, so subtract 1 day for display
            const endDate = event.end?.date ? new Date(event.end.date) : null;
            if (endDate) {
                endDate.setDate(endDate.getDate() - 1); // Subtract 1 day since end is exclusive
                const adjustedEndTime = endDate.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
                timeInfo = `\nStart Date: ${startTime}\nEnd Date: ${adjustedEndTime}`;
            } else {
                timeInfo = `\nStart Date: ${startTime}`;
            }
        }
    } else {
        // Timed event
        timeInfo = `\nStart: ${startTime}\nEnd: ${endTime}`;
    }
    
    const attendeeInfo = formatAttendees(event.attendees);
    
    const eventUrl = getEventUrl(event, calendarId);
    const urlInfo = eventUrl ? `\nView: ${eventUrl}` : "";
    
    return `${title}${eventId}${description}${timeInfo}${location}${colorId}${attendeeInfo}${urlInfo}`;
}

