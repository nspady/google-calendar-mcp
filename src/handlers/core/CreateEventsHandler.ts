import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { CreateEventsInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { createTimeObject } from "../../utils/datetime.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { CreateEventsResponse, convertGoogleEventToStructured, StructuredEvent } from "../../types/structured-responses.js";

export class CreateEventsHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        const validArgs = args as CreateEventsInput;
        const sharedDefaults = {
            account: validArgs.account,
            calendarId: validArgs.calendarId,
            timeZone: validArgs.timeZone,
            sendUpdates: validArgs.sendUpdates,
        };

        const created: StructuredEvent[] = [];
        const failed: Array<{ index: number; summary: string; error: string }> = [];

        for (let i = 0; i < validArgs.events.length; i++) {
            const eventInput = validArgs.events[i];

            // Merge shared defaults with per-event overrides
            const account = eventInput.account || sharedDefaults.account;
            const calendarId = eventInput.calendarId || sharedDefaults.calendarId || 'primary';
            const timeZone = eventInput.timeZone || sharedDefaults.timeZone;
            const sendUpdates = eventInput.sendUpdates || sharedDefaults.sendUpdates;

            try {
                // Get OAuth2Client with automatic account selection for write operations
                const { client: oauth2Client, accountId: selectedAccountId, calendarId: resolvedCalendarId } =
                    await this.getClientWithAutoSelection(account, calendarId, accounts, 'write');

                const calendar = this.getCalendar(oauth2Client);

                // Use provided timezone or calendar's default timezone
                const tz = timeZone || await this.getCalendarTimezone(oauth2Client, resolvedCalendarId);

                const requestBody: calendar_v3.Schema$Event = {
                    summary: eventInput.summary,
                    description: eventInput.description,
                    start: createTimeObject(eventInput.start, tz),
                    end: createTimeObject(eventInput.end, tz),
                    attendees: eventInput.attendees,
                    location: eventInput.location,
                    colorId: eventInput.colorId,
                    reminders: eventInput.reminders,
                    recurrence: eventInput.recurrence,
                    transparency: eventInput.transparency,
                    visibility: eventInput.visibility,
                    guestsCanInviteOthers: eventInput.guestsCanInviteOthers,
                    guestsCanModify: eventInput.guestsCanModify,
                    guestsCanSeeOtherGuests: eventInput.guestsCanSeeOtherGuests,
                    anyoneCanAddSelf: eventInput.anyoneCanAddSelf,
                    conferenceData: eventInput.conferenceData,
                };

                const conferenceDataVersion = eventInput.conferenceData ? 1 : undefined;

                const response = await calendar.events.insert({
                    calendarId: resolvedCalendarId,
                    requestBody,
                    sendUpdates,
                    ...(conferenceDataVersion && { conferenceDataVersion }),
                });

                if (!response.data) {
                    throw new Error('Failed to create event, no data returned');
                }

                created.push(
                    convertGoogleEventToStructured(response.data, resolvedCalendarId, selectedAccountId)
                );
            } catch (error: any) {
                failed.push({
                    index: i,
                    summary: eventInput.summary,
                    error: error?.message || 'Unknown error',
                });
            }
        }

        const response: CreateEventsResponse = {
            totalRequested: validArgs.events.length,
            totalCreated: created.length,
            totalFailed: failed.length,
            created,
            ...(failed.length > 0 && { failed }),
        };

        return createStructuredResponse(response);
    }
}
