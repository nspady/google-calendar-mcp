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
                summary: cal.summary ?? undefined,
                description: cal.description ?? undefined,
                location: cal.location ?? undefined,
                timeZone: cal.timeZone ?? undefined,
                summaryOverride: cal.summaryOverride ?? undefined,
                colorId: cal.colorId ?? undefined,
                backgroundColor: cal.backgroundColor ?? undefined,
                foregroundColor: cal.foregroundColor ?? undefined,
                hidden: cal.hidden ?? undefined,
                selected: cal.selected ?? undefined,
                accessRole: cal.accessRole ?? undefined,
                defaultReminders: cal.defaultReminders?.map(r => ({
                    method: (r.method as 'email' | 'popup') || 'popup',
                    minutes: r.minutes || 0
                })),
                notificationSettings: cal.notificationSettings ? {
                    notifications: cal.notificationSettings.notifications?.map(n => ({
                        type: n.type ?? undefined,
                        method: n.method ?? undefined
                    }))
                } : undefined,
                primary: cal.primary ?? undefined,
                deleted: cal.deleted ?? undefined,
                conferenceProperties: cal.conferenceProperties ? {
                    allowedConferenceSolutionTypes: cal.conferenceProperties.allowedConferenceSolutionTypes ?? undefined
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
