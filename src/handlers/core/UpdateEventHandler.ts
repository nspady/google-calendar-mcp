import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { UpdateEventArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { google, calendar_v3 } from 'googleapis';
import { z } from 'zod';

export class UpdateEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = UpdateEventArgumentsSchema.parse(args);
        const event = await this.updateEvent(oauth2Client, validArgs);
        return {
            content: [{
                type: "text",
                text: `Event updated: ${event.summary} (${event.id})`,
            }],
        };
    }

    private async updateEvent(
        client: OAuth2Client,
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = google.calendar({ version: 'v3', auth: client });
            const requestBody: calendar_v3.Schema$Event = {};
            if (args.summary !== undefined) requestBody.summary = args.summary;
            if (args.description !== undefined) requestBody.description = args.description;

            let timeChanged = false;
            if (args.start !== undefined) {
                requestBody.start = { dateTime: args.start, timeZone: args.timeZone };
                timeChanged = true;
            }
            if (args.end !== undefined) {
                requestBody.end = { dateTime: args.end, timeZone: args.timeZone };
                timeChanged = true;
            }

            // If start or end was changed, ensure both objects exist and have the timezone.
            // Also apply timezone if it's the only time-related field provided (for recurring events)
            if (timeChanged || (!args.start && !args.end && args.timeZone)) {
                if (!requestBody.start) requestBody.start = {};
                if (!requestBody.end) requestBody.end = {};
                // Only add timezone if not already added via dateTime object creation above
                if (!requestBody.start.timeZone) requestBody.start.timeZone = args.timeZone;
                if (!requestBody.end.timeZone) requestBody.end.timeZone = args.timeZone;
            }

            if (args.attendees !== undefined) requestBody.attendees = args.attendees;
            if (args.location !== undefined) requestBody.location = args.location;
            if (args.colorId !== undefined) requestBody.colorId = args.colorId;
            if (args.reminders !== undefined) requestBody.reminders = args.reminders;
            if (args.recurrence !== undefined) requestBody.recurrence = args.recurrence;

            const response = await calendar.events.patch({
                calendarId: args.calendarId,
                eventId: args.eventId,
                requestBody: requestBody,
            });
            if (!response.data) throw new Error('Failed to update event, no data returned');
            return response.data;
        } catch (error) {
            this.handleGoogleApiError(error);
            throw error;
        }
    }
}
