import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { DeleteCalendarInput } from "../../tools/registry.js";
import { DeleteCalendarResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class DeleteCalendarHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as DeleteCalendarInput;

        // Get OAuth2Client with automatic account selection for write operations
        // Also resolves calendar name to ID if a name was provided
        const { client: oauth2Client, calendarId: resolvedCalendarId } = await this.getClientWithAutoSelection(
            args.account,
            validArgs.calendarId,
            accounts,
            'write'
        );

        // Delete (unsubscribe from) the calendar with resolved calendar ID
        await this.deleteCalendar(oauth2Client, resolvedCalendarId);

        const response: DeleteCalendarResponse = {
            success: true,
            calendarId: resolvedCalendarId,
            message: "Calendar deleted successfully"
        };

        return createStructuredResponse(response);
    }

    private async deleteCalendar(
        client: OAuth2Client,
        calendarId: string
    ): Promise<void> {
        try {
            const calendar = this.getCalendar(client);
            await calendar.calendarList.delete({ calendarId });
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }
}
