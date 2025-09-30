import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from "googleapis";
import { ListCalendarsResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class ListCalendarsHandler extends BaseToolHandler {
    async runTool(_: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const calendars = await this.listCalendars(oauth2Client);

        const response: ListCalendarsResponse = {
            calendars: calendars.map(cal => ({
                id: cal.id || '',
                summary: cal.summary,
                description: cal.description,
                location: cal.location,
                timeZone: cal.timeZone,
                summaryOverride: cal.summaryOverride,
                colorId: cal.colorId,
                backgroundColor: cal.backgroundColor,
                foregroundColor: cal.foregroundColor,
                hidden: cal.hidden,
                selected: cal.selected,
                accessRole: cal.accessRole,
                defaultReminders: cal.defaultReminders?.map(r => ({
                    method: (r.method as 'email' | 'popup') || 'popup',
                    minutes: r.minutes || 0
                })),
                notificationSettings: cal.notificationSettings ? {
                    notifications: cal.notificationSettings.notifications?.map(n => ({
                        type: n.type,
                        method: n.method
                    }))
                } : undefined,
                primary: cal.primary,
                deleted: cal.deleted,
                conferenceProperties: cal.conferenceProperties ? {
                    allowedConferenceSolutionTypes: cal.conferenceProperties.allowedConferenceSolutionTypes
                } : undefined
            })),
            totalCount: calendars.length
        };

        return createStructuredResponse(response);
    }

    private async listCalendars(client: OAuth2Client): Promise<calendar_v3.Schema$CalendarListEntry[]> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendarList.list();
            return response.data.items || [];
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }
}
