import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { formatEventList } from "../utils.js";
import { BatchRequestHandler } from "./BatchRequestHandler.js";

// Extended event type to include calendar ID for tracking source
interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface ListEventsArgs {
  calendarId: string | string[];
  timeMin?: string;
  timeMax?: string;
}

export class ListEventsHandler extends BaseToolHandler {
    async runTool(args: ListEventsArgs, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        // MCP SDK has already validated the arguments against the tool schema
        const validArgs = args;
        
        // Normalize calendarId to always be an array for consistent processing
        // The Zod schema transform has already handled JSON string parsing if needed
        const calendarIds = Array.isArray(validArgs.calendarId) 
            ? validArgs.calendarId 
            : [validArgs.calendarId];
        
        const allEvents = await this.fetchEvents(oauth2Client, calendarIds, {
            timeMin: validArgs.timeMin,
            timeMax: validArgs.timeMax
        });
        
        return {
            content: [{
                type: "text",
                text: this.formatEventList(allEvents, calendarIds),
            }],
        };
    }

    private async fetchEvents(
        client: OAuth2Client,
        calendarIds: string[],
        options: { timeMin?: string; timeMax?: string }
    ): Promise<ExtendedEvent[]> {
        if (calendarIds.length === 1) {
            return this.fetchSingleCalendarEvents(client, calendarIds[0], options);
        }
        
        return this.fetchMultipleCalendarEvents(client, calendarIds, options);
    }

    private async fetchSingleCalendarEvents(
        client: OAuth2Client,
        calendarId: string,
        options: { timeMin?: string; timeMax?: string }
    ): Promise<ExtendedEvent[]> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.events.list({
                calendarId,
                timeMin: options.timeMin,
                timeMax: options.timeMax,
                singleEvents: true,
                orderBy: 'startTime'
            });
            
            // Add calendarId to events for consistent interface
            return (response.data.items || []).map(event => ({
                ...event,
                calendarId
            }));
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

    private async fetchMultipleCalendarEvents(
        client: OAuth2Client,
        calendarIds: string[],
        options: { timeMin?: string; timeMax?: string }
    ): Promise<ExtendedEvent[]> {
        const batchHandler = new BatchRequestHandler(client);
        
        const requests = calendarIds.map(calendarId => ({
            method: "GET" as const,
            path: this.buildEventsPath(calendarId, options)
        }));
        
        const responses = await batchHandler.executeBatch(requests);
        
        const { events, errors } = this.processBatchResponses(responses, calendarIds);
        
        if (errors.length > 0) {
            process.stderr.write(`Some calendars had errors: ${errors.map(e => `${e.calendarId}: ${e.error}`).join(', ')}\n`);
        }
        
        return this.sortEventsByStartTime(events);
    }

    private buildEventsPath(calendarId: string, options: { timeMin?: string; timeMax?: string }): string {
        const params = new URLSearchParams({
            singleEvents: "true",
            orderBy: "startTime",
            ...(options.timeMin && { timeMin: options.timeMin }),
            ...(options.timeMax && { timeMax: options.timeMax })
        });
        
        return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    }

    private processBatchResponses(
        responses: any[], 
        calendarIds: string[]
    ): { events: ExtendedEvent[]; errors: Array<{ calendarId: string; error: string }> } {
        const events: ExtendedEvent[] = [];
        const errors: Array<{ calendarId: string; error: string }> = [];
        
        responses.forEach((response, index) => {
            const calendarId = calendarIds[index];
            
            if (response.statusCode === 200 && response.body?.items) {
                const calendarEvents: ExtendedEvent[] = response.body.items.map((event: any) => ({
                    ...event,
                    calendarId
                }));
                events.push(...calendarEvents);
            } else {
                const errorMessage = response.body?.error?.message || 
                                   response.body?.message || 
                                   `HTTP ${response.statusCode}`;
                errors.push({ calendarId, error: errorMessage });
            }
        });
        
        return { events, errors };
    }

    private sortEventsByStartTime(events: ExtendedEvent[]): ExtendedEvent[] {
        return events.sort((a, b) => {
            const aStart = a.start?.dateTime || a.start?.date || "";
            const bStart = b.start?.dateTime || b.start?.date || "";
            return aStart.localeCompare(bStart);
        });
    }

    private formatEventList(events: ExtendedEvent[], calendarIds: string[]): string {
        if (events.length === 0) {
            return `No events found in ${calendarIds.length} calendar(s).`;
        }
        
        if (calendarIds.length === 1) {
            return formatEventList(events);
        }
        
        return this.formatMultiCalendarEvents(events, calendarIds);
    }

    private formatMultiCalendarEvents(events: ExtendedEvent[], calendarIds: string[]): string {
        const grouped = this.groupEventsByCalendar(events);
        
        let output = `Found ${events.length} events across ${calendarIds.length} calendars:\n\n`;
        
        for (const [calendarId, calEvents] of Object.entries(grouped)) {
            output += `Calendar: ${calendarId}\n`;
            output += formatEventList(calEvents);
            output += '\n';
        }
        
        return output;
    }

    private groupEventsByCalendar(events: ExtendedEvent[]): Record<string, ExtendedEvent[]> {
        return events.reduce((acc, event) => {
            const calId = event.calendarId;
            if (!acc[calId]) acc[calId] = [];
            acc[calId].push(event);
            return acc;
        }, {} as Record<string, ExtendedEvent[]>);
    }
}
