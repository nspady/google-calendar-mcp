import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3, google } from "googleapis";

export class ListColorsHandler extends BaseToolHandler {
    async runTool(_: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const colors = await this.listColors(oauth2Client);
        return {
            content: [{
                type: "text",
                text: `Available event colors:\n${this.formatColorList(colors)}`,
            }],
        };
    }

    private async listColors(client: OAuth2Client): Promise<calendar_v3.Schema$Colors> {
        try {
            const calendar = google.calendar({ version: 'v3', auth: client });
            const response = await calendar.colors.get();
            if (!response.data) throw new Error('Failed to retrieve colors');
            return response.data;
        } catch (error) {
            this.handleGoogleApiError(error);
            throw error;
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
