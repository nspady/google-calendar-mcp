import { z } from 'zod';

// Zod schemas for input validation

export const ReminderSchema = z.object({
  method: z.enum(['email', 'popup']).default('popup'),
  minutes: z.number(),
});

export const RemindersSchema = z.object({
  useDefault: z.boolean(),
  overrides: z.array(ReminderSchema).optional(),
});

// Centralized RFC3339 datetime schema that matches Google Calendar API requirements exactly
// Google Calendar API documentation states: "Must be an RFC3339 timestamp with mandatory time zone offset"
// Examples: 2011-06-03T10:00:00-07:00, 2011-06-03T10:00:00Z
// Enhanced for better OpenAI compatibility with explicit format constraints
export const RFC3339DateTimeSchema = z.string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/, "Must be RFC3339 format with timezone: YYYY-MM-DDTHH:mm:ss(Z|±HH:mm)")
  .describe("CRITICAL: RFC3339 datetime with MANDATORY timezone. Format: 'YYYY-MM-DDTHH:mm:ss' followed by 'Z' (UTC) or '±HH:mm' (offset). Examples: '2024-01-01T10:00:00Z' or '2024-01-01T10:00:00-08:00'. NEVER use '2024-01-01T10:00:00' without timezone.");

// Unified time boundary schemas for consistent usage across tools
export const TimeMinSchema = RFC3339DateTimeSchema.describe("Start time boundary - CRITICAL: Must include timezone. Valid formats: '2024-01-01T00:00:00Z' (UTC) or '2024-01-01T00:00:00-08:00' (Pacific). NEVER omit timezone.");
export const TimeMaxSchema = RFC3339DateTimeSchema.describe("End time boundary - CRITICAL: Must include timezone. Valid formats: '2024-01-01T23:59:59Z' (UTC) or '2024-01-01T23:59:59-08:00' (Pacific). NEVER omit timezone.");

export const ListEventsArgumentsSchema = z.object({
  calendarId: z.string().describe("Calendar ID(s) to fetch events from. Accepts either a single calendar ID string or an array of calendar IDs (passed as JSON string like '[\"cal1\", \"cal2\"]')"),
  timeMin: RFC3339DateTimeSchema
    .optional()
    .describe("Start time for event filtering"),
  timeMax: RFC3339DateTimeSchema
    .optional()
    .describe("End time for event filtering"),
}).refine(
  (data) => {
    if (data.timeMin && data.timeMax) {
      return new Date(data.timeMin) < new Date(data.timeMax);
    }
    return true;
  },
  {
    message: "timeMin must be before timeMax",
    path: ["timeMax"]
  }
);

export const GetCurrentTimeArgumentsSchema = z.object({
  timeZone: z.string().optional().describe("Optional IANA timezone (e.g., 'America/Los_Angeles'). Defaults to system timezone if not provided."),
});

export const SearchEventsArgumentsSchema = z.object({
  calendarId: z.string(),
  query: z.string(),
  timeMin: TimeMinSchema,
  timeMax: TimeMaxSchema,
});

export const CreateEventArgumentsSchema = z.object({
  calendarId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  start: RFC3339DateTimeSchema,
  end: RFC3339DateTimeSchema,
  timeZone: z.string(),
  attendees: z
    .array(
      z.object({
        email: z.string(),
      })
    )
    .optional(),
  location: z.string().optional(),
  colorId: z.string().optional(),
  reminders: RemindersSchema.optional(),
  recurrence: z.array(z.string()).optional(),
});

export const UpdateEventArgumentsSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  start: RFC3339DateTimeSchema.optional(),
  end: RFC3339DateTimeSchema.optional(),
  timeZone: z.string(), // Required even if start/end don't change, per API docs for patch
  attendees: z
    .array(
      z.object({
        email: z.string(),
      })
    )
    .optional(),
  location: z.string().optional(),
  colorId: z.string().optional(),
  reminders: RemindersSchema.optional(),
  recurrence: z.array(z.string()).optional(),
  // New recurring event parameters
  modificationScope: z.enum(['thisAndFollowing', 'all', 'thisEventOnly']).optional(),
  originalStartTime: RFC3339DateTimeSchema.optional(),
  futureStartDate: RFC3339DateTimeSchema.optional(),
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
);

export const DeleteEventArgumentsSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").optional().describe("Whether to send cancellation notifications"),
});

export const FreeBusyEventArgumentsSchema = z.object({
  timeMin: RFC3339DateTimeSchema,
  timeMax: RFC3339DateTimeSchema,
  timeZone: z.string().optional(),
  groupExpansionMax: z.number().int().max(100).optional(),
  calendarExpansionMax: z.number().int().max(50).optional(),
  calendars: z.array(z.object({
    id: z.string().min(1, "Calendar ID cannot be empty"),
  })).describe("List of calendars and/or groups to query for free/busy information"),
});