import { BaseToolHandler } from './BaseToolHandler.js';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GetFreeBusyInput } from "../../tools/registry.js";
import { FreeBusyResponse as GoogleFreeBusyResponse } from '../../schemas/types.js';
import { FreeBusyResponse } from '../../types/structured-responses.js';
import { createStructuredResponse } from '../../utils/response-builder.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class FreeBusyEventHandler extends BaseToolHandler {
  async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
    const validArgs = args as GetFreeBusyInput;

    if(!this.isLessThanThreeMonths(validArgs.timeMin,validArgs.timeMax)){
      throw new McpError(
        ErrorCode.InvalidRequest,
        "The time gap between timeMin and timeMax must be less than 3 months"
      );
    }

    const result = await this.queryFreeBusy(oauth2Client, validArgs);

    const response: FreeBusyResponse = {
      timeMin: validArgs.timeMin,
      timeMax: validArgs.timeMax,
      calendars: this.formatCalendarsData(result)
    };

    return createStructuredResponse(response);
  }

  private async queryFreeBusy(
    client: OAuth2Client,
    args: GetFreeBusyInput
  ): Promise<GoogleFreeBusyResponse> {
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
      return response.data as GoogleFreeBusyResponse;
    } catch (error) {
      throw this.handleGoogleApiError(error);
    }
  }

  private isLessThanThreeMonths(timeMin: string, timeMax: string): boolean {
    const minDate = new Date(timeMin);
    const maxDate = new Date(timeMax);

    const diffInMilliseconds = maxDate.getTime() - minDate.getTime();
    const threeMonthsInMilliseconds = 3 * 30 * 24 * 60 * 60 * 1000;

    return diffInMilliseconds <= threeMonthsInMilliseconds;
  }

  private formatCalendarsData(response: GoogleFreeBusyResponse): Record<string, {
    busy: Array<{ start: string; end: string }>;
    errors?: Array<{ domain?: string; reason?: string }>;
  }> {
    const calendars: Record<string, any> = {};

    if (response.calendars) {
      for (const [calId, calData] of Object.entries(response.calendars) as [string, any][]) {
        calendars[calId] = {
          busy: calData.busy?.map((slot: any) => ({
            start: slot.start,
            end: slot.end
          })) || []
        };

        if (calData.errors?.length > 0) {
          calendars[calId].errors = calData.errors.map((err: any) => ({
            domain: err.domain,
            reason: err.reason
          }));
        }
      }
    }

    return calendars;
  }
}
