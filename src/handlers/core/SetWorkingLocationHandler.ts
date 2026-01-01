import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { createTimeObject } from "../utils/datetime.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { CreateEventResponse, convertGoogleEventToStructured } from "../../types/structured-responses.js";

export type SetWorkingLocationInput = {
    account?: string;
    calendarId: string;
    summary?: string;
    start: string;
    end: string;
    timeZone?: string;
    locationType: 'homeOffice' | 'officeLocation' | 'customLocation';
    // For officeLocation
    officeLabel?: string;
    buildingId?: string;
    floorId?: string;
    floorSectionId?: string;
    deskId?: string;
    // For customLocation
    customLocationLabel?: string;
};

export class SetWorkingLocationHandler extends BaseToolHandler {
    async runTool(args: SetWorkingLocationInput, accounts: Map<string, OAuth2Client>): Promise<CallToolResult> {
        // Get OAuth2Client with automatic account selection for write operations
        const { client: oauth2Client, accountId: selectedAccountId, calendarId: resolvedCalendarId } = await this.getClientWithAutoSelection(
            args.account,
            args.calendarId,
            accounts,
            'write'
        );

        // Working Location events only work on primary calendar
        if (resolvedCalendarId !== 'primary' && !resolvedCalendarId.includes('@')) {
            throw new Error(
                'Working Location events can only be created on the primary calendar. ' +
                'Use calendarId: "primary" or your email address.'
            );
        }

        const event = await this.createWorkingLocationEvent(oauth2Client, {
            ...args,
            calendarId: resolvedCalendarId
        });

        const response: CreateEventResponse = {
            event: convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId),
            warnings: []
        };

        return createStructuredResponse(response);
    }

    private async createWorkingLocationEvent(
        client: OAuth2Client,
        args: SetWorkingLocationInput
    ): Promise<calendar_v3.Schema$Event> {
        try {
            const calendar = this.getCalendar(client);

            // Use provided timezone or calendar's default timezone
            const timezone = args.timeZone || await this.getCalendarTimezone(client, args.calendarId);

            // Build workingLocationProperties based on locationType
            const workingLocationProperties = this.buildWorkingLocationProperties(args);

            // Generate summary based on location type if not provided
            const summary = args.summary || this.generateSummary(args);

            const requestBody: calendar_v3.Schema$Event = {
                summary: summary,
                start: createTimeObject(args.start, timezone),
                end: createTimeObject(args.end, timezone),
                eventType: 'workingLocation',
                // Working location events should be visible but not block time
                visibility: 'public',
                transparency: 'transparent',
                workingLocationProperties: workingLocationProperties
            };

            const response = await calendar.events.insert({
                calendarId: args.calendarId,
                requestBody: requestBody
            });

            if (!response.data) throw new Error('Failed to create working location event, no data returned');
            return response.data;
        } catch (error: any) {
            throw this.handleGoogleApiError(error);
        }
    }

    private buildWorkingLocationProperties(args: SetWorkingLocationInput): calendar_v3.Schema$EventWorkingLocationProperties {
        const properties: calendar_v3.Schema$EventWorkingLocationProperties = {
            type: args.locationType
        };

        switch (args.locationType) {
            case 'homeOffice':
                // homeOffice is just a type indicator, no additional properties needed
                properties.homeOffice = {};
                break;

            case 'officeLocation':
                properties.officeLocation = {
                    ...(args.officeLabel && { label: args.officeLabel }),
                    ...(args.buildingId && { buildingId: args.buildingId }),
                    ...(args.floorId && { floorId: args.floorId }),
                    ...(args.floorSectionId && { floorSectionId: args.floorSectionId }),
                    ...(args.deskId && { deskId: args.deskId })
                };
                break;

            case 'customLocation':
                properties.customLocation = {
                    ...(args.customLocationLabel && { label: args.customLocationLabel })
                };
                break;
        }

        return properties;
    }

    private generateSummary(args: SetWorkingLocationInput): string {
        switch (args.locationType) {
            case 'homeOffice':
                return 'Working from home';
            case 'officeLocation':
                return args.officeLabel ? `Working from ${args.officeLabel}` : 'Working from office';
            case 'customLocation':
                return args.customLocationLabel ? `Working from ${args.customLocationLabel}` : 'Working from custom location';
            default:
                return 'Working location';
        }
    }
}
