import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { BatchRequestHandler } from "./BatchRequestHandler.js";
import { convertToRFC3339 } from "../utils/datetime.js";
import { buildListFieldMask } from "../../utils/field-mask-builder.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { ListEventsResponse, StructuredEvent, convertGoogleEventToStructured } from "../../types/structured-responses.js";

// Extended event type to include calendar ID for tracking source
interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface ListEventsArgs {
  calendarId: string | string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  fields?: string[];
  privateExtendedProperty?: string[];
  sharedExtendedProperty?: string[];
}

export class ListEventsHandler extends BaseToolHandler {
    async runTool(args: ListEventsArgs, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        // MCP SDK has already validated the arguments against the tool schema
        const validArgs = args;

        // Normalize calendarId to always be an array for consistent processing
        // The Zod schema transform has already handled JSON string parsing if needed
        const calendarNamesOrIds = Array.isArray(validArgs.calendarId)
            ? validArgs.calendarId
            : [validArgs.calendarId];

        // Resolve calendar names to IDs (if any names were provided)
        const calendarIds = await this.resolveCalendarIds(oauth2Client, calendarNamesOrIds);

        const allEvents = await this.fetchEvents(oauth2Client, calendarIds, {
            timeMin: validArgs.timeMin,
            timeMax: validArgs.timeMax,
            timeZone: validArgs.timeZone,
            fields: validArgs.fields,
            privateExtendedProperty: validArgs.privateExtendedProperty,
            sharedExtendedProperty: validArgs.sharedExtendedProperty
        });

        // Convert extended events to structured format
        const structuredEvents: StructuredEvent[] = allEvents.map(event =>
            convertGoogleEventToStructured(event, event.calendarId)
        );

        const response: ListEventsResponse = {
            events: structuredEvents,
            totalCount: allEvents.length,
            calendars: calendarIds.length > 1 ? calendarIds : undefined
        };

        return createStructuredResponse(response);
    }

    private async fetchEvents(
        client: OAuth2Client,
        calendarIds: string[],
        options: { timeMin?: string; timeMax?: string; timeZone?: string; fields?: string[]; privateExtendedProperty?: string[]; sharedExtendedProperty?: string[] }
    ): Promise<ExtendedEvent[]> {
        if (calendarIds.length === 1) {
            return this.fetchSingleCalendarEvents(client, calendarIds[0], options);
        }
        
        return this.fetchMultipleCalendarEvents(client, calendarIds, options);
    }

    private async fetchSingleCalendarEvents(
        client: OAuth2Client,
        calendarId: string,
        options: { timeMin?: string; timeMax?: string; timeZone?: string; fields?: string[]; privateExtendedProperty?: string[]; sharedExtendedProperty?: string[] }
    ): Promise<ExtendedEvent[]> {
        try {
            const calendar = this.getCalendar(client);
            
            // Determine timezone with correct precedence:
            // 1. Explicit timeZone parameter (highest priority)  
            // 2. Calendar's default timezone (fallback)
            // Note: convertToRFC3339 will still respect timezone in datetime string as ultimate override
            let timeMin = options.timeMin;
            let timeMax = options.timeMax;
            
            if (timeMin || timeMax) {
                const timezone = options.timeZone || await this.getCalendarTimezone(client, calendarId);
                timeMin = timeMin ? convertToRFC3339(timeMin, timezone) : undefined;
                timeMax = timeMax ? convertToRFC3339(timeMax, timezone) : undefined;
            }
            
            const fieldMask = buildListFieldMask(options.fields);
            
            const response = await calendar.events.list({
                calendarId,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
                ...(fieldMask && { fields: fieldMask }),
                ...(options.privateExtendedProperty && { privateExtendedProperty: options.privateExtendedProperty as any }),
                ...(options.sharedExtendedProperty && { sharedExtendedProperty: options.sharedExtendedProperty as any })
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
        options: { timeMin?: string; timeMax?: string; timeZone?: string; fields?: string[]; privateExtendedProperty?: string[]; sharedExtendedProperty?: string[] }
    ): Promise<ExtendedEvent[]> {
        const batchHandler = new BatchRequestHandler(client);
        
        const requests = await Promise.all(calendarIds.map(async (calendarId) => ({
            method: "GET" as const,
            path: await this.buildEventsPath(client, calendarId, options)
        })));
        
        const responses = await batchHandler.executeBatch(requests);
        
        const { events, errors } = this.processBatchResponses(responses, calendarIds);
        
        if (errors.length > 0) {
            process.stderr.write(`Some calendars had errors: ${errors.map(e => `${e.calendarId}: ${e.error}`).join(', ')}\n`);
        }
        
        return this.sortEventsByStartTime(events);
    }

    private async buildEventsPath(client: OAuth2Client, calendarId: string, options: { timeMin?: string; timeMax?: string; timeZone?: string; fields?: string[]; privateExtendedProperty?: string[]; sharedExtendedProperty?: string[] }): Promise<string> {
        // Determine timezone with correct precedence:
        // 1. Explicit timeZone parameter (highest priority)
        // 2. Calendar's default timezone (fallback)
        // Note: convertToRFC3339 will still respect timezone in datetime string as ultimate override
        let timeMin = options.timeMin;
        let timeMax = options.timeMax;
        
        if (timeMin || timeMax) {
            const timezone = options.timeZone || await this.getCalendarTimezone(client, calendarId);
            timeMin = timeMin ? convertToRFC3339(timeMin, timezone) : undefined;
            timeMax = timeMax ? convertToRFC3339(timeMax, timezone) : undefined;
        }
        
        const fieldMask = buildListFieldMask(options.fields);
        
        const params = new URLSearchParams({
            singleEvents: "true",
            orderBy: "startTime",
        });
        if (timeMin) params.set('timeMin', timeMin);
        if (timeMax) params.set('timeMax', timeMax);
        if (fieldMask) params.set('fields', fieldMask);
        if (options.privateExtendedProperty) {
            for (const kv of options.privateExtendedProperty) params.append('privateExtendedProperty', kv);
        }
        if (options.sharedExtendedProperty) {
            for (const kv of options.sharedExtendedProperty) params.append('sharedExtendedProperty', kv);
        }
        
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

    private groupEventsByCalendar(events: ExtendedEvent[]): Record<string, ExtendedEvent[]> {
        return events.reduce((acc, event) => {
            const calId = event.calendarId;
            if (!acc[calId]) acc[calId] = [];
            acc[calId].push(event);
            return acc;
        }, {} as Record<string, ExtendedEvent[]>);
    }

}
