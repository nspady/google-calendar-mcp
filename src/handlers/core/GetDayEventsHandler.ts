import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { BatchRequestHandler } from "./BatchRequestHandler.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { convertGoogleEventToStructured, ExtendedEvent, EventColorContext, StructuredEvent } from "../../types/structured-responses.js";
import { DayContextService } from "../../services/day-context/index.js";
import { convertToRFC3339 } from "../../utils/datetime.js";

interface GetDayEventsArgs {
    date: string;
    timeZone?: string;
    focusEventId?: string;
}

export class GetDayEventsHandler extends BaseToolHandler {
    private dayContextService: DayContextService;

    constructor() {
        super();
        this.dayContextService = new DayContextService();
    }

    async runTool(args: GetDayEventsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Get all accounts
        const allAccounts = this.getClientsForAccounts(undefined, accounts);

        // Get unified calendar list (cached, 5-min TTL)
        const unifiedCalendars = await this.calendarRegistry.getUnifiedCalendars(allAccounts);

        // Group calendars by preferredAccount to avoid duplicate fetches of shared calendars
        const calendarsByAccount = new Map<string, string[]>();
        for (const cal of unifiedCalendars) {
            const accountId = cal.preferredAccount;
            const existing = calendarsByAccount.get(accountId) || [];
            existing.push(cal.calendarId);
            calendarsByAccount.set(accountId, existing);
        }

        // Determine timezone: use provided or get from primary calendar of first account
        const firstAccountId = Array.from(allAccounts.keys()).sort()[0];
        const firstClient = allAccounts.get(firstAccountId)!;
        const timezone = args.timeZone || await this.getCalendarTimezone(firstClient, 'primary');

        // Build time range for the full day
        const timeMin = convertToRFC3339(`${args.date}T00:00:00`, timezone);
        const timeMax = convertToRFC3339(`${args.date}T23:59:59`, timezone);

        // Fetch events from all accounts in parallel, with per-account error handling
        const eventsPerAccount: Array<{ accountId: string; calendarIds: string[]; events: ExtendedEvent[] }> = [];

        await Promise.all(
            Array.from(calendarsByAccount.entries()).map(async ([accountId, calendarIds]) => {
                const client = allAccounts.get(accountId);
                if (!client) return;

                try {
                    const events = await this.fetchEventsForAccount(
                        client, calendarIds, accountId, timeMin, timeMax
                    );
                    eventsPerAccount.push({ accountId, calendarIds, events });
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    process.stderr.write(`[GetDayEventsHandler] Failed to fetch events for account "${accountId}": ${reason}\n`);
                    eventsPerAccount.push({ accountId, calendarIds, events: [] });
                }
            })
        );

        // Flatten and sort all events
        const allEvents = eventsPerAccount.flatMap(r => r.events);
        this.sortEventsByStartTime(allEvents);

        // Build color context from all accounts
        const colorContext = await this.buildMultiAccountColorContext(
            eventsPerAccount, allAccounts
        );

        // Convert to structured events
        const structuredEvents: StructuredEvent[] = allEvents.map(event =>
            convertGoogleEventToStructured(event, event.calendarId, event.accountId, colorContext)
        );

        // Build day context
        const dayContext = this.dayContextService.buildDayContextForList(
            structuredEvents, args.date, timezone
        );

        // Override focusEventId if provided
        if (args.focusEventId) {
            dayContext.focusEventId = args.focusEventId;
        }

        return createStructuredResponse({ dayContext });
    }

    private async fetchEventsForAccount(
        client: OAuth2Client,
        calendarIds: string[],
        accountId: string,
        timeMin: string,
        timeMax: string
    ): Promise<ExtendedEvent[]> {
        if (calendarIds.length === 1) {
            return this.fetchSingleCalendar(client, calendarIds[0], accountId, timeMin, timeMax);
        }
        return this.fetchMultipleCalendars(client, calendarIds, accountId, timeMin, timeMax);
    }

    private async fetchSingleCalendar(
        client: OAuth2Client,
        calendarId: string,
        accountId: string,
        timeMin: string,
        timeMax: string
    ): Promise<ExtendedEvent[]> {
        const calendar = this.getCalendar(client);
        const response = await calendar.events.list({
            calendarId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime'
        });

        return (response.data.items || []).map(event => ({
            ...event,
            calendarId,
            accountId
        }));
    }

    private async fetchMultipleCalendars(
        client: OAuth2Client,
        calendarIds: string[],
        accountId: string,
        timeMin: string,
        timeMax: string
    ): Promise<ExtendedEvent[]> {
        const batchHandler = new BatchRequestHandler(client);

        const requests = calendarIds.map(calendarId => {
            const params = new URLSearchParams({
                singleEvents: 'true',
                orderBy: 'startTime',
                timeMin,
                timeMax
            });
            return {
                method: 'GET' as const,
                path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
            };
        });

        const responses = await batchHandler.executeBatch(requests);
        const events: ExtendedEvent[] = [];

        responses.forEach((response, index) => {
            const calendarId = calendarIds[index];
            if (response.statusCode === 200 && response.body?.items) {
                for (const event of response.body.items) {
                    events.push({ ...event, calendarId, accountId });
                }
            } else {
                const errorMessage = response.body?.error?.message || `HTTP ${response.statusCode}`;
                process.stderr.write(`[GetDayEventsHandler] Batch error for calendar "${calendarId}": ${errorMessage}\n`);
            }
        });

        return events;
    }

    private async buildMultiAccountColorContext(
        eventsPerAccount: Array<{ accountId: string; calendarIds: string[]; events: ExtendedEvent[] }>,
        allAccounts: Map<string, OAuth2Client>
    ): Promise<EventColorContext> {
        // Event palette is global — fetch from first account
        const firstAccountId = Array.from(allAccounts.keys()).sort()[0];
        const firstClient = allAccounts.get(firstAccountId)!;
        const eventPalette = await this.getEventColorPalette(firstClient);

        // Collect calendar colors from each account
        const calendarColors: Record<string, { background: string; foreground: string }> = {};
        const calendarNames: Record<string, string> = {};

        await Promise.all(
            eventsPerAccount
                .filter(r => r.calendarIds.length > 0)
                .map(async (r) => {
                    const client = allAccounts.get(r.accountId);
                    if (client) {
                        const data = await this.getCalendarColors(client, r.calendarIds);
                        Object.assign(calendarColors, data.colors);
                        Object.assign(calendarNames, data.names);
                    }
                })
        );

        return { eventPalette, calendarColors, calendarNames };
    }
}
