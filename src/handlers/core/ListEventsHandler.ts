import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { BatchRequestHandler } from "./BatchRequestHandler.js";
import { convertToRFC3339 } from "../utils/datetime.js";
import { buildListFieldMask } from "../../utils/field-mask-builder.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { ListEventsResponse, StructuredEvent, convertGoogleEventToStructured } from "../../types/structured-responses.js";

// Extended event type to include calendar ID and account ID for tracking source
interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId: string;
  accountId?: string;
}

interface ListEventsArgs {
  calendarId: string | string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  fields?: string[];
  privateExtendedProperty?: string[];
  sharedExtendedProperty?: string[];
  account?: string | string[];
}

export class ListEventsHandler extends BaseToolHandler {
    async runTool(args: ListEventsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Get clients for specified accounts (supports single or multiple)
        const selectedAccounts = this.getClientsForAccounts(args.account, accounts);
        const partialFailures: Array<{ accountId: string; reason: string }> = [];
        const resolutionWarnings: string[] = [];

        // Normalize calendarId to always be an array for consistent processing
        const calendarNamesOrIds = Array.isArray(args.calendarId)
            ? args.calendarId
            : [args.calendarId];

        // For multi-account queries, pre-resolve calendars to their owning accounts
        // This prevents "calendar not found" errors when a calendar only exists on some accounts
        let accountCalendarMap: Map<string, string[]>;

        if (selectedAccounts.size > 1) {
            // Multi-account: route calendars to their owning accounts using CalendarRegistry
            const { resolved, warnings } = await this.calendarRegistry.resolveCalendarsToAccounts(
                calendarNamesOrIds,
                selectedAccounts
            );
            accountCalendarMap = resolved;
            resolutionWarnings.push(...warnings);

            // If no calendars could be resolved on any account, throw error
            if (accountCalendarMap.size === 0) {
                const allCalendars = await this.calendarRegistry.getUnifiedCalendars(selectedAccounts);
                const calendarList = allCalendars.map(c => `"${c.displayName}" (${c.calendarId})`).join(', ');
                throw this.createError(
                    `None of the requested calendars could be found: ${calendarNamesOrIds.map(c => `"${c}"`).join(', ')}. ` +
                    `Available calendars: ${calendarList || 'none'}. Use 'list-calendars' to see all available calendars.`
                );
            }
        } else {
            // Single account: use existing per-account resolution (strict mode)
            // All calendars go to the single account - will error if not found
            const [accountId] = selectedAccounts.keys();
            accountCalendarMap = new Map([[accountId, calendarNamesOrIds]]);
        }

        // Fetch events from accounts that have matching calendars
        const eventsPerAccount = await Promise.all(
            Array.from(accountCalendarMap.entries()).map(async ([accountId, calendarsForAccount]) => {
                const client = selectedAccounts.get(accountId)!;
                try {
                    // For single-account, resolve names to IDs (strict mode)
                    // For multi-account, calendars are already resolved IDs
                    const calendarIds = selectedAccounts.size === 1
                        ? await this.resolveCalendarIds(client, calendarsForAccount)
                        : calendarsForAccount;

                    const events = await this.fetchEvents(client, calendarIds, {
                        timeMin: args.timeMin,
                        timeMax: args.timeMax,
                        timeZone: args.timeZone,
                        fields: args.fields,
                        privateExtendedProperty: args.privateExtendedProperty,
                        sharedExtendedProperty: args.sharedExtendedProperty
                    });

                    // Tag events with account ID and return metadata
                    return {
                        accountId,
                        calendarIds,
                        events: events.map(event => ({ ...event, accountId }))
                    };
                } catch (error) {
                    // For single account, propagate error
                    if (selectedAccounts.size === 1) {
                        throw error;
                    }
                    const reason = error instanceof Error ? error.message : String(error);
                    partialFailures.push({
                        accountId,
                        reason
                    });
                    process.stderr.write(`Warning: Failed to load events for account "${accountId}": ${reason}\n`);
                    // For multi-account, continue with other accounts
                    return { accountId, calendarIds: [], events: [] };
                }
            })
        );

        // Flatten and merge all events and calendar IDs
        const allEvents = eventsPerAccount.flatMap(result => result.events);
        const allQueriedCalendarIds = [...new Set(eventsPerAccount.flatMap(result => result.calendarIds))];

        // Sort events chronologically
        allEvents.sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
        });

        // Convert extended events to structured format
        const structuredEvents: StructuredEvent[] = allEvents.map(event =>
            convertGoogleEventToStructured(event, event.calendarId, event.accountId)
        );
        const warnings: string[] = [...resolutionWarnings];

        // Build detailed warnings for partial failures
        if (partialFailures.length > 0) {
            for (const failure of partialFailures) {
                warnings.push(`Account "${failure.accountId}" failed: ${failure.reason}`);
            }
        }

        // Build note based on results
        let note: string | undefined;
        if (selectedAccounts.size > 1) {
            const successfulAccounts = selectedAccounts.size - partialFailures.length;
            if (partialFailures.length > 0) {
                note = `⚠️ Partial results: Retrieved events from ${successfulAccounts} of ${selectedAccounts.size} account(s). ${partialFailures.length} account(s) failed - see warnings for details.`;
            } else {
                note = `Showing merged events from ${selectedAccounts.size} account(s), sorted chronologically`;
            }
        }

        const response: ListEventsResponse = {
            events: structuredEvents,
            totalCount: allEvents.length,
            calendars: allQueriedCalendarIds.length > 1 ? allQueriedCalendarIds : undefined,
            ...(partialFailures.length > 0 && { partialFailures }),
            ...(warnings.length > 0 && { warnings }),
            ...(selectedAccounts.size > 1 && { accounts: Array.from(selectedAccounts.keys()) }),
            ...(note && { note })
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
