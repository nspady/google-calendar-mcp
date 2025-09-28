import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConflictCheckResult } from "../services/conflict-detection/types.js";
import { 
  ConflictInfo, 
  DuplicateInfo,
  convertGoogleEventToStructured,
  StructuredEvent
} from "../types/structured-responses.js";
import { calendar_v3 } from "googleapis";

/**
 * Creates a structured JSON response for MCP tools
 */
export function createStructuredResponse<T>(data: T): CallToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data, null, 2)
    }]
  };
}

/**
 * Converts conflict check results to structured format
 */
export function convertConflictsToStructured(
  conflicts: ConflictCheckResult
): { conflicts?: ConflictInfo[]; duplicates?: DuplicateInfo[] } {
  const result: { conflicts?: ConflictInfo[]; duplicates?: DuplicateInfo[] } = {};
  
  if (conflicts.duplicates.length > 0) {
    result.duplicates = conflicts.duplicates.map(dup => {
      // Get start and end from fullEvent if available
      let start = '';
      let end = '';
      if (dup.fullEvent) {
        start = dup.fullEvent.start?.dateTime || dup.fullEvent.start?.date || '';
        end = dup.fullEvent.end?.dateTime || dup.fullEvent.end?.date || '';
      }
      
      return {
        event: {
          id: dup.event.id || '',
          title: dup.event.title,
          start,
          end,
          url: dup.event.url,
          similarity: dup.event.similarity
        },
        calendarId: dup.calendarId || '',
        suggestion: dup.suggestion
      };
    });
  }
  
  if (conflicts.conflicts.length > 0) {
    result.conflicts = conflicts.conflicts.map(conflict => {
      // Get start and end from either the event object or fullEvent
      let start = conflict.event.start || '';
      let end = conflict.event.end || '';
      if (!start && conflict.fullEvent) {
        start = conflict.fullEvent.start?.dateTime || conflict.fullEvent.start?.date || '';
      }
      if (!end && conflict.fullEvent) {
        end = conflict.fullEvent.end?.dateTime || conflict.fullEvent.end?.date || '';
      }
      
      return {
        event: {
          id: conflict.event.id || '',
          title: conflict.event.title,
          start,
          end,
          url: conflict.event.url,
          similarity: conflict.similarity
        },
        calendar: conflict.calendar,
        overlap: conflict.overlap ? {
          duration: conflict.overlap.duration,
          percentage: `${conflict.overlap.percentage}%`
        } : undefined
      };
    });
  }
  
  return result;
}

/**
 * Converts an array of Google Calendar events to structured format
 */
export function convertEventsToStructured(
  events: calendar_v3.Schema$Event[],
  calendarId?: string
): StructuredEvent[] {
  return events.map(event => convertGoogleEventToStructured(event, calendarId));
}

/**
 * Helper to add calendar ID to events
 */
export function addCalendarIdToEvents(
  events: calendar_v3.Schema$Event[],
  calendarId: string
): StructuredEvent[] {
  return events.map(event => ({
    ...convertGoogleEventToStructured(event),
    calendarId
  }));
}

/**
 * Formats free/busy information into structured format
 */
export function formatFreeBusyStructured(
  freeBusy: any,
  timeMin: string,
  timeMax: string
): {
  timeMin: string;
  timeMax: string;
  calendars: Record<string, {
    busy: Array<{ start: string; end: string }>;
    errors?: Array<{ domain?: string; reason?: string }>;
  }>;
} {
  const calendars: Record<string, any> = {};
  
  if (freeBusy.calendars) {
    for (const [calId, calData] of Object.entries(freeBusy.calendars) as [string, any][]) {
      calendars[calId] = {
        busy: calData.busy?.map((slot: any) => ({
          start: slot.start,
          end: slot.end
        })) || []
      };
      
      if (calData.errors?.length > 0) {
        calendars[calId].errors = calData.errors;
      }
    }
  }
  
  return {
    timeMin,
    timeMax,
    calendars
  };
}

/**
 * Converts calendar list to structured format
 */
export function convertCalendarsToStructured(
  calendars: calendar_v3.Schema$CalendarListEntry[]
): Array<{
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  timeZone?: string;
  summaryOverride?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  hidden?: boolean;
  selected?: boolean;
  accessRole?: string;
  defaultReminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  notificationSettings?: {
    notifications?: Array<{ type?: string; method?: string }>;
  };
  primary?: boolean;
  deleted?: boolean;
  conferenceProperties?: {
    allowedConferenceSolutionTypes?: string[];
  };
}> {
  return calendars.map(cal => ({
    id: cal.id || '',
    summary: cal.summary,
    description: cal.description,
    location: cal.location,
    timeZone: cal.timeZone,
    summaryOverride: cal.summaryOverride,
    colorId: cal.colorId,
    backgroundColor: cal.backgroundColor,
    foregroundColor: cal.foregroundColor,
    hidden: cal.hidden,
    selected: cal.selected,
    accessRole: cal.accessRole,
    defaultReminders: cal.defaultReminders?.map(r => ({
      method: (r.method as 'email' | 'popup') || 'popup',
      minutes: r.minutes || 0
    })),
    notificationSettings: cal.notificationSettings ? {
      notifications: cal.notificationSettings.notifications?.map(n => ({
        type: n.type,
        method: n.method
      }))
    } : undefined,
    primary: cal.primary,
    deleted: cal.deleted,
    conferenceProperties: cal.conferenceProperties ? {
      allowedConferenceSolutionTypes: cal.conferenceProperties.allowedConferenceSolutionTypes
    } : undefined
  }));
}

/**
 * Creates a warning message for conflicts/duplicates
 */
export function createWarningsArray(conflicts?: ConflictCheckResult): string[] | undefined {
  if (!conflicts || !conflicts.hasConflicts) {
    return undefined;
  }
  
  const warnings: string[] = [];
  
  if (conflicts.duplicates.length > 0) {
    warnings.push(`Found ${conflicts.duplicates.length} potential duplicate(s)`);
  }
  
  if (conflicts.conflicts.length > 0) {
    warnings.push(`Found ${conflicts.conflicts.length} scheduling conflict(s)`);
  }
  
  return warnings.length > 0 ? warnings : undefined;
}