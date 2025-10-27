import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from "googleapis";
import { ListCalendarsResponse } from "../../types/structured-responses.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

export class ListCalendarsHandler extends BaseToolHandler {
    async runTool(args: any, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Get clients for specified accounts (or all if not specified)
        const selectedAccounts = this.getClientsForAccounts(args.account, accounts);

        // Fetch full calendar details from each account
        const calendarsPerAccount = await Promise.all(
            Array.from(selectedAccounts.entries()).map(async ([accountId, client]) => {
                const calendars = await this.listCalendars(client);
                return calendars.map(cal => ({ ...cal, _accountId: accountId }));
            })
        );

        const allCalendars = calendarsPerAccount.flat();

        // Use CalendarRegistry for deduplication if multiple accounts
        if (selectedAccounts.size > 1) {
            const unifiedCalendars = await this.calendarRegistry.getUnifiedCalendars(selectedAccounts);

            const response: ListCalendarsResponse = {
                calendars: unifiedCalendars.map(unified => {
                    // Find the full calendar entry from preferred account
                    const preferredCal = allCalendars.find(
                        cal => cal.id === unified.calendarId && (cal as any)._accountId === unified.preferredAccount
                    )!;

                    return {
                        id: unified.calendarId,
                        summary: preferredCal.summary ?? undefined,
                        description: preferredCal.description ?? undefined,
                        location: preferredCal.location ?? undefined,
                        timeZone: preferredCal.timeZone ?? undefined,
                        summaryOverride: preferredCal.summaryOverride ?? undefined,
                        colorId: preferredCal.colorId ?? undefined,
                        backgroundColor: preferredCal.backgroundColor ?? undefined,
                        foregroundColor: preferredCal.foregroundColor ?? undefined,
                        hidden: preferredCal.hidden ?? undefined,
                        selected: preferredCal.selected ?? undefined,
                        accessRole: preferredCal.accessRole ?? undefined,
                        defaultReminders: preferredCal.defaultReminders?.map(r => ({
                            method: (r.method as 'email' | 'popup') || 'popup',
                            minutes: r.minutes || 0
                        })),
                        notificationSettings: preferredCal.notificationSettings ? {
                            notifications: preferredCal.notificationSettings.notifications?.map(n => ({
                                type: n.type ?? undefined,
                                method: n.method ?? undefined
                            }))
                        } : undefined,
                        primary: preferredCal.primary ?? undefined,
                        deleted: preferredCal.deleted ?? undefined,
                        conferenceProperties: preferredCal.conferenceProperties ? {
                            allowedConferenceSolutionTypes: preferredCal.conferenceProperties.allowedConferenceSolutionTypes ?? undefined
                        } : undefined,
                        // Add account access information for multi-account scenarios
                        accountAccess: unified.accounts.map(a => ({
                            accountId: a.accountId,
                            accessRole: a.accessRole,
                            primary: a.primary
                        }))
                    };
                }),
                totalCount: unifiedCalendars.length,
                note: `Showing deduplicated calendars across ${selectedAccounts.size} account(s). Calendars accessible from multiple accounts show all access levels in 'accountAccess' field.`
            };

            return createStructuredResponse(response);
        }

        // Single account - no deduplication needed
        const response: ListCalendarsResponse = {
            calendars: allCalendars.map(cal => ({
                id: cal.id || '',
                summary: cal.summary ?? undefined,
                description: cal.description ?? undefined,
                location: cal.location ?? undefined,
                timeZone: cal.timeZone ?? undefined,
                summaryOverride: cal.summaryOverride ?? undefined,
                colorId: cal.colorId ?? undefined,
                backgroundColor: cal.backgroundColor ?? undefined,
                foregroundColor: cal.foregroundColor ?? undefined,
                hidden: cal.hidden ?? undefined,
                selected: cal.selected ?? undefined,
                accessRole: cal.accessRole ?? undefined,
                defaultReminders: cal.defaultReminders?.map(r => ({
                    method: (r.method as 'email' | 'popup') || 'popup',
                    minutes: r.minutes || 0
                })),
                notificationSettings: cal.notificationSettings ? {
                    notifications: cal.notificationSettings.notifications?.map(n => ({
                        type: n.type ?? undefined,
                        method: n.method ?? undefined
                    }))
                } : undefined,
                primary: cal.primary ?? undefined,
                deleted: cal.deleted ?? undefined,
                conferenceProperties: cal.conferenceProperties ? {
                    allowedConferenceSolutionTypes: cal.conferenceProperties.allowedConferenceSolutionTypes ?? undefined
                } : undefined
            })),
            totalCount: allCalendars.length
        };

        return createStructuredResponse(response);
    }

    private async listCalendars(client: OAuth2Client): Promise<calendar_v3.Schema$CalendarListEntry[]> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendarList.list();
            return response.data.items || [];
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }
}
