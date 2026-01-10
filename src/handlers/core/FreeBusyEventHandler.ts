import { BaseToolHandler } from './BaseToolHandler.js';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GetFreeBusyInput } from "../../tools/registry.js";
import { FreeBusyResponse as GoogleFreeBusyResponse } from '../../schemas/types.js';
import { FreeBusyResponse, BusySlot } from '../../types/structured-responses.js';
import { createStructuredResponse } from '../../utils/response-builder.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { convertToRFC3339 } from '../../utils/datetime.js';

interface FreeBusyCalendarResult {
  busy: BusySlot[];
  errors?: Array<{ domain?: string; reason?: string }>;
}

export class FreeBusyEventHandler extends BaseToolHandler {
  async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    const validArgs = args as GetFreeBusyInput;

    if (!this.isLessThanThreeMonths(validArgs.timeMin, validArgs.timeMax)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "The time gap between timeMin and timeMax must be less than 3 months"
      );
    }

    // Get clients for specified accounts (or all if not specified)
    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);

    // Query freebusy from all selected accounts and merge results
    const mergedCalendars = await this.queryFreeBusyMultiAccount(selectedAccounts, validArgs);

    const response: FreeBusyResponse = {
      timeMin: validArgs.timeMin,
      timeMax: validArgs.timeMax,
      calendars: mergedCalendars
    };

    return createStructuredResponse(response);
  }

  private async queryFreeBusyMultiAccount(
    accounts: Map<string, OAuth2Client>,
    args: GetFreeBusyInput
  ): Promise<Record<string, FreeBusyCalendarResult>> {
    const mergedCalendars: Record<string, FreeBusyCalendarResult> = {};
    const calendarIds = args.calendars.map(c => c.id);

    // For multi-account queries, pre-resolve which calendars exist on which accounts
    // This prevents the "cartesian product" problem where we try to query all calendars
    // from all accounts, causing failures when a calendar doesn't exist on an account
    let accountCalendarMap: Map<string, string[]>;
    const resolutionWarnings: string[] = [];

    if (accounts.size > 1) {
      const { resolved, warnings } = await this.calendarRegistry.resolveCalendarsToAccounts(
        calendarIds,
        accounts
      );
      accountCalendarMap = resolved;
      resolutionWarnings.push(...warnings);

      // If no calendars could be resolved, mark all as not found
      if (accountCalendarMap.size === 0) {
        for (const calId of calendarIds) {
          mergedCalendars[calId] = {
            busy: [],
            errors: [{ reason: 'notFound' }]
          };
        }
        return mergedCalendars;
      }
    } else {
      // Single account: send all calendars to that account
      const [accountId] = accounts.keys();
      accountCalendarMap = new Map([[accountId, calendarIds]]);
    }

    // Query from each account with only the calendars that exist on that account
    const results = await Promise.all(
      Array.from(accountCalendarMap.entries()).map(async ([accountId, calendarsForAccount]) => {
        const client = accounts.get(accountId)!;
        try {
          // Filter args.calendars to only include those routed to this account
          const filteredArgs: GetFreeBusyInput = {
            ...args,
            calendars: args.calendars.filter(c => calendarsForAccount.includes(c.id))
          };
          const result = await this.queryFreeBusy(client, filteredArgs);
          return { accountId, result, error: null, calendarsQueried: calendarsForAccount };
        } catch (error) {
          // Log but don't fail - other accounts might succeed
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Warning: FreeBusy query failed for account "${accountId}": ${message}\n`);
          return { accountId, result: null, error: message, calendarsQueried: calendarsForAccount };
        }
      })
    );

    // Merge results from all accounts
    // For each calendar, prefer results without errors
    for (const calId of calendarIds) {
      let bestResult: FreeBusyCalendarResult | null = null;

      for (const { result } of results) {
        if (!result?.calendars) continue;

        const calData = result.calendars[calId];
        if (!calData) continue;

        // If we don't have a result yet, or this one has no errors but previous did, use this one
        if (!bestResult) {
          bestResult = {
            busy: calData.busy?.map((slot: any) => ({ start: slot.start, end: slot.end })) || [],
            errors: calData.errors?.map((err: any) => ({ domain: err.domain, reason: err.reason }))
          };
        } else if (bestResult.errors && !calData.errors) {
          // Current best has errors but this one doesn't - prefer this one
          bestResult = {
            busy: calData.busy?.map((slot: any) => ({ start: slot.start, end: slot.end })) || []
          };
        }
      }

      // If no account returned data for this calendar, mark it as not found
      if (!bestResult) {
        mergedCalendars[calId] = {
          busy: [],
          errors: [{ reason: 'notFound' }]
        };
      } else {
        mergedCalendars[calId] = bestResult;
      }
    }

    return mergedCalendars;
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
}
