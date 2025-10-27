import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { DeleteEventInput } from "../../tools/registry.js";
import { DeleteEventResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class DeleteEventHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as DeleteEventInput;

        // Smart account selection: use specified account or find best account with write permissions
        let oauth2Client: OAuth2Client;

        if (args.account) {
            // User specified account - use it
            oauth2Client = this.getClientForAccount(args.account, accounts);
        } else {
            // No account specified - find best account with write permissions
            const accountSelection = await this.getAccountForCalendarWrite(validArgs.calendarId, accounts);
            if (!accountSelection) {
                // Fallback to default account if CalendarRegistry doesn't find one
                oauth2Client = this.getClientForAccount(undefined, accounts);
            } else {
                oauth2Client = accountSelection.client;
            }
        }

        await this.deleteEvent(oauth2Client, validArgs);

        const response: DeleteEventResponse = {
            success: true,
            eventId: validArgs.eventId,
            calendarId: validArgs.calendarId,
            message: "Event deleted successfully"
        };

        return createStructuredResponse(response);
    }

    private async deleteEvent(
        client: OAuth2Client,
        args: DeleteEventInput
    ): Promise<void> {
        try {
            const calendar = this.getCalendar(client);
            await calendar.events.delete({
                calendarId: args.calendarId,
                eventId: args.eventId,
                sendUpdates: args.sendUpdates,
            });
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }
}
