import { BaseToolHandler } from './BaseToolHandler.js';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { FreeBusyEventArgumentsSchema } from "../../schemas/validators.js";
import { z } from "zod";
import { FreeBusyResponse } from '../../schemas/types.js';

export class FreeBusyEventHandler extends BaseToolHandler {
  async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {

    const validArgs = FreeBusyEventArgumentsSchema.safeParse(args);
    if (!validArgs.success) {
      throw new Error(
          `Invalid arguments Error: ${JSON.stringify(validArgs.error.issues)}`
      );
    }

    if(!this.isLessThanThreeMonths(validArgs.data.timeMin,validArgs.data.timeMax)){
      return {
        content: [{
          type: "text",
          text: "The time gap between timeMin and timeMax must be less than 3 months",
        }],
      }
    }

    const result = await this.queryFreeBusy(oauth2Client, validArgs.data);
    const summaryText = this.generateAvailabilitySummary(result);

    return {
      content: [{
        type: "text",
        text: summaryText,
      }]
    };
  }

  private async queryFreeBusy(
    client: OAuth2Client,
    args: z.infer<typeof FreeBusyEventArgumentsSchema>
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
