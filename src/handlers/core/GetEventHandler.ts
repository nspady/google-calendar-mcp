import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { buildSingleEventFieldMask } from "../../utils/field-mask-builder.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { GetEventResponse, convertGoogleEventToStructured } from "../../types/structured-responses.js";

interface GetEventArgs {
    calendarId: string;
    eventId: string;
    fields?: string[];
    account?: string;
}

export class GetEventHandler extends BaseToolHandler {
    async runTool(args: GetEventArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args;

        // Smart account selection: use specified account or find account with access to calendar
        let oauth2Client: OAuth2Client;
        let selectedAccountId: string | undefined;

        if (args.account) {
            // User specified account - use it
            oauth2Client = this.getClientForAccount(args.account, accounts);
            selectedAccountId = args.account;
        } else {
            // No account specified - try to find account with access (prefer write access)
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

        try {
            const event = await this.getEvent(oauth2Client, validArgs);

            if (!event) {
                throw new Error(`Event with ID '${validArgs.eventId}' not found in calendar '${validArgs.calendarId}'.`);
            }

            const response: GetEventResponse = {
                event: convertGoogleEventToStructured(event, validArgs.calendarId, selectedAccountId)
            };

            return createStructuredResponse(response);
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

    private async getEvent(
        client: OAuth2Client,
        args: GetEventArgs
    ): Promise<calendar_v3.Schema$Event | null> {
        const calendar = this.getCalendar(client);
        
        const fieldMask = buildSingleEventFieldMask(args.fields);
        
        try {
            const response = await calendar.events.get({
                calendarId: args.calendarId,
                eventId: args.eventId,
                ...(fieldMask && { fields: fieldMask })
            });
            
            return response.data;
        } catch (error: any) {
            // Handle 404 as a not found case
            if (error?.code === 404 || error?.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }
}