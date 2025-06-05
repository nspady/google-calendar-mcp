import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import tool handlers
import { ListCalendarsHandler } from "../handlers/core/ListCalendarsHandler.js";
import { ListEventsHandler } from "../handlers/core/ListEventsHandler.js";
import { SearchEventsHandler } from "../handlers/core/SearchEventsHandler.js";
import { ListColorsHandler } from "../handlers/core/ListColorsHandler.js";
import { CreateEventHandler } from "../handlers/core/CreateEventHandler.js";
import { UpdateEventHandler } from "../handlers/core/UpdateEventHandler.js";
import { DeleteEventHandler } from "../handlers/core/DeleteEventHandler.js";
import { FreeBusyEventHandler } from "../handlers/core/FreeBusyEventHandler.js";

// Import centralized validation schemas
import { RFC3339DateTimeSchema, TimeMinSchema, TimeMaxSchema } from '../schemas/validators.js';

// --- Zod Schema Definitions ---

// Common schemas
const CalendarIdSchema = z.string().describe("ID of the calendar (use 'primary' for the main calendar)");
const EmailSchema = z.string().email();

// Reminder schema for reusability
const RemindersSchema = z.object({
  useDefault: z.boolean().describe("Whether to use the default reminders"),
  overrides: z.array(z.object({
    method: z.enum(["email", "popup"]).default("popup").describe("Reminder method"),
    minutes: z.number().describe("Minutes before the event to trigger the reminder")
  }).partial({ method: true })).optional().describe("Custom reminders")
}).describe("Reminder settings for the event");

// Attendee schema
const AttendeeSchema = z.object({
  email: EmailSchema.describe("Email address of the attendee")
});

// --- Tool Registration Function ---

export function registerAllTools(
  server: McpServer, 
  executeWithHandler: (handler: any, args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>
) {
  // List Calendars - Read-only tool
  server.tool(
    "list-calendars",
    "List all available calendars", 
    {},
    async () => {
      const handler = new ListCalendarsHandler();
      return executeWithHandler(handler, {});
    }
  );

  // List Events - Read-only tool
  server.tool(
    "list-events",
    "List events from one or more calendars",
    {
      calendarId: z.union([
        CalendarIdSchema,
        z.array(CalendarIdSchema).min(1).max(50)
      ]).transform((value) => {
        // Handle case where calendarId is passed as a JSON string
        if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string' && id.length > 0)) {
              // Validate the parsed array meets our constraints
              if (parsed.length === 0) {
                throw new Error("At least one calendar ID is required");
              }
              if (parsed.length > 50) {
                throw new Error("Maximum 50 calendars allowed per request");
              }
              if (new Set(parsed).size !== parsed.length) {
                throw new Error("Duplicate calendar IDs are not allowed");
              }
              return parsed;
            } else {
              throw new Error('JSON string must contain an array of non-empty strings');
            }
          } catch (error) {
            throw new Error(`Invalid JSON format for calendarId: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
          }
        }
        return value;
      }).describe("ID of the calendar(s) to list events from"),
      timeMin: TimeMinSchema,
      timeMax: TimeMaxSchema
    },
    async ({ calendarId, timeMin, timeMax }: { calendarId: string | string[], timeMin: string, timeMax: string }) => {
      const handler = new ListEventsHandler();
      return executeWithHandler(handler, { calendarId, timeMin, timeMax });
    }
  );

  // Search Events - Read-only tool
  server.tool(
    "search-events",
    "Search for events in a calendar by text query",
    {
      calendarId: CalendarIdSchema,
      query: z.string().describe("Free text search query (searches summary, description, location, attendees, etc.)"),
      timeMin: TimeMinSchema,
      timeMax: TimeMaxSchema
    },
    async ({ calendarId, query, timeMin, timeMax }: { calendarId: string, query: string, timeMin: string, timeMax: string }) => {
      const handler = new SearchEventsHandler();
      return executeWithHandler(handler, { calendarId, query, timeMin, timeMax });
    }
  );

  // List Colors - Read-only tool
  server.tool(
    "list-colors",
    "List available color IDs and their meanings for calendar events",
    {},
    async () => {
      const handler = new ListColorsHandler();
      return executeWithHandler(handler, {});
    }
  );

  // Create Event - Destructive tool
  server.tool(
    "create-event",
    "Create a new calendar event",
    {
      calendarId: CalendarIdSchema,
      summary: z.string().describe("Title of the event"),
      description: z.string().optional().describe("Description/notes for the event"),
      start: RFC3339DateTimeSchema.describe("Event start time - CRITICAL: Must be RFC3339 format with timezone. Examples: '2024-01-01T10:00:00Z' (UTC) or '2024-01-01T10:00:00-08:00' (Pacific). NEVER use '2024-01-01T10:00:00' without timezone."),
      end: RFC3339DateTimeSchema.describe("Event end time - CRITICAL: Must be RFC3339 format with timezone. Examples: '2024-01-01T11:00:00Z' (UTC) or '2024-01-01T11:00:00-08:00' (Pacific). NEVER use '2024-01-01T11:00:00' without timezone."),
      timeZone: z.string().describe("Timezone as IANA Time Zone Database name (e.g., America/Los_Angeles)"),
      location: z.string().optional().describe("Location of the event"),
      attendees: z.array(AttendeeSchema).optional().describe("List of attendee email addresses"),
      colorId: z.string().optional().describe("Color ID for the event (use list-colors to see available IDs)"),
      reminders: RemindersSchema.optional(),
      recurrence: z.array(z.string()).optional().describe("Recurrence rules in RFC5545 format (e.g., [\"RRULE:FREQ=WEEKLY;COUNT=5\"])")
    },
    async (args: {
      calendarId: string;
      summary: string;
      description?: string;
      start: string;
      end: string;
      timeZone: string;
      location?: string;
      attendees?: Array<{ email: string }>;
      colorId?: string;
      reminders?: {
        useDefault: boolean;
        overrides?: Array<{ method?: "email" | "popup"; minutes: number }>;
      };
      recurrence?: string[];
    }) => {
      const handler = new CreateEventHandler();
      return executeWithHandler(handler, args);
    }
  );

  // Update Event - Destructive tool  
  server.tool(
    "update-event",
    "Update an existing calendar event with recurring event modification scope support",
    {
      calendarId: CalendarIdSchema,
      eventId: z.string().describe("ID of the event to update"),
      summary: z.string().optional().describe("Updated title of the event"),
      description: z.string().optional().describe("Updated description/notes"),
      start: RFC3339DateTimeSchema.optional().describe("Updated start time - CRITICAL: Must be RFC3339 format with timezone. Examples: '2024-01-01T10:00:00Z' (UTC) or '2024-01-01T10:00:00-08:00' (Pacific). NEVER use '2024-01-01T10:00:00' without timezone."),
      end: RFC3339DateTimeSchema.optional().describe("Updated end time - CRITICAL: Must be RFC3339 format with timezone. Examples: '2024-01-01T11:00:00Z' (UTC) or '2024-01-01T11:00:00-08:00' (Pacific). NEVER use '2024-01-01T11:00:00' without timezone."),
      timeZone: z.string().describe("Updated timezone"),
      location: z.string().optional().describe("Updated location"),
      attendees: z.array(AttendeeSchema).optional().describe("Updated attendee list"),
      colorId: z.string().optional().describe("Updated color ID"),
      reminders: RemindersSchema.optional(),
      recurrence: z.array(z.string()).optional().describe("Updated recurrence rules"),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").describe("Whether to send update notifications"),
      modificationScope: z.enum(["thisAndFollowing", "all", "thisEventOnly"]).optional().describe("Scope for recurring event modifications"),
      originalStartTime: RFC3339DateTimeSchema.optional().describe("Original start time of recurring event instance - CRITICAL: Must be RFC3339 format with timezone. Required for 'thisEventOnly' scope."),
      futureStartDate: RFC3339DateTimeSchema.optional().describe("Start date for future instances - CRITICAL: Must be RFC3339 format with timezone. Required for 'thisAndFollowing' scope.")
    },
    async (args: {
      calendarId: string;
      eventId: string;
      summary?: string;
      description?: string;
      start?: string;
      end?: string;
      timeZone?: string;
      location?: string;
      attendees?: Array<{ email: string }>;
      colorId?: string;
      reminders?: {
        useDefault: boolean;
        overrides?: Array<{ method?: "email" | "popup"; minutes: number }>;
      };
      recurrence?: string[];
      sendUpdates?: "all" | "externalOnly" | "none";
      modificationScope?: "thisAndFollowing" | "all" | "thisEventOnly";
      originalStartTime?: string;
      futureStartDate?: string;
    }) => {
      const handler = new UpdateEventHandler();
      return executeWithHandler(handler, args);
    }
  );

  // Delete Event - Destructive tool
  server.tool(
    "delete-event",
    "Delete a calendar event",
    {
      calendarId: CalendarIdSchema,
      eventId: z.string().describe("ID of the event to delete"),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").describe("Whether to send cancellation notifications")
    },
    async ({ calendarId, eventId, sendUpdates }: { calendarId: string, eventId: string, sendUpdates?: "all" | "externalOnly" | "none" }) => {
      const handler = new DeleteEventHandler();
      return executeWithHandler(handler, { calendarId, eventId, sendUpdates });
    }
  );

  // Get Free/Busy - Read-only tool
  server.tool(
    "get-freebusy",
    "Query free/busy information for calendars. Note: Time range is limited to a maximum of 3 months between timeMin and timeMax.",
    {
      calendars: z.array(z.object({
        id: CalendarIdSchema
      })).describe("List of calendars and/or groups to query for free/busy information"),
      timeMin: TimeMinSchema,
      timeMax: TimeMaxSchema,
      timeZone: z.string().optional().describe("Timezone for the query"),
      groupExpansionMax: z.number().int().max(100).optional().describe("Maximum number of calendars to expand per group (max 100)"),
      calendarExpansionMax: z.number().int().max(50).optional().describe("Maximum number of calendars to expand (max 50)")
    },
    async (args: {
      calendars: Array<{ id: string }>;
      timeMin: string;
      timeMax: string;
      timeZone?: string;
      groupExpansionMax?: number;
      calendarExpansionMax?: number;
    }) => {
      const handler = new FreeBusyEventHandler();
      return executeWithHandler(handler, args);
    }
  );
}