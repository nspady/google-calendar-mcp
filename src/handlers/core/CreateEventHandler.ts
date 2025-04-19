import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { CreateEventArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3, google } from 'googleapis';
import { z } from 'zod';

export class CreateEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = CreateEventArgumentsSchema.parse(args);
        const event = await this.createEvent(oauth2Client, validArgs);
        return {
            content: [{
                type: "text",
                text: `Event created: ${event.summary} (${event.id})`,
            }],
        };
    }

    private async createEvent(
        client: OAuth2Client,
        args: z.infer<typeof CreateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = google.calendar({ version: 'v3', auth: client });
            const requestBody: calendar_v3.Schema$Event = {
                summary: args.summary,
                description: args.description,
                start: { dateTime: args.start, timeZone: args.timeZone },
                end: { dateTime: args.end, timeZone: args.timeZone },
                attendees: args.attendees,
                location: args.location,
                colorId: args.colorId,
                reminders: args.reminders,
                recurrence: args.recurrence,
            };
            const response = await calendar.events.insert({
                calendarId: args.calendarId,
                requestBody: requestBody,
            });
            if (!response.data) throw new Error('Failed to create event, no data returned');
            return response.data;
        } catch (error) {
            this.handleGoogleApiError(error);
            throw error;
        }
    }
}
