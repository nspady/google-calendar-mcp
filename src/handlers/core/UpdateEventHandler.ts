import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { UpdateEventInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { RecurringEventHelpers, RecurringEventError, RECURRING_EVENT_ERRORS } from './RecurringEventHelpers.js';
import { ConflictDetectionService } from "../../services/conflict-detection/index.js";
import { createTimeObject } from "../../utils/datetime.js";
import { 
    createStructuredResponse, 
    convertConflictsToStructured,
    createWarningsArray
} from "../../utils/response-builder.js";
import { 
    UpdateEventResponse,
    convertGoogleEventToStructured 
} from "../../types/structured-responses.js";

export class UpdateEventHandler extends BaseToolHandler {
    private conflictDetectionService: ConflictDetectionService;

    constructor() {
        super();
        this.conflictDetectionService = new ConflictDetectionService();
    }

    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as UpdateEventInput;

        // Setup write operation: get client, calendar API, and resolve calendar name to ID
        const { client: oauth2Client, calendar, accountId: selectedAccountId, calendarId: resolvedCalendarId } =
            await this.setupOperation(args.account, validArgs.calendarId, accounts, 'write');

        // Fetch existing event if needed for conflict checking or attendees merge
        const needsExistingEvent =
            (validArgs.checkConflicts !== false && (validArgs.start || validArgs.end)) ||
            (validArgs.attendees !== undefined && validArgs.attendees !== null);

        let existingEvent: calendar_v3.Schema$Event | null = null;
        if (needsExistingEvent) {
            const existingEventResponse = await calendar.events.get({
                calendarId: resolvedCalendarId,
                eventId: validArgs.eventId
            });
            existingEvent = existingEventResponse.data;

            if (!existingEvent) {
                throw new Error('Event not found');
            }
        }

        // Check for conflicts if enabled
        let conflicts = null;
        if (validArgs.checkConflicts !== false && (validArgs.start || validArgs.end) && existingEvent) {
            // Create updated event object for conflict checking
            const timezone = validArgs.timeZone || await this.getCalendarTimezone(oauth2Client, resolvedCalendarId);
            const eventToCheck: calendar_v3.Schema$Event = {
                ...existingEvent,
                id: validArgs.eventId,
                summary: validArgs.summary || existingEvent.summary,
                description: validArgs.description || existingEvent.description,
                start: validArgs.start ? createTimeObject(validArgs.start, timezone) : existingEvent.start,
                end: validArgs.end ? createTimeObject(validArgs.end, timezone) : existingEvent.end,
                location: validArgs.location || existingEvent.location,
            };

            // Check for conflicts
            conflicts = await this.conflictDetectionService.checkConflicts(
                oauth2Client,
                eventToCheck,
                resolvedCalendarId,
                {
                    checkDuplicates: false, // Don't check duplicates for updates
                    checkConflicts: true,
                    calendarsToCheck: validArgs.calendarsToCheck || [resolvedCalendarId]
                }
            );
        }

        // Merge attendees if provided - preserve existing attendee properties (responseStatus, etc.)
        let argsWithMergedAttendees: UpdateEventInput & { calendarId: string } = { ...validArgs, calendarId: resolvedCalendarId };
        if (validArgs.attendees !== undefined && validArgs.attendees !== null && existingEvent) {
            const mergedAttendees = this.mergeAttendees(existingEvent.attendees || [], validArgs.attendees);
            // Cast needed because mergeAttendees returns full attendee objects with responseStatus etc.
            argsWithMergedAttendees = {
                ...argsWithMergedAttendees,
                attendees: mergedAttendees as UpdateEventInput['attendees']
            };
        }

        // Update the event with resolved calendar ID and merged attendees
        const event = await this.updateEventWithScope(oauth2Client, argsWithMergedAttendees);

        // Create structured response
        const response: UpdateEventResponse = {
            event: convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId)
        };
        
        // Add conflict information if present
        if (conflicts && conflicts.hasConflicts) {
            const structuredConflicts = convertConflictsToStructured(conflicts);
            if (structuredConflicts.conflicts) {
                response.conflicts = structuredConflicts.conflicts;
            }
            response.warnings = createWarningsArray(conflicts);
        }
        
        return createStructuredResponse(response);
    }

    private async updateEventWithScope(
        client: OAuth2Client,
        args: UpdateEventInput
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = this.getCalendar(client);
            const helpers = new RecurringEventHelpers(calendar);
            
            // Get calendar's default timezone if not provided
            const defaultTimeZone = await this.getCalendarTimezone(client, args.calendarId);
            
            // Detect event type and validate scope usage
            const eventType = await helpers.detectEventType(args.eventId, args.calendarId);
            
            if (args.modificationScope && args.modificationScope !== 'all' && eventType !== 'recurring') {
                throw new RecurringEventError(
                    'Scope other than "all" only applies to recurring events',
                    RECURRING_EVENT_ERRORS.NON_RECURRING_SCOPE
                );
            }
            
            switch (args.modificationScope) {
                case 'thisEventOnly':
                    return this.updateSingleInstance(helpers, args, defaultTimeZone);
                case 'all':
                case undefined:
                    return this.updateAllInstances(helpers, args, defaultTimeZone);
                case 'thisAndFollowing':
                    return this.updateFutureInstances(helpers, args, defaultTimeZone);
                default:
                    throw new RecurringEventError(
                        `Invalid modification scope: ${args.modificationScope}`,
                        RECURRING_EVENT_ERRORS.INVALID_SCOPE
                    );
            }
        } catch (error) {
            if (error instanceof RecurringEventError) {
                throw error;
            }
            throw this.handleGoogleApiError(error);
        }
    }

    private async updateSingleInstance(
        helpers: RecurringEventHelpers,
        args: UpdateEventInput,
        defaultTimeZone: string
    ): Promise<calendar_v3.Schema$Event> {
        if (!args.originalStartTime) {
            throw new RecurringEventError(
                'originalStartTime is required for single instance updates',
                RECURRING_EVENT_ERRORS.MISSING_ORIGINAL_TIME
            );
        }

        const calendar = helpers.getCalendar();
        const instanceId = helpers.formatInstanceId(args.eventId, args.originalStartTime);

        const requestBody = helpers.buildUpdateRequestBody(args, defaultTimeZone);
        const conferenceDataVersion = requestBody.conferenceData !== undefined ? 1 : undefined;
        const supportsAttachments = requestBody.attachments !== undefined ? true : undefined;

        const response = await calendar.events.patch({
            calendarId: args.calendarId,
            eventId: instanceId,
            requestBody,
            ...(conferenceDataVersion && { conferenceDataVersion }),
            ...(supportsAttachments && { supportsAttachments })
        });

        if (!response.data) throw new Error('Failed to update event instance');
        return response.data;
    }

    private async updateAllInstances(
        helpers: RecurringEventHelpers,
        args: UpdateEventInput,
        defaultTimeZone: string
    ): Promise<calendar_v3.Schema$Event> {
        const calendar = helpers.getCalendar();

        const requestBody = helpers.buildUpdateRequestBody(args, defaultTimeZone);
        const conferenceDataVersion = requestBody.conferenceData !== undefined ? 1 : undefined;
        const supportsAttachments = requestBody.attachments !== undefined ? true : undefined;

        const response = await calendar.events.patch({
            calendarId: args.calendarId,
            eventId: args.eventId,
            requestBody,
            ...(conferenceDataVersion && { conferenceDataVersion }),
            ...(supportsAttachments && { supportsAttachments })
        });

        if (!response.data) throw new Error('Failed to update event');
        return response.data;
    }

    private async updateFutureInstances(
        helpers: RecurringEventHelpers,
        args: UpdateEventInput,
        defaultTimeZone: string
    ): Promise<calendar_v3.Schema$Event> {
        if (!args.futureStartDate) {
            throw new RecurringEventError(
                'futureStartDate is required for future instance updates',
                RECURRING_EVENT_ERRORS.MISSING_FUTURE_DATE
            );
        }

        const calendar = helpers.getCalendar();
        const effectiveTimeZone = args.timeZone || defaultTimeZone;

        // 1. Get original event
        const originalResponse = await calendar.events.get({
            calendarId: args.calendarId,
            eventId: args.eventId
        });
        const originalEvent = originalResponse.data;

        if (!originalEvent.recurrence) {
            throw new Error('Event does not have recurrence rules');
        }

        // 2. Calculate UNTIL date and update original event
        const untilDate = helpers.calculateUntilDate(args.futureStartDate);
        const updatedRecurrence = helpers.updateRecurrenceWithUntil(originalEvent.recurrence, untilDate);

        await calendar.events.patch({
            calendarId: args.calendarId,
            eventId: args.eventId,
            requestBody: { recurrence: updatedRecurrence }
        });

        // 3. Create new recurring event starting from future date
        const requestBody = helpers.buildUpdateRequestBody(args, defaultTimeZone);
        
        // Calculate end time if start time is changing
        let endTime = args.end;
        if (args.start || args.futureStartDate) {
            const newStartTime = args.start || args.futureStartDate;
            endTime = endTime || helpers.calculateEndTime(newStartTime, originalEvent);
        }

        const newEvent = {
            ...helpers.cleanEventForDuplication(originalEvent),
            ...requestBody,
            start: { 
                dateTime: args.start || args.futureStartDate, 
                timeZone: effectiveTimeZone 
            },
            end: { 
                dateTime: endTime, 
                timeZone: effectiveTimeZone 
            }
        };

        const conferenceDataVersion = newEvent.conferenceData !== undefined ? 1 : undefined;
        const supportsAttachments = newEvent.attachments !== undefined ? true : undefined;

        const response = await calendar.events.insert({
            calendarId: args.calendarId,
            requestBody: newEvent,
            ...(conferenceDataVersion && { conferenceDataVersion }),
            ...(supportsAttachments && { supportsAttachments })
        });

        if (!response.data) throw new Error('Failed to create new recurring event');
        return response.data;
    }

    /**
     * Merge new attendees with existing attendees, preserving properties like responseStatus.
     * - Existing attendees: keep all their properties (responseStatus, displayName, etc.)
     * - New attendees (not in existing list): add with only the provided email
     */
    private mergeAttendees(
        existingAttendees: calendar_v3.Schema$EventAttendee[],
        newAttendees: Array<{ email: string }>
    ): calendar_v3.Schema$EventAttendee[] {
        const existingByEmail = new Map<string, calendar_v3.Schema$EventAttendee>();
        for (const attendee of existingAttendees) {
            if (attendee.email) {
                existingByEmail.set(attendee.email.toLowerCase(), attendee);
            }
        }

        const mergedAttendees: calendar_v3.Schema$EventAttendee[] = [];

        // Process new attendees list - preserve existing data or add new
        for (const newAttendee of newAttendees) {
            const existing = existingByEmail.get(newAttendee.email.toLowerCase());
            if (existing) {
                // Preserve all existing properties (responseStatus, displayName, etc.)
                mergedAttendees.push(existing);
            } else {
                // New attendee - add with only the email
                mergedAttendees.push({ email: newAttendee.email });
            }
        }

        return mergedAttendees;
    }

}
