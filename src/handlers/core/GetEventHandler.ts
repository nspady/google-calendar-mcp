import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
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

        // Get OAuth2Client with automatic account selection for read operations
        // Also resolves calendar name to ID if a name was provided
        const { client: oauth2Client, accountId: selectedAccountId, calendarId: resolvedCalendarId } = await this.getClientWithAutoSelection(
            args.account,
            validArgs.calendarId,
            accounts,
            'read'
        );

        try {
            // Get the event with resolved calendar ID
            const argsWithResolvedCalendar = { ...validArgs, calendarId: resolvedCalendarId };
            const event = await this.getEvent(oauth2Client, argsWithResolvedCalendar);

            if (!event) {
                throw new Error(`Event with ID '${validArgs.eventId}' not found in calendar '${resolvedCalendarId}'.`);
            }

            const response: GetEventResponse = {
                event: convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId)
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
