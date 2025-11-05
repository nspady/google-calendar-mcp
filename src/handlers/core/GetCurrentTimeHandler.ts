import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { GetCurrentTimeInput } from "../../tools/registry.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { GetCurrentTimeResponse } from "../../types/structured-responses.js";

export class GetCurrentTimeHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        // Validate arguments using schema
        const validArgs = args as GetCurrentTimeInput;
        
        const now = new Date();
        
        // If no timezone provided, use the primary Google Calendar's default timezone
        const requestedTimeZone = validArgs.timeZone;
        
        let timezone: string;
        if (validArgs.timeZone) {
            if (!this.isValidTimeZone(validArgs.timeZone)) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Invalid timezone: ${validArgs.timeZone}. Use IANA format (e.g. 'America/Los_Angeles').`
                );
            }
            timezone = validArgs.timeZone;
        } else {
            try {
                timezone = await this.getCalendarTimezone(oauth2Client, 'primary');
                if (timezone === 'UTC') {
                    const sys = this.getSystemTimeZone();
                    if (sys !== 'UTC') timezone = sys;
                }
            } catch {
                timezone = this.getSystemTimeZone();
            }
        }

        const response: GetCurrentTimeResponse = {
            currentTime: this.formatISOInZone(now, timezone),   // <-- NEW
            timezone: timezone,
            offset: this.getTimezoneOffset(now, timezone),
            isDST: this.isDaylightSavingTime(now, timezone)
        };

        return createStructuredResponse(response);
    }

    /**
     * Formats a Date object as an ISO 8601 string in a specific timezone with offset.
     *
     * This method uses Intl.DateTimeFormat to extract date/time components in the target
     * timezone and constructs an ISO string with the timezone offset appended.
     *
     * @param date - The Date object to format
     * @param timeZone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'UTC')
     * @returns ISO 8601 string with timezone offset (e.g., '2025-11-04T14:30:00.123-08:00' or '2025-11-04T14:30:00.123Z')
     *
     * @example
     * formatISOInZone(new Date('2025-11-04T22:30:00.000Z'), 'America/Los_Angeles')
     * // Returns: '2025-11-04T14:30:00.000-08:00'
     *
     * @example
     * formatISOInZone(new Date('2025-11-04T14:30:00.000Z'), 'UTC')
     * // Returns: '2025-11-04T14:30:00.000Z'
     */
    private formatISOInZone(date: Date, timeZone: string): string {
        const parts = new Intl.DateTimeFormat('sv-SE', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            fractionalSecondDigits: 3   // keep milliseconds
        }).formatToParts(date);

        const map = parts.reduce((acc, p) => {
            acc[p.type] = p.value;
            return acc;
        }, {} as Record<string, string>);

        const iso = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${map.fractionalSecond || '000'}`;
        const offset = this.getTimezoneOffset(date, timeZone);
        return offset === 'Z' ? `${iso}Z` : `${iso}${offset}`;
    }

    private getSystemTimeZone(): string {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            return 'UTC'; // Fallback to UTC if system timezone detection fails
        }
    }
    
    private isValidTimeZone(timeZone: string): boolean {
        try {
            Intl.DateTimeFormat(undefined, { timeZone });
            return true;
        } catch {
            return false;
        }
    }

    private getTimezoneOffset(_date: Date, timeZone: string): string {
        try {
            const offsetMinutes = this.getTimezoneOffsetMinutes(timeZone);
            
            if (offsetMinutes === 0) {
                return 'Z';
            }
            
            const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
            const offsetMins = Math.abs(offsetMinutes) % 60;
            const sign = offsetMinutes >= 0 ? '+' : '-';
            
            return `${sign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`;
        } catch {
            return 'Z'; // Fallback to UTC if offset calculation fails
        }
    }
    
    private getTimezoneOffsetMinutes(timeZone: string): number {
        // Use the timezone offset from a date's time representation in different zones
        const date = new Date();


        // Get local time for the target timezone
        const targetTimeString = new Intl.DateTimeFormat('sv-SE', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);

        // Get UTC time string
        const utcTimeString = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);

        // Parse both times and calculate difference
        const targetTime = new Date(targetTimeString.replace(' ', 'T') + 'Z').getTime();
        const utcTimeParsed = new Date(utcTimeString.replace(' ', 'T') + 'Z').getTime();

        return (targetTime - utcTimeParsed) / (1000 * 60);
    }

    private isDaylightSavingTime(date: Date, timeZone: string): boolean {
        try {
            // Get offset for the given date
            const currentOffset = this.getTimezoneOffsetForDate(date, timeZone);

            // Get offset for January 1st (typically standard time)
            const january = new Date(date.getFullYear(), 0, 1);
            const januaryOffset = this.getTimezoneOffsetForDate(january, timeZone);

            // Get offset for July 1st (typically daylight saving time if applicable)
            const july = new Date(date.getFullYear(), 6, 1);
            const julyOffset = this.getTimezoneOffsetForDate(july, timeZone);

            // If January and July have different offsets, DST is observed
            // Current date is in DST if its offset matches the smaller offset (more negative/less positive)
            if (januaryOffset !== julyOffset) {
                const dstOffset = Math.min(januaryOffset, julyOffset);
                return currentOffset === dstOffset;
            }

            return false;
        } catch {
            return false;
        }
    }

    private getTimezoneOffsetForDate(date: Date, timeZone: string): number {
        // Get local time for the target timezone
        const targetTimeString = new Intl.DateTimeFormat('sv-SE', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);

        // Get UTC time string
        const utcTimeString = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);

        // Parse both times and calculate difference in minutes
        const targetTime = new Date(targetTimeString.replace(' ', 'T') + 'Z').getTime();
        const utcTimeParsed = new Date(utcTimeString.replace(' ', 'T') + 'Z').getTime();

        return (targetTime - utcTimeParsed) / (1000 * 60);
    }
}
