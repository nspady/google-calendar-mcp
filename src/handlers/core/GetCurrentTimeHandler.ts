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

        if (requestedTimeZone) {
            // Validate the timezone
            if (!this.isValidTimeZone(requestedTimeZone)) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Invalid timezone: ${requestedTimeZone}. Use IANA timezone format like 'America/Los_Angeles' or 'UTC'.`
                );
            }
            timezone = requestedTimeZone;
        } else {
            // No timezone requested - fetch the primary calendar's timezone
            // If fetching fails (e.g., auth/network), fall back to system timezone
            try {
                timezone = await this.getCalendarTimezone(oauth2Client, 'primary');
                // If we got UTC back, it might be a fallback, try to detect if it's actually the system timezone
                if (timezone === 'UTC') {
                    const systemTz = this.getSystemTimeZone();
                    if (systemTz !== 'UTC') {
                        // Likely failed to get calendar timezone
                        timezone = systemTz;
                    }
                }
            } catch (error) {
                // This shouldn't happen with current implementation, but handle it
                timezone = this.getSystemTimeZone();
            }
        }

        const response: GetCurrentTimeResponse = {
            currentTime: now.toISOString(),
            timezone: timezone,
            offset: this.getTimezoneOffset(now, timezone),
            isDST: this.isDaylightSavingTime(now, timezone)
        };

        return createStructuredResponse(response);
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
    
    private formatDateInTimeZone(date: Date, timeZone: string): string {
        const offset = this.getTimezoneOffset(date, timeZone);
        // Remove milliseconds from ISO string for proper RFC3339 format
        const isoString = date.toISOString().replace(/\.\d{3}Z$/, '');
        return isoString + offset;
    }
    
    private formatHumanReadable(date: Date, timeZone: string): string {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'long'
        });
        
        return formatter.format(date);
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
