import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { calendar_v3 } from "googleapis";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { convertToRFC3339 } from "../utils/datetime.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { FindCalendarConflictsResponse, convertGoogleEventToStructured } from "../../types/structured-responses.js";

interface FindCalendarConflictsArgs {
  account?: string | string[];
  timeMin: string;
  timeMax: string;
  calendarId?: string | string[];
}

interface NormalizedEvent {
  accountId: string;
  calendarId: string;
  event: calendar_v3.Schema$Event;
  startMs: number;
  endMs: number;
}

interface ConflictMatch {
  startMs: number;
  endMs: number;
  events: NormalizedEvent[];
}

export class FindCalendarConflictsHandler extends BaseToolHandler {
  async runTool(args: FindCalendarConflictsArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
    if (!args.timeMin || !args.timeMax) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Both timeMin and timeMax are required to check for conflicts."
      );
    }

    const selectedAccounts = this.getClientsForAccounts(args.account, accounts);
    if (selectedAccounts.size === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "No authenticated accounts available. Please authenticate at least one Google account."
      );
    }

    const calendarSelectors = this.normalizeCalendarSelection(args.calendarId);
    const normalizedEvents: NormalizedEvent[] = [];

    // For multi-account queries, pre-resolve which calendars exist on which accounts
    // This prevents errors when a calendar only exists on specific accounts
    let accountCalendarMap: Map<string, string[]>;

    if (selectedAccounts.size > 1) {
      const { resolved, warnings } = await this.calendarRegistry.resolveCalendarsToAccounts(
        calendarSelectors,
        selectedAccounts
      );
      accountCalendarMap = resolved;

      // If no calendars could be resolved, throw helpful error
      if (accountCalendarMap.size === 0) {
        const allCalendars = await this.calendarRegistry.getUnifiedCalendars(selectedAccounts);
        const calendarList = allCalendars.map(c => `"${c.displayName}" (${c.calendarId})`).join(', ');
        throw new McpError(
          ErrorCode.InvalidRequest,
          `None of the requested calendars could be found: ${calendarSelectors.map(c => `"${c}"`).join(', ')}. ` +
          `Available calendars: ${calendarList || 'none'}. Use 'list-calendars' to see all available calendars.`
        );
      }
    } else {
      // Single account: use existing per-account resolution (strict mode)
      const [accountId, client] = [...selectedAccounts.entries()][0];
      const resolvedCalendars = await this.resolveCalendarIds(client, calendarSelectors);
      accountCalendarMap = new Map([[accountId, resolvedCalendars]]);
    }

    // Fetch events from accounts that have matching calendars
    for (const [accountId, calendarIds] of accountCalendarMap.entries()) {
      const client = selectedAccounts.get(accountId)!;
      for (const calendarId of calendarIds) {
        const timeRange = await this.normalizeTimeRange(client, calendarId, args.timeMin, args.timeMax);
        const calendar = this.getCalendar(client);

        try {
          const response = await calendar.events.list({
            calendarId,
            timeMin: timeRange.timeMin,
            timeMax: timeRange.timeMax,
            singleEvents: true,
            orderBy: "startTime",
            showDeleted: false
          });

          const events = response.data.items || [];
          for (const event of events) {
            const range = this.getEventTimeRange(event);
            if (!range) continue;
            normalizedEvents.push({
              accountId,
              calendarId,
              event,
              startMs: range.startMs,
              endMs: range.endMs
            });
          }
        } catch (error) {
          // If we cannot read a calendar for this account (e.g., permissions), propagate a clear error.
          throw this.handleGoogleApiError(error);
        }
      }
    }

    const conflicts = this.findConflicts(normalizedEvents);

    const response: FindCalendarConflictsResponse = {
      conflicts: conflicts.map(conflict => ({
        overlapStart: new Date(conflict.startMs).toISOString(),
        overlapEnd: new Date(conflict.endMs).toISOString(),
        accountsInvolved: Array.from(new Set(conflict.events.map(event => event.accountId))),
        events: conflict.events.map(event => ({
          accountId: event.accountId,
          calendarId: event.calendarId,
          event: convertGoogleEventToStructured(event.event, event.calendarId, event.accountId)
        }))
      })),
      totalConflicts: conflicts.length,
      accounts: Array.from(selectedAccounts.keys()),
      timeRange: {
        start: args.timeMin,
        end: args.timeMax
      },
      note: conflicts.length === 0
        ? "No overlapping events detected across the selected accounts."
        : `Detected ${conflicts.length} overlapping event pair(s) across ${selectedAccounts.size} account(s).`
    };

    return createStructuredResponse(response);
  }

  private normalizeCalendarSelection(calendarId?: string | string[]): string[] {
    if (!calendarId) {
      return ["primary"];
    }

    if (Array.isArray(calendarId)) {
      if (calendarId.length === 0) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "At least one calendar ID is required when passing a calendarId array."
        );
      }
      return calendarId;
    }

    return [calendarId];
  }

  private async normalizeTimeRange(
    client: OAuth2Client,
    calendarId: string,
    timeMin: string,
    timeMax: string
  ): Promise<{ timeMin: string; timeMax: string }> {
    const requiresConversion = [timeMin, timeMax].some(value => !this.hasExplicitTimezone(value));
    if (!requiresConversion) {
      return { timeMin, timeMax };
    }

    const timezone = await this.getCalendarTimezone(client, calendarId);
    return {
      timeMin: convertToRFC3339(timeMin, timezone),
      timeMax: convertToRFC3339(timeMax, timezone)
    };
  }

  private hasExplicitTimezone(value: string): boolean {
    return value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value);
  }

  private getEventTimeRange(event: calendar_v3.Schema$Event): { startMs: number; endMs: number } | null {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;

    if (!start || !end) {
      return null;
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs === endMs) {
      return null;
    }

    return { startMs, endMs };
  }

  private findConflicts(events: NormalizedEvent[]): ConflictMatch[] {
    const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
    const active: NormalizedEvent[] = [];
    const conflicts: ConflictMatch[] = [];

    for (const event of sorted) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].endMs <= event.startMs) {
          active.splice(i, 1);
        }
      }

      for (const candidate of active) {
        if (candidate.accountId === event.accountId) {
          continue; // Only care about cross-account conflicts
        }

        const overlapStart = Math.max(candidate.startMs, event.startMs);
        const overlapEnd = Math.min(candidate.endMs, event.endMs);

        if (overlapStart < overlapEnd) {
          conflicts.push({
            startMs: overlapStart,
            endMs: overlapEnd,
            events: [candidate, event]
          });
        }
      }

      active.push(event);
    }

    return conflicts;
  }
}
