/**
 * Datetime utilities for Google Calendar MCP Server
 * Provides timezone handling and datetime conversion utilities
 */

/**
 * Checks if a datetime string includes timezone information
 * @param datetime ISO 8601 datetime string
 * @returns True if timezone is included, false if timezone-naive
 */
export function hasTimezoneInDatetime(datetime: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime);
}

/**
 * Converts a flexible datetime string to RFC3339 format required by Google Calendar API
 * 
 * Precedence rules:
 * 1. If datetime already has timezone info (Z or ±HH:MM), use as-is
 * 2. If datetime is timezone-naive, interpret it as local time in fallbackTimezone and convert to UTC
 * 
 * @param datetime ISO 8601 datetime string (with or without timezone)
 * @param fallbackTimezone Timezone to use if datetime is timezone-naive (IANA format)
 * @returns RFC3339 formatted datetime string in UTC
 */
export function convertToRFC3339(datetime: string, fallbackTimezone: string): string {
    if (hasTimezoneInDatetime(datetime)) {
        // Already has timezone, use as-is
        return datetime;
    } else {
        // Timezone-naive, interpret as local time in fallbackTimezone and convert to UTC
        try {
            // Parse the datetime components
            const match = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
            if (!match) {
                throw new Error('Invalid datetime format');
            }
            
            const [, year, month, day, hour, minute, second] = match.map(Number);
            
            // Create a temporary date in UTC to get the baseline
            const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
            
            // Find what UTC time corresponds to the desired local time in the target timezone
            // We do this by binary search approach or by using the timezone offset
            const targetDate = convertLocalTimeToUTC(year, month - 1, day, hour, minute, second, fallbackTimezone);
            
            return targetDate.toISOString().replace(/\.000Z$/, 'Z');
        } catch (error) {
            // Fallback: if timezone conversion fails, append Z for UTC
            return datetime + 'Z';
        }
    }
}

/**
 * Convert a local time in a specific timezone to UTC
 */
function convertLocalTimeToUTC(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string): Date {
    // Create a date that we'll use to find the correct UTC time
    // Start with the assumption that it's in UTC
    let testDate = new Date(Date.UTC(year, month, day, hour, minute, second));
    
    // Get what this UTC time looks like in the target timezone
    const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    
    // Format the test date in the target timezone
    const formatter = new Intl.DateTimeFormat('sv-SE', options);
    const formattedInTargetTZ = formatter.format(testDate);
    
    // Parse the formatted result to see what time it shows
    const [datePart, timePart] = formattedInTargetTZ.split(' ');
    const [targetYear, targetMonth, targetDay] = datePart.split('-').map(Number);
    const [targetHour, targetMinute, targetSecond] = timePart.split(':').map(Number);
    
    // Calculate the difference between what we want and what we got
    const wantedTime = new Date(year, month, day, hour, minute, second).getTime();
    const actualTime = new Date(targetYear, targetMonth - 1, targetDay, targetHour, targetMinute, targetSecond).getTime();
    const offsetMs = wantedTime - actualTime;
    
    // Adjust the UTC time by the offset
    return new Date(testDate.getTime() + offsetMs);
}

/**
 * Creates a time object for Google Calendar API, handling both timezone-aware and timezone-naive datetime strings
 * Also handles all-day events by using 'date' field instead of 'dateTime'
 * @param datetime ISO 8601 datetime string (with or without timezone)
 * @param fallbackTimezone Timezone to use if datetime is timezone-naive (IANA format)
 * @returns Google Calendar API time object
 */
export function createTimeObject(datetime: string, fallbackTimezone: string): { dateTime?: string; date?: string; timeZone?: string } {
    // Check if this is a date-only string (all-day event)
    // Date-only format: YYYY-MM-DD (no time component)
    if (!/T/.test(datetime)) {
        // This is a date-only string, use the 'date' field for all-day event
        return { date: datetime };
    }
    
    // This is a datetime string with time component
    if (hasTimezoneInDatetime(datetime)) {
        // Timezone included in datetime - use as-is, no separate timeZone property needed
        return { dateTime: datetime };
    } else {
        // Timezone-naive datetime - use fallback timezone
        return { dateTime: datetime, timeZone: fallbackTimezone };
    }
}