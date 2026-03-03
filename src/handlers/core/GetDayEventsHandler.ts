import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { convertGoogleEventToStructured, StructuredEvent } from "../../types/structured-responses.js";

interface GetDayEventsArgs {
    date: string;
    timeZone?: string;
    focusEventId?: string;
}

export class GetDayEventsHandler extends BaseToolHandler {
    async runTool(args: GetDayEventsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Determine timezone: use provided or get from primary calendar of first account
        const firstClient = this.getClientForAccountOrFirst(undefined, accounts);
        const timezone = args.timeZone || await this.getCalendarTimezone(firstClient, 'primary');

        // Fetch all events across all calendars
        const { events: allEvents, colorContext } = await this.fetchDayEventsAllCalendars(
            args.date, timezone, accounts
        );

        // Convert to structured events
        const structuredEvents: StructuredEvent[] = allEvents.map(event =>
            convertGoogleEventToStructured(event, event.calendarId, event.accountId, colorContext)
        );

        // Build day context (pass focusEventId if provided)
        const dayContext = this.dayContextService.buildDayContextForList(
            structuredEvents, args.date, timezone, args.focusEventId
        );

        return createStructuredResponse({ dayContext });
    }
}
