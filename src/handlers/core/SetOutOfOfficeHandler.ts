import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { createTimeObject } from "../utils/datetime.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { CreateEventResponse, convertGoogleEventToStructured } from "../../types/structured-responses.js";

export type SetOutOfOfficeInput = {
    account?: string;
    calendarId: string;
    summary?: string;
    start: string;
    end: string;
    timeZone?: string;
    autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
    declineMessage?: string;
};

export class SetOutOfOfficeHandler extends BaseToolHandler {
    async runTool(args: SetOutOfOfficeInput, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Get OAuth2Client with automatic account selection for write operations
        const { client: oauth2Client, accountId: selectedAccountId, calendarId: resolvedCalendarId } = await this.getClientWithAutoSelection(
            args.account,
            args.calendarId,
            accounts,
            'write'
        );

        // Out of Office events only work on primary calendar
        if (resolvedCalendarId !== 'primary' && !resolvedCalendarId.includes('@')) {
            throw new Error(
                'Out of Office events can only be created on the primary calendar. ' +
                'Use calendarId: "primary" or your email address.'
            );
        }

        const event = await this.createOutOfOfficeEvent(oauth2Client, {
            ...args,
            calendarId: resolvedCalendarId
        });

        const response: CreateEventResponse = {
            event: convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId),
            warnings: []
        };

        return createStructuredResponse(response);
    }

    private async createOutOfOfficeEvent(
        client: OAuth2Client,
        args: SetOutOfOfficeInput
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = this.getCalendar(client);

            // Use provided timezone or calendar's default timezone
            const timezone = args.timeZone || await this.getCalendarTimezone(client, args.calendarId);

            // Build outOfOfficeProperties
            const outOfOfficeProperties: calendar_v3.Schema$EventOutOfOfficeProperties = {
                autoDeclineMode: args.autoDeclineMode || 'declineAllConflictingInvitations',
                ...(args.declineMessage && { declineMessage: args.declineMessage })
            };

            const requestBody: calendar_v3.Schema$Event = {
                summary: args.summary || 'Out of office',
                start: createTimeObject(args.start, timezone),
                end: createTimeObject(args.end, timezone),
                eventType: 'outOfOffice',
                // Out of office events should block time and be visible
                transparency: 'opaque',
                outOfOfficeProperties: outOfOfficeProperties
            };

            const response = await calendar.events.insert({
                calendarId: args.calendarId,
                requestBody: requestBody
            });

            if (!response.data) throw new Error('Failed to create out of office event, no data returned');
            return response.data;
        } catch (error: any) {
            throw this.handleGoogleApiError(error);
        }
    }
}
