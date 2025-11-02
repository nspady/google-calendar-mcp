import { BaseToolHandler } from './BaseToolHandler.js';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GetFreeBusyInput } from "../../tools/registry.js";
import { FreeBusyResponse } from '../../schemas/types.js';

export class FreeBusyEventHandler extends BaseToolHandler {
  async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
    const validArgs = args as GetFreeBusyInput;

    if(!this.isLessThanThreeMonths(validArgs.timeMin,validArgs.timeMax)){
      return {
        content: [{
          type: "text",
          text: "The time gap between timeMin and timeMax must be less than 3 months",
        }],
      }
    }

    const result = await this.queryFreeBusy(oauth2Client, validArgs);
    const summaryText = this.generateAvailabilitySummary(result);

    // CRITICAL FIX: Return BOTH structured JSON data AND text summary
    // This allows machine parsing (scheduling agent) while keeping human readability
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result),  // Return structured JSON for machine parsing
      }],
      // Also include the text summary in a metadata field for human readability
      _meta: {
        summary: summaryText
      }
    };
  }

  private async queryFreeBusy(
    client: OAuth2Client,
    args: GetFreeBusyInput
  ): Promise<FreeBusyResponse> {
    try {
      const calendar = this.getCalendar(client);
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          timeZone: args.timeZone,
          groupExpansionMax: args.groupExpansionMax,
          calendarExpansionMax: args.calendarExpansionMax,
          items: args.calendars,
        },
      });
      return response.data as FreeBusyResponse;
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }

  private isLessThanThreeMonths (timeMin: string, timeMax: string): boolean {
    const minDate = new Date(timeMin);
    const maxDate = new Date(timeMax);

    const diffInMilliseconds = maxDate.getTime() - minDate.getTime();
    const threeMonthsInMilliseconds = 3 * 30 * 24 * 60 * 60 * 1000;

    // Check if the difference is less than or equal to 3 months
    return diffInMilliseconds <= threeMonthsInMilliseconds;
  };

  private generateAvailabilitySummary(response: FreeBusyResponse): string {
    return Object.entries(response.calendars)
      .map(([email, calendarInfo]) => {
        if (calendarInfo.errors?.some(error => error.reason === "notFound")) {
          return `Cannot check availability for ${email} (account not found)\n`;
        }

        if (calendarInfo.busy.length === 0) {
          return `${email} is available during ${response.timeMin} to ${response.timeMax}, please schedule calendar to ${email} if you want \n`;
        }

        const busyTimes = calendarInfo.busy
          .map(slot => `- From ${slot.start} to ${slot.end}`)
          .join("\n");
        return `${email} is busy during:\n${busyTimes}\n`;
      })
      .join("\n")
      .trim();
  }
}
