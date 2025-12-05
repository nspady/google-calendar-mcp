import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { SearchEventsInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { convertToRFC3339 } from "../utils/datetime.js";
import { buildListFieldMask } from "../../utils/field-mask-builder.js";
import { createStructuredResponse, convertEventsToStructured } from "../../utils/response-builder.js";
import { SearchEventsResponse, StructuredEvent, convertGoogleEventToStructured } from "../../types/structured-responses.js";

// Extended event type to include calendar ID and account ID for tracking source
interface ExtendedEvent extends calendar_v3.Schema$Event {
    calendarId: string;
    accountId?: string;
}

// Internal args type for searchEvents with single calendarId (after normalization)
interface SearchEventsArgs {
    calendarId: string;
    query: string;
    timeMin: string;
    timeMax: string;
    timeZone?: string;
    fields?: string[];
    privateExtendedProperty?: string[];
    sharedExtendedProperty?: string[];
}

export class SearchEventsHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as SearchEventsInput;

        // Normalize calendarId to always be an array for consistent processing
        const calendarNamesOrIds = Array.isArray(validArgs.calendarId)
            ? validArgs.calendarId
            : [validArgs.calendarId];

        // Get clients for specified accounts (supports single or multiple)
        const selectedAccounts = this.getClientsForAccounts(args.account, accounts);

        // For multi-account/multi-calendar queries, use CalendarRegistry routing
        let accountCalendarMap: Map<string, string[]>;
        const resolutionWarnings: string[] = [];

        if (selectedAccounts.size > 1 || calendarNamesOrIds.length > 1) {
            // Multi-account or multi-calendar: route calendars to their owning accounts
            const { resolved, warnings } = await this.calendarRegistry.resolveCalendarsToAccounts(
                calendarNamesOrIds,
                selectedAccounts
            );
            accountCalendarMap = resolved;
            resolutionWarnings.push(...warnings);

            // If no calendars could be resolved, throw error
            if (accountCalendarMap.size === 0) {
                const allCalendars = await this.calendarRegistry.getUnifiedCalendars(selectedAccounts);
                const calendarList = allCalendars.map(c => `"${c.displayName}" (${c.calendarId})`).join(', ');
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `None of the requested calendars could be found: ${calendarNamesOrIds.map(c => `"${c}"`).join(', ')}. ` +
                    `Available calendars: ${calendarList || 'none'}. Use 'list-calendars' to see all available calendars.`
                );
            }
        } else {
            // Single account + single calendar: use existing auto-selection for simplicity
            const { client, accountId, calendarId } = await this.getClientWithAutoSelection(
                args.account,
                calendarNamesOrIds[0],  // Use normalized single-element array
                accounts,
                'read'
            );
            accountCalendarMap = new Map([[accountId, [calendarId]]]);
        }

        // Search events from all calendars across all accounts
        const allEvents: ExtendedEvent[] = [];
        const queriedCalendarIds: string[] = [];

        await Promise.all(
            Array.from(accountCalendarMap.entries()).map(async ([accountId, calendarIds]) => {
                const client = selectedAccounts.get(accountId)!;
                for (const calendarId of calendarIds) {
                    try {
                        const events = await this.searchEvents(client, {
                            ...validArgs,
                            calendarId
                        });
                        // Tag events with account ID and calendar ID
                        for (const event of events) {
                            allEvents.push({
                                ...event,
                                calendarId,
                                accountId
                            });
                        }
                        queriedCalendarIds.push(calendarId);
                    } catch (error) {
                        // For multi-calendar, log but continue
                        if (accountCalendarMap.size > 1 || calendarIds.length > 1) {
                            const message = error instanceof Error ? error.message : String(error);
                            resolutionWarnings.push(`Failed to search calendar "${calendarId}" on account "${accountId}": ${message}`);
                        } else {
                            throw error;
                        }
                    }
                }
            })
        );

        // Sort events chronologically
        allEvents.sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
        });

        // Convert to structured format
        const structuredEvents: StructuredEvent[] = allEvents.map(event =>
            convertGoogleEventToStructured(event, event.calendarId, event.accountId)
        );

        const response: SearchEventsResponse = {
            events: structuredEvents,
            totalCount: allEvents.length,
            query: validArgs.query,
            // For single calendar, include calendarId; for multiple, include calendars array
            ...(queriedCalendarIds.length === 1 && { calendarId: queriedCalendarIds[0] }),
            ...(queriedCalendarIds.length > 1 && { calendars: queriedCalendarIds }),
            ...(selectedAccounts.size > 1 && { accounts: Array.from(selectedAccounts.keys()) }),
            ...(resolutionWarnings.length > 0 && { warnings: resolutionWarnings })
        };

        if (validArgs.timeMin || validArgs.timeMax) {
            // Use first calendar's timezone as reference (map is guaranteed non-empty at this point)
            const firstAccountId = accountCalendarMap.keys().next().value as string;
            const firstCalendarId = accountCalendarMap.get(firstAccountId)?.[0] || 'primary';
            const client = selectedAccounts.get(firstAccountId)!;
            const timezone = validArgs.timeZone || await this.getCalendarTimezone(client, firstCalendarId);
            response.timeRange = {
                start: validArgs.timeMin ? convertToRFC3339(validArgs.timeMin, timezone) : '',
                end: validArgs.timeMax ? convertToRFC3339(validArgs.timeMax, timezone) : ''
            };
        }

        return createStructuredResponse(response);
    }

    private async searchEvents(
        client: OAuth2Client,
        args: SearchEventsArgs
    ): Promise<calendar_v3.Schema$Event[]> {
        try {
            const calendar = this.getCalendar(client);
            
            // Determine timezone with correct precedence:
            // 1. Explicit timeZone parameter (highest priority)
            // 2. Calendar's default timezone (fallback)
            const timezone = args.timeZone || await this.getCalendarTimezone(client, args.calendarId);
            
            // Convert time boundaries to RFC3339 format for Google Calendar API
            // Note: convertToRFC3339 will still respect timezone in datetime string as highest priority
            const timeMin = convertToRFC3339(args.timeMin, timezone);
            const timeMax = convertToRFC3339(args.timeMax, timezone);
            
            const fieldMask = buildListFieldMask(args.fields);
            
            const response = await calendar.events.list({
                calendarId: args.calendarId,
                q: args.query,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
                ...(fieldMask && { fields: fieldMask }),
                ...(args.privateExtendedProperty && { privateExtendedProperty: args.privateExtendedProperty as any }),
                ...(args.sharedExtendedProperty && { sharedExtendedProperty: args.sharedExtendedProperty as any })
            });
            return response.data.items || [];
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

}
