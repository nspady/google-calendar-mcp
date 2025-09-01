import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from "googleapis";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { ListColorsResponse } from "../../types/structured-responses.js";

export class ListColorsHandler extends BaseToolHandler {
    async runTool(_: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
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
        
        return createStructuredResponse(response);
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

    /**
     * Formats the color information into a user-friendly string.
     */
    private formatColorList(colors: calendar_v3.Schema$Colors): string {
        const eventColors = colors.event || {};
        return Object.entries(eventColors)
            .map(([id, colorInfo]) => `Color ID: ${id} - ${colorInfo.background} (background) / ${colorInfo.foreground} (foreground)`)
            .join("\n");
    }
}
