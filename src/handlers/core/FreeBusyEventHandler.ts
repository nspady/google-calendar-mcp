import { BaseToolHandler } from './BaseToolHandler.js';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GetFreeBusyInput } from "../../tools/registry.js";
import { FreeBusyResponse as GoogleFreeBusyResponse } from '../../schemas/types.js';
import { FreeBusyResponse } from '../../types/structured-responses.js';
import { createStructuredResponse } from '../../utils/response-builder.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { convertToRFC3339 } from '../utils/datetime.js';

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

      // Determine timezone with correct precedence:
      // 1. Explicit timeZone parameter (highest priority)
      // 2. Primary calendar's default timezone (fallback)
      // 3. UTC if calendar timezone retrieval fails
      let timezone: string;
      if (args.timeZone) {
        timezone = args.timeZone;
      } else {
        try {
          timezone = await this.getCalendarTimezone(client, 'primary');
        } catch (error) {
          // If we can't get the primary calendar's timezone, fall back to UTC
          // This can happen if the user doesn't have access to 'primary' calendar
          timezone = 'UTC';
        }
      }

      // Convert time boundaries to RFC3339 format for Google Calendar API
      // This handles both timezone-aware and timezone-naive datetime strings
      const timeMin = convertToRFC3339(args.timeMin, timezone);
      const timeMax = convertToRFC3339(args.timeMax, timezone);

      // Build request body
      // Note: The timeZone parameter affects the response format, not request interpretation
      // Since timeMin/timeMax are in RFC3339 (with timezone), they're unambiguous
      // But we include timeZone so busy periods in the response use consistent timezone
      const requestBody: any = {
        timeMin,
        timeMax,
        items: args.calendars,
        timeZone: timezone, // Always include to ensure response consistency
      };

      // Only add optional expansion fields if provided
      if (args.groupExpansionMax !== undefined) {
        requestBody.groupExpansionMax = args.groupExpansionMax;
      }
      if (args.calendarExpansionMax !== undefined) {
        requestBody.calendarExpansionMax = args.calendarExpansionMax;
      }

      const response = await calendar.freebusy.query({
        requestBody,
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
