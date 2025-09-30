import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { DeleteEventInput } from "../../tools/registry.js";
import { DeleteEventResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class DeleteEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = args as DeleteEventInput;
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
