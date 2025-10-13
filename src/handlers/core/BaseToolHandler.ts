import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GaxiosError } from 'gaxios';
import { calendar_v3, google } from "googleapis";
import { getCredentialsProjectId } from "../../auth/utils.js";


export abstract class BaseToolHandler {
    abstract runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult>;

    protected handleGoogleApiError(error: unknown): never {
        if (error instanceof GaxiosError) {
            const status = error.response?.status;
            const errorData = error.response?.data;

            // Handle specific Google API errors with appropriate MCP error codes
            if (errorData?.error === 'invalid_grant') {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    'Authentication token is invalid or expired. Please re-run the authentication process (e.g., `npm run auth`).'
                );
            }

            if (status === 400) {
                // Extract detailed error information for Bad Request
                const errorMessage = errorData?.error?.message;
                const errorDetails = errorData?.error?.errors?.map((e: any) =>
                    `${e.message || e.reason}${e.location ? ` (${e.location})` : ''}`
                ).join('; ');

                // Also include raw error data for debugging if details are missing
                let fullMessage: string;
                if (errorDetails) {
                    fullMessage = `Bad Request: ${errorMessage || 'Invalid request parameters'}. Details: ${errorDetails}`;
                } else if (errorMessage) {
                    fullMessage = `Bad Request: ${errorMessage}`;
                } else {
                    // Include stringified error data for debugging
                    const errorStr = JSON.stringify(errorData, null, 2);
                    fullMessage = `Bad Request: Invalid request parameters. Raw error: ${errorStr}`;
                }

                throw new McpError(
                    ErrorCode.InvalidRequest,
                    fullMessage
                );
            }

            if (status === 403) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Access denied: ${errorData?.error?.message || 'Insufficient permissions'}`
                );
            }

            if (status === 404) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Resource not found: ${errorData?.error?.message || 'The requested calendar or event does not exist'}`
                );
            }

            if (status === 429) {
                const errorMessage = errorData?.error?.message || '';

                // Provide specific guidance for quota-related rate limits
                if (errorMessage.includes('User Rate Limit Exceeded')) {
                    throw new McpError(
                        ErrorCode.InvalidRequest,
                        `Rate limit exceeded. This may be due to missing quota project configuration.

Ensure your OAuth credentials include project_id information:
1. Check that your gcp-oauth.keys.json file contains project_id
2. Re-download credentials from Google Cloud Console if needed
3. The file should have format: {"installed": {"project_id": "your-project-id", ...}}

Original error: ${errorMessage}`
                    );
                }

                throw new McpError(
                    ErrorCode.InternalError,
                    `Rate limit exceeded. Please try again later. ${errorMessage}`
                );
            }

            if (status && status >= 500) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `Google API server error: ${errorData?.error?.message || error.message}`
                );
            }

            // Generic Google API error with detailed information
            const errorMessage = errorData?.error?.message || error.message;
            const errorDetails = errorData?.error?.errors?.map((e: any) =>
                `${e.message || e.reason}${e.location ? ` (${e.location})` : ''}`
            ).join('; ');

            const fullMessage = errorDetails
                ? `Google API error: ${errorMessage}. Details: ${errorDetails}`
                : `Google API error: ${errorMessage}`;

            throw new McpError(
                ErrorCode.InvalidRequest,
                fullMessage
            );
        }

        // Handle non-Google API errors
        if (error instanceof Error) {
            throw new McpError(
                ErrorCode.InternalError,
                `Internal error: ${error.message}`
            );
        }

        throw new McpError(
            ErrorCode.InternalError,
            'An unknown error occurred'
        );
    }

    protected getCalendar(auth: OAuth2Client): calendar_v3.Calendar {
        // Try to get project ID from credentials file for quota project header
        const quotaProjectId = getCredentialsProjectId();

        const config: any = {
            version: 'v3',
            auth,
            timeout: 3000 // 3 second timeout for API calls
        };

        // Add quota project ID if available
        if (quotaProjectId) {
            config.quotaProjectId = quotaProjectId;
        }

        return google.calendar(config);
    }

    protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    }

    /**
     * Gets calendar details including default timezone
     * @param client OAuth2Client
     * @param calendarId Calendar ID to fetch details for
     * @returns Calendar details with timezone
     */
    protected async getCalendarDetails(client: OAuth2Client, calendarId: string): Promise<calendar_v3.Schema$CalendarListEntry> {
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendarList.get({ calendarId });
            if (!response.data) {
                throw new Error(`Calendar ${calendarId} not found`);
            }
            return response.data;
        } catch (error) {
            throw this.handleGoogleApiError(error);
        }
    }

    /**
     * Gets the default timezone for a calendar, falling back to UTC if not available
     * @param client OAuth2Client
     * @param calendarId Calendar ID
     * @returns Timezone string (IANA format)
     */
    protected async getCalendarTimezone(client: OAuth2Client, calendarId: string): Promise<string> {
        try {
            const calendarDetails = await this.getCalendarDetails(client, calendarId);
            return calendarDetails.timeZone || 'UTC';
        } catch (error) {
            // If we can't get calendar details, fall back to UTC
            return 'UTC';
        }
    }

    /**
     * Resolves calendar name to calendar ID. If the input is already an ID, returns it unchanged.
     * Supports both exact and case-insensitive name matching.
     *
     * Per Google Calendar API documentation:
     * - Calendar IDs are typically email addresses (e.g., "user@gmail.com") or "primary" keyword
     * - Calendar names are stored in "summary" field (calendar title) and "summaryOverride" field (user's personal override)
     *
     * Matching priority (user's personal override name takes precedence):
     * 1. Exact match on summaryOverride
     * 2. Case-insensitive match on summaryOverride
     * 3. Exact match on summary
     * 4. Case-insensitive match on summary
     *
     * This ensures if a user has set a personal override, it's always checked first (both exact and fuzzy),
     * before falling back to the calendar's actual title.
     *
     * @param client OAuth2Client
     * @param nameOrId Calendar name (summary/summaryOverride) or ID
     * @returns Calendar ID
     * @throws McpError if calendar name cannot be resolved
     */
    protected async resolveCalendarId(client: OAuth2Client, nameOrId: string): Promise<string> {
        // If it looks like an ID (contains @ or is 'primary'), return as-is
        if (nameOrId === 'primary' || nameOrId.includes('@')) {
            return nameOrId;
        }

        // Try to resolve as a calendar name by fetching calendar list
        try {
            const calendar = this.getCalendar(client);
            const response = await calendar.calendarList.list();
            const calendars = response.data.items || [];

            const lowerName = nameOrId.toLowerCase();

            // Priority 1: Exact match on summaryOverride (user's personal name)
            let match = calendars.find(cal => cal.summaryOverride === nameOrId);

            // Priority 2: Case-insensitive match on summaryOverride
            if (!match) {
                match = calendars.find(cal =>
                    cal.summaryOverride?.toLowerCase() === lowerName
                );
            }

            // Priority 3: Exact match on summary (calendar's actual title)
            if (!match) {
                match = calendars.find(cal => cal.summary === nameOrId);
            }

            // Priority 4: Case-insensitive match on summary
            if (!match) {
                match = calendars.find(cal =>
                    cal.summary?.toLowerCase() === lowerName
                );
            }

            if (match && match.id) {
                return match.id;
            }

            // Calendar name not found - provide helpful error message showing both summary and override
            const availableCalendars = calendars
                .map(cal => {
                    if (cal.summaryOverride && cal.summaryOverride !== cal.summary) {
                        return `"${cal.summaryOverride}" / "${cal.summary}" (${cal.id})`;
                    }
                    return `"${cal.summary}" (${cal.id})`;
                })
                .join(', ');

            throw new McpError(
                ErrorCode.InvalidRequest,
                `Calendar "${nameOrId}" not found. Available calendars: ${availableCalendars || 'none'}. Use 'list-calendars' tool to see all available calendars.`
            );
        } catch (error) {
            if (error instanceof McpError) {
                throw error;
            }
            throw this.handleGoogleApiError(error);
        }
    }

    /**
     * Resolves multiple calendar names/IDs to calendar IDs in batch.
     * Fetches calendar list once for efficiency when resolving multiple calendars.
     * Optimized to skip API call if all inputs are already IDs.
     *
     * Matching priority (user's personal override name takes precedence):
     * 1. Exact match on summaryOverride
     * 2. Case-insensitive match on summaryOverride
     * 3. Exact match on summary
     * 4. Case-insensitive match on summary
     *
     * @param client OAuth2Client
     * @param namesOrIds Array of calendar names (summary/summaryOverride) or IDs
     * @returns Array of resolved calendar IDs
     * @throws McpError if any calendar name cannot be resolved
     */
    protected async resolveCalendarIds(client: OAuth2Client, namesOrIds: string[]): Promise<string[]> {
        // Filter out empty/whitespace-only strings
        const validInputs = namesOrIds.filter(item => item && item.trim().length > 0);

        if (validInputs.length === 0) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                'At least one valid calendar identifier is required'
            );
        }

        // Quick check: if all inputs look like IDs, skip the API call
        const needsResolution = validInputs.some(item =>
            item !== 'primary' && !item.includes('@')
        );

        if (!needsResolution) {
            // All inputs are already IDs, return as-is
            return validInputs;
        }

        // Batch resolve all calendars at once by fetching calendar list once
        const calendar = this.getCalendar(client);
        const response = await calendar.calendarList.list();
        const calendars = response.data.items || [];

        // Build name-to-ID mappings for efficient lookup
        // Priority: summaryOverride takes precedence over summary
        const overrideToIdMap = new Map<string, string>();
        const summaryToIdMap = new Map<string, string>();
        const lowerOverrideToIdMap = new Map<string, string>();
        const lowerSummaryToIdMap = new Map<string, string>();

        for (const cal of calendars) {
            if (cal.id) {
                if (cal.summaryOverride) {
                    overrideToIdMap.set(cal.summaryOverride, cal.id);
                    lowerOverrideToIdMap.set(cal.summaryOverride.toLowerCase(), cal.id);
                }
                if (cal.summary) {
                    summaryToIdMap.set(cal.summary, cal.id);
                    lowerSummaryToIdMap.set(cal.summary.toLowerCase(), cal.id);
                }
            }
        }

        const resolvedIds: string[] = [];
        const errors: string[] = [];

        for (const nameOrId of validInputs) {
            // If it looks like an ID (contains @ or is 'primary'), use as-is
            if (nameOrId === 'primary' || nameOrId.includes('@')) {
                resolvedIds.push(nameOrId);
                continue;
            }

            const lowerName = nameOrId.toLowerCase();

            // Priority 1: Exact match on summaryOverride
            let id = overrideToIdMap.get(nameOrId);

            // Priority 2: Case-insensitive match on summaryOverride
            if (!id) {
                id = lowerOverrideToIdMap.get(lowerName);
            }

            // Priority 3: Exact match on summary
            if (!id) {
                id = summaryToIdMap.get(nameOrId);
            }

            // Priority 4: Case-insensitive match on summary
            if (!id) {
                id = lowerSummaryToIdMap.get(lowerName);
            }

            if (id) {
                resolvedIds.push(id);
            } else {
                errors.push(nameOrId);
            }
        }

        // If any calendars couldn't be resolved, throw error with helpful message
        if (errors.length > 0) {
            const availableCalendars = calendars
                .map(cal => {
                    if (cal.summaryOverride && cal.summaryOverride !== cal.summary) {
                        return `"${cal.summaryOverride}" / "${cal.summary}" (${cal.id})`;
                    }
                    return `"${cal.summary}" (${cal.id})`;
                })
                .join(', ');

            const errorMessage = `Calendar(s) not found: ${errors.map(e => `"${e}"`).join(', ')}. Available calendars: ${availableCalendars || 'none'}. Use 'list-calendars' tool to see all available calendars.`;

            throw new McpError(
                ErrorCode.InvalidRequest,
                errorMessage
            );
        }

        return resolvedIds;
    }

}
