import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { DeleteEventArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { google } from 'googleapis';
import { z } from 'zod';

export class DeleteEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = DeleteEventArgumentsSchema.parse(args);
        await this.deleteEvent(oauth2Client, validArgs);
        return {
            content: [{
                type: "text",
                text: "Event deleted successfully",
            }],
        };
    }

    private async deleteEvent(
        client: OAuth2Client,
        args: z.infer<typeof DeleteEventArgumentsSchema>
    ): Promise<void> {
        try {
            const calendar = google.calendar({ version: 'v3', auth: client });
            await calendar.events.delete({
                calendarId: args.calendarId,
                eventId: args.eventId,
            });
        } catch (error) {
            this.handleGoogleApiError(error);
        }
    }
}
