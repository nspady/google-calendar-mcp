import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { UpdateEventInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { RecurringEventHelpers, RecurringEventError, RECURRING_EVENT_ERRORS } from './RecurringEventHelpers.js';
import { ConflictDetectionService } from "../../services/conflict-detection/index.js";
import { createTimeObject } from "../utils/datetime.js";
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
    
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = args as UpdateEventInput;

        // Check for conflicts if enabled
        let conflicts = null;
        if (validArgs.checkConflicts !== false && (validArgs.start || validArgs.end)) {
            // Get the existing event to merge with updates
            const calendar = this.getCalendar(oauth2Client);
            const existingEvent = await calendar.events.get({
                calendarId: validArgs.calendarId,
                eventId: validArgs.eventId
            });

            if (!existingEvent.data) {
                throw new Error('Event not found');
            }

            // Create updated event object for conflict checking
            const timezone = validArgs.timeZone || await this.getCalendarTimezone(oauth2Client, validArgs.calendarId);
            const eventToCheck: calendar_v3.Schema$Event = {
                ...existingEvent.data,
                id: validArgs.eventId,
                summary: validArgs.summary || existingEvent.data.summary,
                description: validArgs.description || existingEvent.data.description,
                start: validArgs.start ? createTimeObject(validArgs.start, timezone) : existingEvent.data.start,
                end: validArgs.end ? createTimeObject(validArgs.end, timezone) : existingEvent.data.end,
                location: validArgs.location || existingEvent.data.location,
            };

            // Check for conflicts
            conflicts = await this.conflictDetectionService.checkConflicts(
                oauth2Client,
                eventToCheck,
                validArgs.calendarId,
                {
                    checkDuplicates: false, // Don't check duplicates for updates
                    checkConflicts: true,
                    calendarsToCheck: validArgs.calendarsToCheck || [validArgs.calendarId]
                }
            );
        }

        // Update the event
        const event = await this.updateEventWithScope(oauth2Client, validArgs);

        // Create structured response
        const response: UpdateEventResponse = {
            event: convertGoogleEventToStructured(event, validArgs.calendarId)
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

}
