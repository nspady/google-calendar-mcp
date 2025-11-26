import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { DeleteEventInput } from "../../tools/registry.js";
import { DeleteEventResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class DeleteEventHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as DeleteEventInput;

        // Get OAuth2Client with automatic account selection for write operations
        // Also resolves calendar name to ID if a name was provided
        const { client: oauth2Client, calendarId: resolvedCalendarId } = await this.getClientWithAutoSelection(
            args.account,
            validArgs.calendarId,
            accounts,
            'write'
        );

        // Delete the event with resolved calendar ID
        const argsWithResolvedCalendar = { ...validArgs, calendarId: resolvedCalendarId };
        await this.deleteEvent(oauth2Client, argsWithResolvedCalendar);

        const response: DeleteEventResponse = {
            success: true,
            eventId: validArgs.eventId,
            calendarId: resolvedCalendarId,
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
