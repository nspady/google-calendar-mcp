import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseToolHandler } from "../handlers/core/BaseToolHandler.js";
import { ALLOWED_EVENT_FIELDS } from "../utils/field-mask-builder.js";
import { ServerConfig } from "../config/TransportConfig.js";

// Import all handlers
import { ListCalendarsHandler } from "../handlers/core/ListCalendarsHandler.js";
import { ListEventsHandler } from "../handlers/core/ListEventsHandler.js";
import { SearchEventsHandler } from "../handlers/core/SearchEventsHandler.js";
import { GetEventHandler } from "../handlers/core/GetEventHandler.js";
import { ListColorsHandler } from "../handlers/core/ListColorsHandler.js";
import { CreateEventHandler } from "../handlers/core/CreateEventHandler.js";
import { UpdateEventHandler } from "../handlers/core/UpdateEventHandler.js";
import { DeleteEventHandler } from "../handlers/core/DeleteEventHandler.js";
import { FreeBusyEventHandler } from "../handlers/core/FreeBusyEventHandler.js";
import { GetCurrentTimeHandler } from "../handlers/core/GetCurrentTimeHandler.js";
import { RespondToEventHandler } from "../handlers/core/RespondToEventHandler.js";

// ============================================================================
// SHARED VALIDATION PATTERNS
// ============================================================================
// Note: We use validation functions instead of shared schemas to avoid $ref
// generation in JSON schema output, which can cause issues with some MCP clients.

// ISO 8601 datetime regex patterns
const ISO_DATETIME_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATETIME_WITHOUT_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Validation functions
const isValidIsoDateTime = (val: string): boolean =>
  ISO_DATETIME_WITH_TZ.test(val) || ISO_DATETIME_WITHOUT_TZ.test(val);

const isValidIsoDateOrDateTime = (val: string): boolean =>
  ISO_DATE_ONLY.test(val) || isValidIsoDateTime(val);

// ============================================================================
// SHARED ENUMS
// ============================================================================

const SEND_UPDATES_VALUES = ["all", "externalOnly", "none"] as const;
const VISIBILITY_VALUES = ["default", "public", "private", "confidential"] as const;
const TRANSPARENCY_VALUES = ["opaque", "transparent"] as const;
const AUTO_DECLINE_MODE_VALUES = [
  "declineNone",
  "declineAllConflictingInvitations",
  "declineOnlyNewConflictingInvitations"
] as const;
const RESPONSE_STATUS_VALUES = ["needsAction", "declined", "tentative", "accepted"] as const;
const CONFERENCE_TYPE_VALUES = ["hangoutsMeet", "eventHangout", "eventNamedHangout", "addOn"] as const;

// ============================================================================
// SHARED NESTED SCHEMAS
// ============================================================================

const remindersSchema = z.object({
  useDefault: z.boolean().describe("Whether to use the default reminders"),
  overrides: z.array(z.object({
    method: z.enum(["email", "popup"]).default("popup").describe("Reminder method"),
    minutes: z.number().describe("Minutes before the event to trigger the reminder")
  }).partial({ method: true })).optional().describe("Custom reminders")
}).describe("Reminder settings for the event").optional();

const conferenceDataSchema = z.object({
  createRequest: z.object({
    requestId: z.string().describe("Client-generated unique ID for this request to ensure idempotency"),
    conferenceSolutionKey: z.object({
      type: z.enum(CONFERENCE_TYPE_VALUES).describe("Conference solution type")
    }).describe("Conference solution to create")
  }).describe("Request to generate a new conference")
}).optional();

const extendedPropertiesSchema = z.object({
  private: z.record(z.string()).optional().describe(
    "Properties private to the application. Keys can have max 44 chars, values max 1024 chars."
  ),
  shared: z.record(z.string()).optional().describe(
    "Properties visible to all attendees. Keys can have max 44 chars, values max 1024 chars."
  )
}).optional().describe(
  "Extended properties for storing application-specific data. Max 300 properties totaling 32KB."
);

// ============================================================================
// FIELD-LEVEL SCHEMAS
// ============================================================================

const timeMinSchema = z.string()
  .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
  .describe("Start of time range (ISO 8601, e.g., '2024-01-01T00:00:00').")
  .optional();

const timeMaxSchema = z.string()
  .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
  .describe("End of time range (ISO 8601, e.g., '2024-01-31T23:59:59').")
  .optional();

const timeZoneSchema = z.string().optional().describe(
  "IANA timezone (e.g., 'America/Los_Angeles'). Defaults to calendar's timezone."
);

/**
 * Helper to parse JSON string arrays (handles Python/shell-style single quotes)
 * Used by multiple schemas to accept both native arrays and JSON string arrays
 */
const parseJsonStringArray = (val: unknown): unknown => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return val;

  try {
    // Handle single-quoted JSON-like strings (Python/shell style)
    let jsonString = trimmed;
    if (jsonString.includes("'")) {
      jsonString = jsonString
        .replace(/\[\s*'/g, '["')
        .replace(/'\s*,\s*'/g, '", "')
        .replace(/'\s*\]/g, '"]');
    }
    const parsed = JSON.parse(jsonString);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    // Fall through to return original value
  }
  return val;
};

const fieldsSchema = z.preprocess(
  parseJsonStringArray,
  z.array(z.enum(ALLOWED_EVENT_FIELDS))
).optional().describe(
  "Additional fields to include beyond defaults (id, summary, start, end, status, htmlLink, location, attendees)."
);

const calendarsToCheckSchema = z.preprocess(
  parseJsonStringArray,
  z.array(z.string())
).optional().describe(
  "List of calendar IDs to check for conflicts (defaults to just the target calendar)"
);

const recurrenceSchema = z.preprocess(
  parseJsonStringArray,
  z.array(z.string())
).optional().describe(
  "Recurrence rules in RFC5545 format (e.g., [\"RRULE:FREQ=WEEKLY;COUNT=5\"])"
);

const privateExtendedPropertySchema = z
  .array(z.string().regex(/^[^=]+=[^=]+$/, "Must be in key=value format"))
  .optional()
  .describe(
    "Filter by private extended properties (key=value). Matches events that have all specified properties."
  );

const sharedExtendedPropertySchema = z
  .array(z.string().regex(/^[^=]+=[^=]+$/, "Must be in key=value format"))
  .optional()
  .describe(
    "Filter by shared extended properties (key=value). Matches events that have all specified properties."
  );

// Single account schema - for write operations (create, update, delete)
const singleAccountSchema = z.string()
  .regex(/^[a-z0-9_-]{1,64}$/, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only")
  .optional()
  .describe(
    "Account nickname (e.g., 'work'). Optional if only one account connected."
  );

// Account ID validation regex
const accountIdRegex = /^[a-z0-9_-]{1,64}$/;

// Multi-account schema - for read operations (list, search, get)
const multiAccountSchema = z.preprocess(
  parseJsonStringArray,
  z.union([
    z.string()
      .regex(accountIdRegex, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only"),
    z.array(z.string()
      .regex(accountIdRegex, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only"))
      .min(1, "At least one account nickname is required")
      .max(10, "Maximum 10 accounts allowed per request")
  ])
)
  .optional()
  .describe(
    "Account nickname(s) to query (e.g., 'work' or ['work', 'personal']). Omit to query all accounts."
  );

// Define all tool schemas with TypeScript inference
export const ToolSchemas = {
  'list-calendars': z.object({
    account: multiAccountSchema
  }),

  'list-events': z.object({
    account: multiAccountSchema,
    calendarId: z.union([
      z.string().describe(
        "Calendar identifier(s) to query. Accepts calendar IDs (e.g., 'primary', 'user@gmail.com') OR calendar names (e.g., 'Work', 'Personal'). Single calendar: 'primary'. Multiple calendars: array ['Work', 'Personal'] or JSON string '[\"Work\", \"Personal\"]'"
      ),
      z.array(z.string().min(1))
        .min(1, "At least one calendar ID is required")
        .max(50, "Maximum 50 calendars allowed per request")
        .refine(
          (arr) => new Set(arr).size === arr.length,
          "Duplicate calendar IDs are not allowed"
        )
        .describe("Array of calendar IDs to query events from (max 50, no duplicates)")
    ]),
    timeMin: timeMinSchema,
    timeMax: timeMaxSchema,
    timeZone: timeZoneSchema,
    fields: fieldsSchema,
    privateExtendedProperty: privateExtendedPropertySchema,
    sharedExtendedProperty: sharedExtendedPropertySchema
  }),
  
  'search-events': z.object({
    account: multiAccountSchema,
    calendarId: z.union([
      z.string().describe(
        "Calendar identifier(s) to search. Accepts calendar IDs (e.g., 'primary', 'user@gmail.com') OR calendar names (e.g., 'Work', 'Personal'). Single calendar: 'primary'. Multiple calendars: array ['Work', 'Personal'] or JSON string '[\"Work\", \"Personal\"]'"
      ),
      z.array(z.string())
    ]).transform((val) => {
      if (typeof val === 'string') {
        // Try to parse JSON array if it looks like one
        if (val.startsWith('[')) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed;
          } catch { /* ignore */ }
        }
        return val;
      }
      return val;
    }).describe("Calendar identifier(s) to search. Accepts calendar IDs or names. Single or multiple calendars supported."),
    query: z.string().describe(
      "Free text search query (searches summary, description, location, attendees, etc.)"
    ),
    timeMin: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("Start of time range (ISO 8601, e.g., '2024-01-01T00:00:00')."),
    timeMax: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("End of time range (ISO 8601, e.g., '2024-01-31T23:59:59')."),
    timeZone: timeZoneSchema,
    fields: z.array(z.enum(ALLOWED_EVENT_FIELDS)).optional().describe(
      "Additional fields to include beyond defaults (id, summary, start, end, status, htmlLink, location, attendees)."
    ),
    privateExtendedProperty: z
      .array(z.string().regex(/^[^=]+=[^=]+$/, "Must be in key=value format"))
      .optional()
      .describe(
        "Filter by private extended properties (key=value). Matches events that have all specified properties."
      ),
    sharedExtendedProperty: z
      .array(z.string().regex(/^[^=]+=[^=]+$/, "Must be in key=value format"))
      .optional()
      .describe(
        "Filter by shared extended properties (key=value). Matches events that have all specified properties."
      )
  }),
  
  'get-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().describe("ID of the event to retrieve"),
    fields: z.array(z.enum(ALLOWED_EVENT_FIELDS)).optional().describe(
      "Optional array of additional event fields to retrieve. Available fields are strictly validated. Default fields (id, summary, start, end, status, htmlLink, location, attendees) are always included."
    )
  }),

  'list-colors': z.object({
    account: singleAccountSchema,
  }),

  'create-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().optional().describe("Optional custom event ID (5-1024 characters, base32hex encoding: lowercase letters a-v and digits 0-9 only). If not provided, Google Calendar will generate one."),
    summary: z.string().describe("Title of the event"),
    description: z.string().optional().describe("Description/notes for the event"),
    start: z.string()
      .refine(isValidIsoDateOrDateTime, "Must be ISO 8601 format: '2025-01-01T10:00:00' for timed events or '2025-01-01' for all-day events")
      .describe("Event start time: '2025-01-01T10:00:00' for timed events or '2025-01-01' for all-day events. Also accepts Google Calendar API object format: {date: '2025-01-01'} or {dateTime: '2025-01-01T10:00:00', timeZone: 'America/Los_Angeles'}"),
    end: z.string()
      .refine(isValidIsoDateOrDateTime, "Must be ISO 8601 format: '2025-01-01T11:00:00' for timed events or '2025-01-02' for all-day events")
      .describe("Event end time: '2025-01-01T11:00:00' for timed events or '2025-01-02' for all-day events (exclusive). Also accepts Google Calendar API object format: {date: '2025-01-02'} or {dateTime: '2025-01-01T11:00:00', timeZone: 'America/Los_Angeles'}"),
    timeZone: z.string().optional().describe(
      "Timezone as IANA Time Zone Database name (e.g., America/Los_Angeles). Takes priority over calendar's default timezone. Only used for timezone-naive datetime strings."
    ),
    location: z.string().optional().describe("Location of the event"),
    attendees: z.array(z.object({
      email: z.string().email().describe("Email address of the attendee"),
      displayName: z.string().optional().describe("Display name of the attendee"),
      optional: z.boolean().optional().describe("Whether this is an optional attendee"),
      responseStatus: z.enum(RESPONSE_STATUS_VALUES).optional().describe("Attendee's response status"),
      comment: z.string().optional().describe("Attendee's response comment"),
      additionalGuests: z.number().int().min(0).optional().describe("Number of additional guests the attendee is bringing")
    })).optional().describe("List of event attendees with their details"),
    colorId: z.string().optional().describe(
      "Color ID for the event (use list-colors to see available IDs)"
    ),
    reminders: remindersSchema,
    recurrence: recurrenceSchema,
    transparency: z.enum(TRANSPARENCY_VALUES).optional().describe(
      "Whether the event blocks time on the calendar. 'opaque' means busy, 'transparent' means free."
    ),
    visibility: z.enum(VISIBILITY_VALUES).optional().describe(
      "Visibility of the event. Use 'public' for public events, 'private' for private events visible to attendees."
    ),
    guestsCanInviteOthers: z.boolean().optional().describe(
      "Whether attendees can invite others to the event. Default is true."
    ),
    guestsCanModify: z.boolean().optional().describe(
      "Whether attendees can modify the event. Default is false."
    ),
    guestsCanSeeOtherGuests: z.boolean().optional().describe(
      "Whether attendees can see the list of other attendees. Default is true."
    ),
    anyoneCanAddSelf: z.boolean().optional().describe(
      "Whether anyone can add themselves to the event. Default is false."
    ),
    sendUpdates: z.enum(SEND_UPDATES_VALUES).optional().describe(
      "Whether to send notifications about the event creation. 'all' sends to all guests, 'externalOnly' to non-Google Calendar users only, 'none' sends no notifications."
    ),
    conferenceData: conferenceDataSchema.describe(
      "Conference properties for the event. Use createRequest to add a new conference."
    ),
    extendedProperties: extendedPropertiesSchema,
    attachments: z.array(z.object({
      fileUrl: z.string().describe("URL of the attached file"),
      title: z.string().optional().describe("Title of the attachment"),
      mimeType: z.string().optional().describe("MIME type of the attachment"),
      iconLink: z.string().optional().describe("URL of the icon for the attachment"),
      fileId: z.string().optional().describe("ID of the attached file in Google Drive")
    })).optional().describe(
      "File attachments for the event. Requires calendar to support attachments."
    ),
    source: z.object({
      url: z.string().describe("URL of the source"),
      title: z.string().describe("Title of the source")
    }).optional().describe(
      "Source of the event, such as a web page or email message."
    ),
    calendarsToCheck: calendarsToCheckSchema,
    duplicateSimilarityThreshold: z.number().min(0).max(1).optional().describe(
      "Threshold for duplicate detection (0-1, default: 0.7). Events with similarity above this are flagged as potential duplicates"
    ),
    allowDuplicates: z.boolean().optional().describe(
      "If true, allows creation even when exact duplicates are detected (similarity >= 0.95). Default is false which blocks duplicate creation"
    ),
    eventType: z.enum(["default", "focusTime", "outOfOffice", "workingLocation"]).optional().describe(
      "Type of the event. 'default' for regular events, 'focusTime' for Focus Time blocks, 'outOfOffice' for Out of Office events, 'workingLocation' for Working Location events. Note: outOfOffice and workingLocation require Google Workspace and only work on primary calendar."
    ),
    focusTimeProperties: z.object({
      autoDeclineMode: z.enum(AUTO_DECLINE_MODE_VALUES).optional().describe("Whether to auto-decline conflicting meetings"),
      chatStatus: z.enum(["available", "doNotDisturb"]).optional()
        .describe("Chat status during focus time"),
      declineMessage: z.string().optional()
        .describe("Message sent when declining invitations")
    }).optional().describe(
      "Focus Time properties. Only used when eventType is 'focusTime'. Requires Google Workspace."
    ),
    outOfOfficeProperties: z.object({
      autoDeclineMode: z.enum(AUTO_DECLINE_MODE_VALUES).optional().default("declineAllConflictingInvitations")
        .describe("How to handle conflicting meetings. Default is to decline all conflicts."),
      declineMessage: z.string().optional()
        .describe("Message sent when declining invitations (e.g., 'I'm out of office, will respond when I return')")
    }).optional().describe(
      "Out of Office properties. Only used when eventType is 'outOfOffice'. Requires Google Workspace."
    ),
    workingLocationProperties: z.object({
      type: z.enum(["homeOffice", "officeLocation", "customLocation"])
        .describe("Type of working location"),
      homeOffice: z.object({}).optional()
        .describe("Empty object for home office type"),
      officeLocation: z.object({
        label: z.string().optional().describe("Office name shown in Calendar (e.g., 'HQ Building', 'NYC Office')"),
        buildingId: z.string().optional().describe("Building identifier from organization's Resources"),
        floorId: z.string().optional().describe("Floor identifier"),
        floorSectionId: z.string().optional().describe("Floor section identifier"),
        deskId: z.string().optional().describe("Desk identifier")
      }).optional().describe("Office location details"),
      customLocation: z.object({
        label: z.string().optional().describe("Label for custom location (e.g., 'Coffee Shop', 'Client Site')")
      }).optional().describe("Custom location details")
    }).optional().describe(
      "Working Location properties. Only used when eventType is 'workingLocation'. Requires Google Workspace."
    )
  }).refine(
    (data) => {
      // Validate that focusTime and outOfOffice events use dateTime (not all-day date format)
      if (data.eventType === 'focusTime' || data.eventType === 'outOfOffice') {
        if (ISO_DATE_ONLY.test(data.start) || ISO_DATE_ONLY.test(data.end)) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Focus Time and Out of Office events cannot be all-day events. Use dateTime format (e.g., '2025-01-01T10:00:00') instead of date format.",
      path: ["eventType"]
    }
  ),

  'update-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().describe("ID of the event to update"),
    summary: z.string().optional().describe("Updated title of the event"),
    description: z.string().optional().describe("Updated description/notes"),
    start: z.string()
      .refine(isValidIsoDateOrDateTime, "Must be ISO 8601 format: '2025-01-01T10:00:00' for timed events or '2025-01-01' for all-day events")
      .describe("Updated start time: '2025-01-01T10:00:00' for timed events or '2025-01-01' for all-day events. Also accepts Google Calendar API object format: {date: '2025-01-01'} or {dateTime: '2025-01-01T10:00:00', timeZone: 'America/Los_Angeles'}")
      .optional(),
    end: z.string()
      .refine(isValidIsoDateOrDateTime, "Must be ISO 8601 format: '2025-01-01T11:00:00' for timed events or '2025-01-02' for all-day events")
      .describe("Updated end time: '2025-01-01T11:00:00' for timed events or '2025-01-02' for all-day events (exclusive). Also accepts Google Calendar API object format: {date: '2025-01-02'} or {dateTime: '2025-01-01T11:00:00', timeZone: 'America/Los_Angeles'}")
      .optional(),
    timeZone: z.string().optional().describe("Updated timezone as IANA Time Zone Database name. If not provided, uses the calendar's default timezone."),
    location: z.string().optional().describe("Updated location"),
    attendees: z.array(z.object({
      email: z.string().email().describe("Email address of the attendee")
    })).optional().describe("Updated attendee list"),
    colorId: z.string().optional().describe("Updated color ID"),
    reminders: remindersSchema,
    recurrence: recurrenceSchema,
    sendUpdates: z.enum(SEND_UPDATES_VALUES).default("all").describe(
      "Whether to send update notifications"
    ),
    modificationScope: z.enum(["thisAndFollowing", "all", "thisEventOnly"]).optional().describe(
      "Scope for recurring event modifications"
    ),
    originalStartTime: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("Original start time in the ISO 8601 format '2024-01-01T10:00:00'")
      .optional(),
    futureStartDate: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("Start date for future instances in the ISO 8601 format '2024-01-01T10:00:00'")
      .optional(),
    checkConflicts: z.boolean().optional().describe(
      "Whether to check for conflicts when updating (default: true when changing time)"
    ),
    calendarsToCheck: calendarsToCheckSchema,
    conferenceData: conferenceDataSchema.describe("Conference properties for the event. Used to add or update Google Meet links."),
    transparency: z.enum(TRANSPARENCY_VALUES).optional().describe(
      "Whether the event blocks time on the calendar. 'opaque' means busy, 'transparent' means available"
    ),
    visibility: z.enum(VISIBILITY_VALUES).optional().describe(
      "Visibility of the event"
    ),
    guestsCanInviteOthers: z.boolean().optional().describe(
      "Whether attendees other than the organizer can invite others"
    ),
    guestsCanModify: z.boolean().optional().describe(
      "Whether attendees other than the organizer can modify the event"
    ),
    guestsCanSeeOtherGuests: z.boolean().optional().describe(
      "Whether attendees other than the organizer can see who the event's attendees are"
    ),
    anyoneCanAddSelf: z.boolean().optional().describe(
      "Whether anyone can add themselves to the event"
    ),
    extendedProperties: extendedPropertiesSchema,
    attachments: z.array(z.object({
      fileUrl: z.string().url().describe("URL link to the attachment"),
      title: z.string().describe("Title of the attachment"),
      mimeType: z.string().optional().describe("MIME type of the attachment"),
      iconLink: z.string().optional().describe("URL link to the attachment's icon"),
      fileId: z.string().optional().describe("ID of the attached Google Drive file")
    })).optional().describe("File attachments for the event")
    // Note: eventType is intentionally not included - Google Calendar API does not allow changing event type after creation
  }).refine(
    (data) => {
      // Require originalStartTime when modificationScope is 'thisEventOnly'
      if (data.modificationScope === 'thisEventOnly' && !data.originalStartTime) {
        return false;
      }
      return true;
    },
    {
      message: "originalStartTime is required when modificationScope is 'thisEventOnly'",
      path: ["originalStartTime"]
    }
  ).refine(
    (data) => {
      // Require futureStartDate when modificationScope is 'thisAndFollowing'
      if (data.modificationScope === 'thisAndFollowing' && !data.futureStartDate) {
        return false;
      }
      return true;
    },
    {
      message: "futureStartDate is required when modificationScope is 'thisAndFollowing'",
      path: ["futureStartDate"]
    }
  ).refine(
    (data) => {
      // Ensure futureStartDate is in the future when provided
      if (data.futureStartDate) {
        const futureDate = new Date(data.futureStartDate);
        const now = new Date();
        return futureDate > now;
      }
      return true;
    },
    {
      message: "futureStartDate must be in the future",
      path: ["futureStartDate"]
    }
  ),
  
  'delete-event': z.object({
    account: singleAccountSchema,
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().describe("ID of the event to delete"),
    sendUpdates: z.enum(SEND_UPDATES_VALUES).default("all").describe(
      "Whether to send cancellation notifications"
    )
  }),

  'get-freebusy': z.object({
    account: multiAccountSchema.describe(
      "Account nickname(s) to query (e.g., 'work' or ['work', 'personal']). Omit to query all accounts."
    ),
    calendars: z.array(z.object({
      id: z.string().describe("ID of the calendar (use 'primary' for the main calendar)")
    })).describe(
      "List of calendars and/or groups to query for free/busy information"
    ),
    timeMin: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("Start of time range (ISO 8601, e.g., '2024-01-01T00:00:00')."),
    timeMax: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2026-01-01T00:00:00'")
      .describe("End of time range (ISO 8601, e.g., '2024-01-31T23:59:59')."),
    timeZone: z.string().optional().describe("IANA timezone for the query."),
    groupExpansionMax: z.number().int().max(100).optional().describe(
      "Maximum number of calendars to expand per group (max 100)"
    ),
    calendarExpansionMax: z.number().int().max(50).optional().describe(
      "Maximum number of calendars to expand (max 50)"
    )
  }),
  
  'get-current-time': z.object({
    account: singleAccountSchema,
    timeZone: z.string().optional().describe(
      "IANA timezone (e.g., 'America/Los_Angeles'). Defaults to calendar's timezone."
    )
  }),

  'respond-to-event': z.object({
    calendarId: z.string().describe("ID of the calendar (use 'primary' for the main calendar)"),
    eventId: z.string().describe("ID of the event to respond to"),
    account: z.string().optional().describe(
      "Account nickname to use for this operation (e.g., 'work', 'personal'). Optional when only one account is connected - will auto-select the account with appropriate permissions. Use 'list-calendars' to see available accounts."
    ),
    response: z.enum(RESPONSE_STATUS_VALUES).describe(
      "Your response to the event invitation: 'accepted' (accept), 'declined' (decline), 'tentative' (maybe), 'needsAction' (no response)"
    ),
    comment: z.string().optional().describe(
      "Optional message/note to include with your response (e.g., 'I have a conflict' when declining)"
    ),
    modificationScope: z.enum(["thisEventOnly", "all"]).optional().describe(
      "For recurring events: 'thisEventOnly' responds to just this instance, 'all' responds to all instances. Default is 'all'."
    ),
    originalStartTime: z.string()
      .refine(isValidIsoDateTime, "Must be ISO 8601 format: '2025-01-01T10:00:00'")
      .describe("Original start time of the specific instance (required when modificationScope is 'thisEventOnly')")
      .optional(),
    sendUpdates: z.enum(SEND_UPDATES_VALUES).optional().describe(
      "Whether to send response notifications. 'all' sends to all guests, 'externalOnly' to non-Google Calendar users only, 'none' sends no notifications. Default is 'none'."
    )
  }).refine(
    (data) => {
      // Require originalStartTime when modificationScope is 'thisEventOnly'
      if (data.modificationScope === 'thisEventOnly' && !data.originalStartTime) {
        return false;
      }
      return true;
    },
    {
      message: "originalStartTime is required when modificationScope is 'thisEventOnly'",
      path: ["originalStartTime"]
    }
  )
} as const;

// Generate TypeScript types from schemas
export type ToolInputs = {
  [K in keyof typeof ToolSchemas]: z.infer<typeof ToolSchemas[K]>
};

// Export individual types for convenience
export type ListCalendarsInput = ToolInputs['list-calendars'];
export type ListEventsInput = ToolInputs['list-events'];
export type SearchEventsInput = ToolInputs['search-events'];
export type GetEventInput = ToolInputs['get-event'];
export type ListColorsInput = ToolInputs['list-colors'];
export type CreateEventInput = ToolInputs['create-event'];
export type UpdateEventInput = ToolInputs['update-event'];
export type DeleteEventInput = ToolInputs['delete-event'];
export type GetFreeBusyInput = ToolInputs['get-freebusy'];
export type GetCurrentTimeInput = ToolInputs['get-current-time'];
export type RespondToEventInput = ToolInputs['respond-to-event'];

interface ToolDefinition {
  name: keyof typeof ToolSchemas;
  description: string;
  schema: z.ZodType<any>;
  handler: new () => BaseToolHandler;
  handlerFunction?: (args: any) => Promise<any>;
  customInputSchema?: any; // Custom schema shape for MCP registration (overrides extractSchemaShape)
}


export class ToolRegistry {
  private static extractSchemaShape(schema: z.ZodType<any>): any {
    const schemaAny = schema as any;
    
    // Handle ZodEffects (schemas with .refine())
    if (schemaAny._def && schemaAny._def.typeName === 'ZodEffects') {
      return this.extractSchemaShape(schemaAny._def.schema);
    }
    
    // Handle regular ZodObject
    if ('shape' in schemaAny) {
      return schemaAny.shape;
    }
    
    // Handle other nested structures
    if (schemaAny._def && schemaAny._def.schema) {
      return this.extractSchemaShape(schemaAny._def.schema);
    }
    
    // Fallback to the original approach
    return schemaAny._def?.schema?.shape || schemaAny.shape;
  }

  private static tools: ToolDefinition[] = [
    {
      name: "list-calendars",
      description: "List all available calendars",
      schema: ToolSchemas['list-calendars'],
      handler: ListCalendarsHandler
    },
    {
      name: "list-events",
      description: "List events from one or more calendars. Supports both calendar IDs and calendar names.",
      schema: ToolSchemas['list-events'],
      handler: ListEventsHandler,
      handlerFunction: async (args: ListEventsInput & { calendarId: string | string[] }) => {
        let processedCalendarId: string | string[] = args.calendarId;

        // If it's already an array (native array format), keep as-is (already validated by schema)
        if (Array.isArray(args.calendarId)) {
          processedCalendarId = args.calendarId;
        }
        // Handle JSON string format (double or single-quoted)
        else if (typeof args.calendarId === 'string' && args.calendarId.trim().startsWith('[') && args.calendarId.trim().endsWith(']')) {
          try {
            let jsonString = args.calendarId.trim();

            // Normalize single-quoted JSON-like strings to valid JSON (Python/shell style)
            // Only replace single quotes that are string delimiters (after '[', ',', or before ']', ',')
            // This avoids breaking calendar IDs with apostrophes like "John's Calendar"
            if (jsonString.includes("'")) {
              jsonString = jsonString
                .replace(/\[\s*'/g, '["')           // [' -> ["
                .replace(/'\s*,\s*'/g, '", "')      // ', ' -> ", "
                .replace(/'\s*\]/g, '"]');          // '] -> "]
            }

            const parsed = JSON.parse(jsonString);

            // Validate parsed result
            if (!Array.isArray(parsed)) {
              throw new Error('JSON string must contain an array');
            }
            if (!parsed.every(id => typeof id === 'string' && id.length > 0)) {
              throw new Error('Array must contain only non-empty strings');
            }
            if (parsed.length === 0) {
              throw new Error("At least one calendar ID is required");
            }
            if (parsed.length > 50) {
              throw new Error("Maximum 50 calendars allowed");
            }
            if (new Set(parsed).size !== parsed.length) {
              throw new Error("Duplicate calendar IDs are not allowed");
            }

            processedCalendarId = parsed;
          } catch (error) {
            throw new Error(
              `Invalid JSON format for calendarId: ${error instanceof Error ? error.message : 'Unknown parsing error'}`
            );
          }
        }
        // Otherwise it's a single string calendar ID - keep as-is

        return {
          account: args.account,
          calendarId: processedCalendarId,
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          timeZone: args.timeZone,
          fields: args.fields,
          privateExtendedProperty: args.privateExtendedProperty,
          sharedExtendedProperty: args.sharedExtendedProperty
        };
      }
    },
    {
      name: "search-events",
      description: "Search for events in a calendar by text query.",
      schema: ToolSchemas['search-events'],
      handler: SearchEventsHandler
    },
    {
      name: "get-event",
      description: "Get details of a specific event by ID.",
      schema: ToolSchemas['get-event'],
      handler: GetEventHandler
    },
    {
      name: "list-colors",
      description: "List available color IDs and their meanings for calendar events",
      schema: ToolSchemas['list-colors'],
      handler: ListColorsHandler
    },
    {
      name: "create-event",
      description: "Create a new calendar event.",
      schema: ToolSchemas['create-event'],
      handler: CreateEventHandler
    },
    {
      name: "update-event",
      description: "Update an existing calendar event with recurring event modification scope support.",
      schema: ToolSchemas['update-event'],
      handler: UpdateEventHandler
    },
    {
      name: "delete-event",
      description: "Delete a calendar event.",
      schema: ToolSchemas['delete-event'],
      handler: DeleteEventHandler
    },
    {
      name: "get-freebusy",
      description: "Query free/busy information for calendars. Note: Time range is limited to a maximum of 3 months between timeMin and timeMax.",
      schema: ToolSchemas['get-freebusy'],
      handler: FreeBusyEventHandler
    },
    {
      name: "get-current-time",
      description: "Get the current date and time. Call this FIRST before creating, updating, or searching for events to ensure you have accurate date context for scheduling.",
      schema: ToolSchemas['get-current-time'],
      handler: GetCurrentTimeHandler
    },
    {
      name: "respond-to-event",
      description: "Respond to a calendar event invitation with Accept, Decline, Maybe (Tentative), or No Response.",
      schema: ToolSchemas['respond-to-event'],
      handler: RespondToEventHandler
    }
  ];

  static getToolsWithSchemas() {
    return this.tools.map(tool => {
      const jsonSchema = tool.customInputSchema
        ? zodToJsonSchema(z.object(tool.customInputSchema))
        : zodToJsonSchema(tool.schema);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema
      };
    });
  }

  /**
   * Normalizes datetime fields from object format to string format
   * Converts { date: "2025-01-01" } or { dateTime: "...", timeZone: "..." } to simple strings
   * This allows accepting both Google Calendar API format and our simplified format
   */
  private static normalizeDateTimeFields(toolName: string, args: any): any {
    // Only normalize for tools that have datetime fields
    const toolsWithDateTime = ['create-event', 'update-event'];
    if (!toolsWithDateTime.includes(toolName)) {
      return args;
    }

    const normalized = { ...args };
    const dateTimeFields = ['start', 'end', 'originalStartTime', 'futureStartDate'];

    for (const field of dateTimeFields) {
      if (normalized[field] && typeof normalized[field] === 'object') {
        const obj = normalized[field];
        // Convert object format to string format
        if (obj.date) {
          normalized[field] = obj.date;
        } else if (obj.dateTime) {
          normalized[field] = obj.dateTime;
        }
      }
    }

    return normalized;
  }

  /**
   * Get all available tool names for validation
   */
  static getAvailableToolNames(): string[] {
    return this.tools.map(t => t.name);
  }

  /**
   * Validate that all tool names in a list exist
   * @throws Error if any tool name is invalid
   */
  static validateToolNames(toolNames: string[]): void {
    const availableTools = new Set([...this.getAvailableToolNames(), 'manage-accounts']);
    const invalidTools = toolNames.filter(name => !availableTools.has(name));

    if (invalidTools.length > 0) {
      const available = [...this.getAvailableToolNames(), 'manage-accounts'].join(', ');
      throw new Error(
        `Invalid tool name(s): ${invalidTools.join(', ')}. ` +
        `Available tools: ${available}`
      );
    }
  }

  static async registerAll(
    server: McpServer,
    executeWithHandler: (
      handler: any,
      args: any
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
    config?: ServerConfig
  ) {
    // Validate enabledTools if provided
    if (config?.enabledTools) {
      if (config.enabledTools.length === 0) {
        throw new Error('Enabled tools list is empty. Provide at least one tool name.');
      }
      this.validateToolNames(config.enabledTools);
      const enabledSet = new Set(config.enabledTools);
      process.stderr.write(`Tool filtering enabled: ${config.enabledTools.join(', ')}\n`);

      // Filter and register only enabled tools
      for (const tool of this.tools) {
        if (!enabledSet.has(tool.name)) {
          continue;
        }
        this.registerSingleTool(server, tool, executeWithHandler);
      }
      return;
    }

    // No filtering - register all tools
    for (const tool of this.tools) {
      this.registerSingleTool(server, tool, executeWithHandler);
    }
  }

  private static registerSingleTool(
    server: McpServer,
    tool: ToolDefinition,
    executeWithHandler: (
      handler: any,
      args: any
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>
  ) {
    // Use the existing registerTool method which handles schema conversion properly
    server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.customInputSchema || this.extractSchemaShape(tool.schema)
        },
        async (args: any) => {
          // Preprocess: Normalize datetime fields (convert object format to string format)
          // This allows accepting both formats while keeping schemas simple
          const normalizedArgs = this.normalizeDateTimeFields(tool.name, args);

          // Validate input using our Zod schema
          const validatedArgs = tool.schema.parse(normalizedArgs);

          // Apply any custom handler function preprocessing
          const processedArgs = tool.handlerFunction ? await tool.handlerFunction(validatedArgs) : validatedArgs;

          // Create handler instance and execute
          const handler = new tool.handler();
          return executeWithHandler(handler, processedArgs);
        }
      );
  }
}
