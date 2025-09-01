import { calendar_v3 } from "googleapis";
import { ConflictCheckResult } from "../services/conflict-detection/types.js";

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

/**
 * Formats conflict check results for display
 */
export function formatConflictWarnings(conflicts: ConflictCheckResult): string {
    if (!conflicts.hasConflicts) return "";
    
    let warnings = "";
    
    // Format duplicate warnings
    if (conflicts.duplicates.length > 0) {
        warnings += "\n\n⚠️ POTENTIAL DUPLICATES DETECTED:";
        for (const dup of conflicts.duplicates) {
            warnings += `\n\n━━━ Duplicate Event (${Math.round(dup.event.similarity * 100)}% similar) ━━━`;
            warnings += `\n${dup.suggestion}`;
            
            // Show full event details if available
            if (dup.fullEvent) {
                warnings += `\n\nExisting event details:`;
                warnings += `\n${formatEventWithDetails(dup.fullEvent, dup.calendarId)}`;
            } else {
                // Fallback to basic info
                warnings += `\n• "${dup.event.title}"`;
                if (dup.event.url) {
                    warnings += `\n  View existing event: ${dup.event.url}`;
                }
            }
        }
    }
    
    // Format conflict warnings
    if (conflicts.conflicts.length > 0) {
        warnings += "\n\n⚠️ SCHEDULING CONFLICTS DETECTED:";
        const conflictsByCalendar = conflicts.conflicts.reduce((acc, conflict) => {
            if (!acc[conflict.calendar]) acc[conflict.calendar] = [];
            acc[conflict.calendar].push(conflict);
            return acc;
        }, {} as Record<string, typeof conflicts.conflicts>);
        
        for (const [calendar, calendarConflicts] of Object.entries(conflictsByCalendar)) {
            warnings += `\n\nCalendar: ${calendar}`;
            for (const conflict of calendarConflicts) {
                warnings += `\n\n━━━ Conflicting Event ━━━`;
                if (conflict.overlap) {
                    warnings += `\n⚠️  Overlap: ${conflict.overlap.duration} (${conflict.overlap.percentage}% of your event)`;
                }
                
                // Show full event details if available
                if (conflict.fullEvent) {
                    warnings += `\n\nConflicting event details:`;
                    warnings += `\n${formatEventWithDetails(conflict.fullEvent, calendar)}`;
                } else {
                    // Fallback to basic info
                    warnings += `\n• Conflicts with "${conflict.event.title}"`;
                    if (conflict.event.start && conflict.event.end) {
                        const start = formatDateTime(conflict.event.start);
                        const end = formatDateTime(conflict.event.end);
                        warnings += `\n  Time: ${start} - ${end}`;
                    }
                    if (conflict.event.url) {
                        warnings += `\n  View event: ${conflict.event.url}`;
                    }
                }
            }
        }
    }
    
    return warnings;
}

/**
 * Creates a response with event details and optional conflict warnings
 */
export function createEventResponseWithConflicts(
    event: calendar_v3.Schema$Event,
    calendarId: string,
    conflicts?: ConflictCheckResult,
    actionVerb: string = "created"
): string {
    const eventDetails = formatEventWithDetails(event, calendarId);
    const conflictWarnings = conflicts ? formatConflictWarnings(conflicts) : "";
    
    const successMessage = conflicts?.hasConflicts 
        ? `Event ${actionVerb} with warnings!`
        : `Event ${actionVerb} successfully!`;
    
    return `${successMessage}\n\n${eventDetails}${conflictWarnings}`;
}

