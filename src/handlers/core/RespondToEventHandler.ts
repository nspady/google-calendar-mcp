import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { createStructuredResponse } from "../../utils/response-builder.js";
import { RespondToEventResponse, convertGoogleEventToStructured } from "../../types/structured-responses.js";
import { RecurringEventHelpers, RecurringEventError, RECURRING_EVENT_ERRORS } from './RecurringEventHelpers.js';

export type RespondToEventInput = {
    calendarId: string;
    eventId: string;
    response: "accepted" | "declined" | "tentative" | "needsAction";
    comment?: string;
    modificationScope?: "thisEventOnly" | "all";
    originalStartTime?: string;
    sendUpdates?: "all" | "externalOnly" | "none";
};

export class RespondToEventHandler extends BaseToolHandler {
    async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
        const validArgs = args as RespondToEventInput;

        try {
            const calendar = this.getCalendar(oauth2Client);
            const helpers = new RecurringEventHelpers(calendar);

            // 1. Determine the target event ID (may be instance-specific for recurring events)
            let targetEventId = validArgs.eventId;

            // Handle recurring event scopes
            if (validArgs.modificationScope === 'thisEventOnly') {
                if (!validArgs.originalStartTime) {
                    throw new RecurringEventError(
                        'originalStartTime is required when modificationScope is "thisEventOnly"',
                        RECURRING_EVENT_ERRORS.MISSING_ORIGINAL_TIME
                    );
                }

                // Detect if event is recurring
                const eventType = await helpers.detectEventType(validArgs.eventId, validArgs.calendarId);
                if (eventType !== 'recurring') {
                    throw new RecurringEventError(
                        'modificationScope "thisEventOnly" can only be used with recurring events',
                        RECURRING_EVENT_ERRORS.NON_RECURRING_SCOPE
                    );
                }

                // Format instance ID for single instance response
                targetEventId = helpers.formatInstanceId(validArgs.eventId, validArgs.originalStartTime);
            } else if (validArgs.modificationScope === 'all') {
                // Use base event ID (current behavior)
                targetEventId = validArgs.eventId;
            }
            // If no scope specified, default to 'all' behavior (use base event ID)

            // 2. Get the event to find the current user's attendee entry
            const eventResponse = await calendar.events.get({
                calendarId: validArgs.calendarId,
                eventId: targetEventId
            });

            const event = eventResponse.data;
            if (!event) {
                throw new Error('Event not found');
            }

            // 3. Find the authenticated user's attendee entry (marked with self: true)
            const attendees = event.attendees || [];
            const selfAttendeeIndex = attendees.findIndex(a => a.self === true);

            if (selfAttendeeIndex === -1) {
                throw new Error(
                    'You are not an attendee of this event. Only attendees can respond to event invitations.'
                );
            }

            const selfAttendee = attendees[selfAttendeeIndex];

            // 4. Check if user is the organizer (organizers don't respond to their own events)
            if (selfAttendee.organizer === true) {
                throw new Error(
                    'You are the organizer of this event. Organizers do not respond to their own event invitations.'
                );
            }

            // 5. Update the response status and optionally comment for the authenticated user
            const updatedAttendees = [...attendees];
            updatedAttendees[selfAttendeeIndex] = {
                ...selfAttendee,
                responseStatus: validArgs.response,
                ...(validArgs.comment !== undefined && { comment: validArgs.comment })
            };

            // 6. Patch the event with the updated attendee list
            const updateResponse = await calendar.events.patch({
                calendarId: validArgs.calendarId,
                eventId: targetEventId,
                requestBody: {
                    attendees: updatedAttendees
                },
                sendUpdates: validArgs.sendUpdates || "all"
            });

            if (!updateResponse.data) {
                throw new Error('Failed to update event response');
            }

            // 7. Create structured response
            let message = `Your response has been set to "${validArgs.response}"`;
            if (validArgs.modificationScope === 'thisEventOnly') {
                message += ' for this instance only';
            } else if (validArgs.modificationScope === 'all') {
                message += ' for all instances';
            }
            if (validArgs.comment) {
                message += ` with note: "${validArgs.comment}"`;
            }

            const response: RespondToEventResponse = {
                event: convertGoogleEventToStructured(updateResponse.data, validArgs.calendarId),
                responseStatus: validArgs.response,
                message: message
            };

            return createStructuredResponse(response);
        } catch (error: any) {
            if (error instanceof RecurringEventError) {
                throw error;
            }
            throw this.handleGoogleApiError(error);
        }
    }
}
