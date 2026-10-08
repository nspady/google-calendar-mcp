import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from "googleapis";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { EventLabelInfo, ListColorsResponse } from "../../types/structured-responses.js";
import { CalendarWithLabels } from "../../utils/event-labels.js";

interface ListColorsArgs {
    account?: string;
    calendarId?: string;
}

export class ListColorsHandler extends BaseToolHandler {
    async runTool(args: ListColorsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Labels are per calendar, so a calendarId picks the account that can read it;
        // otherwise use specified account or first available (colors API returns same data for all accounts)
        const labelTarget = args.calendarId
            ? await this.getClientWithAutoSelection(args.account, args.calendarId, accounts, 'read')
            : undefined;
        const oauth2Client = labelTarget?.client ?? this.getClientForAccountOrFirst(args.account, accounts);

        const colors = await this.listColors(oauth2Client);
        
        const response: ListColorsResponse = {
            event: {},
            calendar: {}
        };
        
        // Convert event colors
        if (colors.event) {
            for (const [id, color] of Object.entries(colors.event)) {
                response.event[id] = {
                    background: color.background || '',
                    foreground: color.foreground || ''
                };
            }
        }
        
        // Convert calendar colors
        if (colors.calendar) {
            for (const [id, color] of Object.entries(colors.calendar)) {
                response.calendar[id] = {
                    background: color.background || '',
                    foreground: color.foreground || ''
                };
            }
        }
        
        if (labelTarget) {
            response.calendarId = labelTarget.calendarId;
            response.eventLabels = await this.listEventLabels(oauth2Client, labelTarget.calendarId);
        }

        return createStructuredResponse(response);
    }

    private async listEventLabels(client: OAuth2Client, calendarId: string): Promise<EventLabelInfo[]> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendars.get({ calendarId, fields: 'labelProperties' });
            const labels = (response.data as CalendarWithLabels).labelProperties?.eventLabels ?? [];
            return labels
                .filter(label => label.id)
                .map(label => ({
                    id: label.id!,
                    name: label.name ?? undefined,
                    backgroundColor: label.backgroundColor ?? undefined
                }));
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

    private async listColors(client: OAuth2Client): Promise<calendar_v3.Schema$Colors> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.colors.get();
            if (!response.data) throw new Error('Failed to retrieve colors');
            return response.data;
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

}
