import { randomUUID } from "node:crypto";
import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GaxiosError } from 'gaxios';
import { CreateEventsInput } from "../../tools/registry.js";
import { BaseToolHandler } from "./BaseToolHandler.js";
import type { calendar_v3 } from 'googleapis';
import { createTimeObject, usesFallbackTimeZone } from "../../utils/datetime.js";
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

        // Pre-validate shared defaults: resolve account and calendar once before the loop
        const defaultAccount = sharedDefaults.account;
        const defaultCalendarId = sharedDefaults.calendarId ?? 'primary';

        // Fail fast: validate default account/OAuth before iterating
        const hasPerEventAccountOverrides = validArgs.events.some(e => e.account);
        if (!hasPerEventAccountOverrides) {
            // All events will use the shared account — validate it once upfront
            await this.getClientWithAutoSelection(defaultAccount, defaultCalendarId, accounts, 'write');
        }

        // Caches per unique (account, calendarId) pair
        const clientCache = new Map<string, { client: OAuth2Client; accountId: string; calendarId: string }>();
        const calendarCache = new Map<string, calendar_v3.Calendar>();
        const timezoneCache = new Map<string, string>();

        const created: StructuredEvent[] = [];
        const failed: Array<{ index: number; summary: string; error: string }> = [];

        // Circuit breaker: stop after 3 consecutive identical failures
        let consecutiveFailures = 0;
        let lastErrorMessage = '';
        const MAX_CONSECUTIVE_FAILURES = 3;

        for (let i = 0; i < validArgs.events.length; i++) {
            const eventInput = validArgs.events[i];

            // Merge shared defaults with per-event overrides
            const account = eventInput.account ?? sharedDefaults.account;
            const calendarId = eventInput.calendarId ?? sharedDefaults.calendarId ?? 'primary';
            const timeZone = eventInput.timeZone ?? sharedDefaults.timeZone;
            const sendUpdates = eventInput.sendUpdates ?? sharedDefaults.sendUpdates;

            try {
                const cacheKey = `${account ?? ''}:${calendarId}`;

                // Cache getClientWithAutoSelection per unique (account, calendarId)
                let clientResult = clientCache.get(cacheKey);
                if (!clientResult) {
                    const result = await this.getClientWithAutoSelection(account, calendarId, accounts, 'write');
                    clientResult = { client: result.client, accountId: result.accountId, calendarId: result.calendarId };
                    clientCache.set(cacheKey, clientResult);
                }

                const { client: oauth2Client, accountId: selectedAccountId, calendarId: resolvedCalendarId } = clientResult;

                // Cache getCalendar per unique (account, calendarId) — avoids redundant credential file reads
                let calendar = calendarCache.get(cacheKey);
                if (!calendar) {
                    calendar = this.getCalendar(oauth2Client);
                    calendarCache.set(cacheKey, calendar);
                }

                // Cache getCalendarTimezone per unique (account, calendarId, strictness): a lenient
                // lookup may have fallen back to UTC, which a timezone-naive event must not reuse
                let tz = timeZone;
                if (!tz) {
                    const operation = usesFallbackTimeZone(eventInput.start) || usesFallbackTimeZone(eventInput.end)
                        ? 'write' : 'read';
                    const tzCacheKey = `${selectedAccountId}:${resolvedCalendarId}:${operation}`;
                    let cachedTz = timezoneCache.get(tzCacheKey);
                    if (!cachedTz) {
                        cachedTz = await this.getCalendarTimezone(oauth2Client, resolvedCalendarId, operation);
                        timezoneCache.set(tzCacheKey, cachedTz);
                    }
                    tz = cachedTz;
                }

                // A client-chosen ID lets insertEvent repeat an insert without creating a second copy
                const eventId = randomUUID().replaceAll('-', '');
                const requestBody: calendar_v3.Schema$Event = {
                    id: eventId,
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

                const event = await this.insertEvent(calendar, eventId, {
                    calendarId: resolvedCalendarId,
                    requestBody,
                    sendUpdates,
                    ...(conferenceDataVersion && { conferenceDataVersion }),
                });

                if (!event) {
                    throw new Error('Failed to create event, no data returned');
                }

                created.push(
                    convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId)
                );

                // Reset circuit breaker on success
                consecutiveFailures = 0;
                lastErrorMessage = '';
            } catch (error: unknown) {
                const errorMessage = this.formatGoogleApiError(error);

                failed.push({
                    index: i,
                    summary: eventInput.summary,
                    error: errorMessage,
                });

                // Circuit breaker: track consecutive identical failures
                if (errorMessage === lastErrorMessage) {
                    consecutiveFailures++;
                } else {
                    consecutiveFailures = 1;
                    lastErrorMessage = errorMessage;
                }

                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && i < validArgs.events.length - 1) {
                    // Fail remaining events with same error
                    for (let j = i + 1; j < validArgs.events.length; j++) {
                        failed.push({
                            index: j,
                            summary: validArgs.events[j].summary,
                            error: `Skipped: ${lastErrorMessage}`,
                        });
                    }
                    break;
                }
            }
        }

        const response: CreateEventsResponse = {
            totalRequested: validArgs.events.length,
            totalCreated: created.length,
            totalFailed: failed.length,
            created,
            ...(failed.length > 0 && { failed }),
        };

        // When all events fail, signal error to the MCP client
        if (created.length === 0) {
            return {
                ...createStructuredResponse(response),
                isError: true,
            };
        }

        return createStructuredResponse(response);
    }

    /**
     * Inserts an event, repeating the insert once if the first attempt gets no reply.
     *
     * A timeout or dropped connection doesn't mean Google didn't save the event. Reporting it as
     * failed invites a retry that creates a second copy. The repeat carries the same event ID, so
     * if the first attempt was saved Google answers 409 and the saved event is returned instead.
     */
    private async insertEvent(
        calendar: calendar_v3.Calendar,
        eventId: string,
        params: calendar_v3.Params$Resource$Events$Insert
    ): Promise<calendar_v3.Schema$Event | null | undefined> {
        try {
            return (await calendar.events.insert(params)).data;
        } catch (error) {
            if (!this.gotNoReply(error)) throw error;
        }

        try {
            return (await calendar.events.insert(params)).data;
        } catch (error) {
            if (error instanceof GaxiosError && error.response?.status === 409) {
                // The first attempt was saved. If it can't be read back, report what was sent.
                const saved = await calendar.events
                    .get({ calendarId: params.calendarId, eventId })
                    .catch(() => undefined);
                return saved?.data ?? params.requestBody;
            }
            if (this.gotNoReply(error)) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `No reply from Google after two attempts (${error.message}). ` +
                    `The event may still have been created. Check the calendar before retrying.`
                );
            }
            throw error;
        }
    }

    /** True when a request may have reached Google but no HTTP response came back. */
    private gotNoReply(error: unknown): error is GaxiosError {
        return error instanceof GaxiosError && !error.response;
    }
}
