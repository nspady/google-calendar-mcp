import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { SearchEventsInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { convertToRFC3339 } from "../utils/datetime.js";
import { buildListFieldMask } from "../../utils/field-mask-builder.js";
import { createStructuredResponse, convertEventsToStructured } from "../../utils/response-builder.js";
import { SearchEventsResponse } from "../../types/structured-responses.js";

export class SearchEventsHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as SearchEventsInput;

        // Smart account selection: use specified account or find account with access to calendar
        let oauth2Client: OAuth2Client;
        let selectedAccountId: string | undefined;

        if (args.account) {
            // User specified account - use it
            oauth2Client = this.getClientForAccount(args.account, accounts);
            selectedAccountId = args.account;
        } else {
            // No account specified - try to find account with access
            const accountSelection = await this.getAccountForCalendarWrite(validArgs.calendarId, accounts);
            if (!accountSelection) {
                // Fallback to first account
                oauth2Client = accounts.values().next().value;
                selectedAccountId = Array.from(accounts.keys())[0];
            } else {
                oauth2Client = accountSelection.client;
                selectedAccountId = accountSelection.accountId;
            }
        }

        const events = await this.searchEvents(oauth2Client, validArgs);

        const response: SearchEventsResponse = {
            events: convertEventsToStructured(events, validArgs.calendarId, selectedAccountId),
            totalCount: events.length,
            query: validArgs.query,
            calendarId: validArgs.calendarId
        };

        if (validArgs.timeMin || validArgs.timeMax) {
            const timezone = validArgs.timeZone || await this.getCalendarTimezone(oauth2Client, validArgs.calendarId);
            response.timeRange = {
                start: validArgs.timeMin ? convertToRFC3339(validArgs.timeMin, timezone) : '',
                end: validArgs.timeMax ? convertToRFC3339(validArgs.timeMax, timezone) : ''
            };
        }

        return createStructuredResponse(response);
    }

    private async searchEvents(
        client: OAuth2Client,
        args: SearchEventsInput
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
