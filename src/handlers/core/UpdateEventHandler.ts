import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { UpdateEventArgumentsSchema } from "../../schemas/validators.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { z } from 'zod';
import { RecurringEventHelpers, RecurringEventError, RECURRING_EVENT_ERRORS } from './RecurringEventHelpers.js';

export class UpdateEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = UpdateEventArgumentsSchema.parse(args);
        const event = await this.updateEventWithScope(oauth2Client, validArgs);
        return {
            content: [{
                type: "text",
                text: `Event updated: ${event.summary} (${event.id})`,
            }],
        };
    }

    private async updateEventWithScope(
        client: OAuth2Client,
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = this.getCalendar(client);
            const helpers = new RecurringEventHelpers(calendar);
            
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
                    return this.updateSingleInstance(helpers, args);
                case 'all':
                case undefined:
                    return this.updateAllInstances(helpers, args);
                case 'thisAndFollowing':
                    return this.updateFutureInstances(helpers, args);
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
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        if (!args.originalStartTime) {
            throw new RecurringEventError(
                'originalStartTime is required for single instance updates',
                RECURRING_EVENT_ERRORS.MISSING_ORIGINAL_TIME
            );
        }

        const calendar = helpers.getCalendar();
        const instanceId = helpers.formatInstanceId(args.eventId, args.originalStartTime);
        
        const response = await calendar.events.patch({
            calendarId: args.calendarId,
            eventId: instanceId,
            requestBody: helpers.buildUpdateRequestBody(args)
        });

        if (!response.data) throw new Error('Failed to update event instance');
        return response.data;
    }

    private async updateAllInstances(
        helpers: RecurringEventHelpers,
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        const calendar = helpers.getCalendar();
        
        const response = await calendar.events.patch({
            calendarId: args.calendarId,
            eventId: args.eventId,
            requestBody: helpers.buildUpdateRequestBody(args)
        });

        if (!response.data) throw new Error('Failed to update event');
        return response.data;
    }

    private async updateFutureInstances(
        helpers: RecurringEventHelpers,
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        if (!args.futureStartDate) {
            throw new RecurringEventError(
                'futureStartDate is required for future instance updates',
                RECURRING_EVENT_ERRORS.MISSING_FUTURE_DATE
            );
        }

        const calendar = helpers.getCalendar();

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
        const requestBody = helpers.buildUpdateRequestBody(args);
        
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
                timeZone: args.timeZone 
            },
            end: { 
                dateTime: endTime, 
                timeZone: args.timeZone 
            }
        };

        const response = await calendar.events.insert({
            calendarId: args.calendarId,
            requestBody: newEvent
        });

        if (!response.data) throw new Error('Failed to create new recurring event');
        return response.data;
    }

    // Keep the original updateEvent method for backward compatibility
    private async updateEvent(
        client: OAuth2Client,
        args: z.infer<typeof UpdateEventArgumentsSchema>
    ): Promise<calendar_v3.Schema$Event> {
        // This method now just delegates to the enhanced version
        return this.updateEventWithScope(client, args);
    }
}
