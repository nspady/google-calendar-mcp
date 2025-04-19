import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { ListEventsArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { google, calendar_v3 } from 'googleapis';
import { z } from 'zod';

export class ListEventsHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = ListEventsArgumentsSchema.parse(args);
        const events = await this.listEvents(oauth2Client, validArgs);
        return {
            content: [{
                type: "text",
                text: this.formatEventList(events),
            }],
        };
    }

    private async listEvents(
        client: OAuth2Client,
        args: z.infer<typeof ListEventsArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event[]> {
        try {
            const calendar = google.calendar({ version: 'v3', auth: client });
            const response = await calendar.events.list({
                calendarId: args.calendarId,
                timeMin: args.timeMin,
                timeMax: args.timeMax,
                singleEvents: true,
                orderBy: 'startTime',
            });
            return response.data.items || [];
        } catch (error) {
            this.handleGoogleApiError(error);
            throw error;
        }
    }

    /**
     * Formats a list of events into a user-friendly string.
     */
    private formatEventList(events: calendar_v3.Schema$Event[]): string {
        return events
            .map((event) => {
                const attendeeList = event.attendees
                    ? `\nAttendees: ${event.attendees
                        .map((a) => `${a.email || "no-email"} (${a.responseStatus || "unknown"})`)
                        .join(", ")}`
                    : "";
                const locationInfo = event.location ? `\nLocation: ${event.location}` : "";
                const colorInfo = event.colorId ? `\nColor ID: ${event.colorId}` : "";
                const reminderInfo = event.reminders
                    ? `\nReminders: ${event.reminders.useDefault ? 'Using default' :
                        (event.reminders.overrides || []).map((r: any) => `${r.method} ${r.minutes} minutes before`).join(', ') || 'None'}`
                    : "";
                return `${event.summary || "Untitled"} (${event.id || "no-id"})${locationInfo}\nStart: ${event.start?.dateTime || event.start?.date || "unspecified"}\nEnd: ${event.end?.dateTime || event.end?.date || "unspecified"}${attendeeList}${colorInfo}${reminderInfo}\n`;
            })
            .join("\n");
    }
}
