import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GaxiosError } from 'gaxios';
import { calendar_v3, google } from "googleapis";
import { getCredentialsProjectId } from "../../auth/utils.js";
import { CalendarRegistry } from "../../services/CalendarRegistry.js";
import { validateAccountId } from "../../auth/paths.js";
import { convertToRFC3339 } from "../../utils/datetime.js";
import { EventColorContext, ExtendedEvent, StructuredEvent, convertGoogleEventToStructured } from "../../types/structured-responses.js";
import { BatchRequestHandler } from "./BatchRequestHandler.js";
import { DayContextService } from "../../services/day-context/index.js";
import { DayContext } from "../../types/day-context.js";


export abstract class BaseToolHandler<TArgs = any> {
    protected calendarRegistry: CalendarRegistry = CalendarRegistry.getInstance();

    abstract runTool(args: TArgs, accounts: Map<string, OAuth2Client>): Promise<CallToolResult>;

    /**
     * Normalize account ID to lowercase for case-insensitive matching
     * @param accountId Account ID to normalize
     * @returns Lowercase account ID
     */
    private normalizeAccountId(accountId: string): string {
        return accountId.toLowerCase();
    }

    /**
     * Get OAuth2Client for a specific account, or the first available account if none specified.
     * Use this for read-only operations where any authenticated account will work.
     * @param accountId Optional account ID. If not provided, uses first available account.
     * @param accounts Map of available accounts
     * @returns OAuth2Client for the specified or first account
     * @throws McpError if account is invalid or not found
     */
    protected getClientForAccountOrFirst(accountId: string | undefined, accounts: Map<string, OAuth2Client>): OAuth2Client {
        // No accounts available
        if (accounts.size === 0) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                'No authenticated accounts available. Please run authentication first.'
            );
        }

        // Account ID specified - validate and retrieve
        if (accountId) {
            const normalizedId = this.normalizeAccountId(accountId);
            try {
                validateAccountId(normalizedId);
            } catch (error) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    error instanceof Error ? error.message : 'Invalid account ID'
                );
            }

            const client = accounts.get(normalizedId);
            if (!client) {
                const availableAccounts = Array.from(accounts.keys()).join(', ');
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
                );
            }
            return client;
        }

        // No account specified - use first available (sorted for consistency)
        const sortedAccountIds = Array.from(accounts.keys()).sort();
        const firstAccountId = sortedAccountIds[0];
        const client = accounts.get(firstAccountId);
        if (!client) {
            throw new McpError(
                ErrorCode.InternalError,
                'Failed to retrieve OAuth client'
            );
        }
        return client;
    }

    /**
     * Get OAuth2Client for a specific account or determine default account
     * @param accountId Optional account ID. If not provided, uses single account if available.
     * @param accounts Map of available accounts
     * @returns OAuth2Client for the specified or default account
     * @throws McpError if account is invalid or not found
     */
    protected getClientForAccount(accountId: string | undefined, accounts: Map<string, OAuth2Client>): OAuth2Client {
        // No accounts available
        if (accounts.size === 0) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                'No authenticated accounts available. Please run authentication first.'
            );
        }

        // Account ID specified - validate and retrieve
        if (accountId) {
            // Normalize to lowercase for case-insensitive matching
            const normalizedId = this.normalizeAccountId(accountId);

            // Validate account ID format (after normalization)
            try {
                validateAccountId(normalizedId);
            } catch (error) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    error instanceof Error ? error.message : 'Invalid account ID'
                );
            }

            // Get client for specified account
            const client = accounts.get(normalizedId);
            if (!client) {
                const availableAccounts = Array.from(accounts.keys()).join(', ');
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
                );
            }

            return client;
        }

        // No account specified - use default behavior
        if (accounts.size === 1) {
            // Single account - use it automatically
            const firstClient = accounts.values().next().value;
            if (!firstClient) {
                throw new McpError(
                    ErrorCode.InternalError,
                    'Failed to retrieve OAuth client'
                );
            }
            return firstClient;
        }

        // Multiple accounts but no account specified - error
        const availableAccounts = Array.from(accounts.keys()).join(', ');
        throw new McpError(
            ErrorCode.InvalidRequest,
            `Multiple accounts available (${availableAccounts}). You must specify the 'account' parameter to indicate which account to use.`
        );
    }

    /**
     * Get multiple OAuth2Clients for multi-account operations (e.g., list-events across accounts)
     * @param accountIds Account ID(s) - string, string[], or undefined
     * @param accounts Map of available accounts
     * @returns Map of accountId to OAuth2Client for the specified accounts
     * @throws McpError if any account is invalid or not found
     */
    protected getClientsForAccounts(
        accountIds: string | string[] | undefined,
        accounts: Map<string, OAuth2Client>
    ): Map<string, OAuth2Client> {
        // No accounts available
        if (accounts.size === 0) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                'No authenticated accounts available. Please run authentication first.'
            );
        }

        // Normalize to array
        const ids = this.normalizeAccountIds(accountIds);

        // If no specific accounts requested, use all available accounts
        if (ids.length === 0) {
            return accounts;
        }

        // Validate and retrieve specified accounts
        const result = new Map<string, OAuth2Client>();

        for (const id of ids) {
            // Normalize to lowercase for case-insensitive matching
            const normalizedId = this.normalizeAccountId(id);

            try {
                validateAccountId(normalizedId);
            } catch (error) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    error instanceof Error ? error.message : 'Invalid account ID'
                );
            }

            const client = accounts.get(normalizedId);
            if (!client) {
                const availableAccounts = Array.from(accounts.keys()).join(', ');
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
                );
            }

            result.set(normalizedId, client);
        }

        return result;
    }

    /**
     * Get the best account for a calendar depending on operation type
     * @param calendarId Calendar ID
     * @param accounts Available accounts
     * @param operation 'read' or 'write'
     */
    protected async getAccountForCalendarAccess(
        calendarId: string,
        accounts: Map<string, OAuth2Client>,
        operation: 'read' | 'write'
    ): Promise<{ accountId: string; client: OAuth2Client } | null> {
        // Fast path for single account - skip calendar registry lookup
        if (accounts.size === 1) {
            const entry = accounts.entries().next().value;
            if (entry) {
                const [accountId, client] = entry;
                return { accountId, client };
            }
        }

        // Multi-account case - use calendar registry for permission-based selection
        const result = await this.calendarRegistry.getAccountForCalendar(
            calendarId,
            accounts,
            operation
        );

        if (!result) {
            return null;
        }

        const client = accounts.get(result.accountId);
        if (!client) {
            return null;
        }

        return {
            accountId: result.accountId,
            client
        };
    }

    /**
     * Convenience method to get a single OAuth2Client with automatic account selection.
     * Handles the common pattern where:
     * - If account is specified, use it
     * - If no account specified, auto-select based on calendar permissions
     *
     * This eliminates repetitive boilerplate in handler implementations.
     * Supports both calendar IDs and calendar names for resolution.
     *
     * @param accountId Optional account ID from args
     * @param calendarNameOrId Calendar name or ID to check permissions for (if auto-selecting)
     * @param accounts Map of available accounts
     * @param operation 'read' or 'write' operation type
     * @returns OAuth2Client, selected account ID, resolved calendar ID, and whether it was auto-selected
     * @throws McpError if account not found or no suitable account available
     */
    protected async getClientWithAutoSelection(
        accountId: string | undefined,
        calendarNameOrId: string,
        accounts: Map<string, OAuth2Client>,
        operation: 'read' | 'write'
    ): Promise<{ client: OAuth2Client; accountId: string; calendarId: string; wasAutoSelected: boolean }> {
        // Account explicitly specified - use it
        if (accountId) {
            // Normalize account ID to lowercase
            const normalizedAccountId = this.normalizeAccountId(accountId);
            const client = this.getClientForAccount(normalizedAccountId, accounts);

            // If calendar looks like a name (not ID), resolve it using this account
            let resolvedCalendarId = calendarNameOrId;
            if (calendarNameOrId !== 'primary' && !calendarNameOrId.includes('@')) {
                resolvedCalendarId = await this.resolveCalendarId(client, calendarNameOrId);
            }

            return { client, accountId: normalizedAccountId, calendarId: resolvedCalendarId, wasAutoSelected: false };
        }

        // No account specified - use CalendarRegistry to resolve name and find best account
        const resolution = await this.calendarRegistry.resolveCalendarNameToId(
            calendarNameOrId,
            accounts,
            operation
        );

        if (!resolution) {
            const availableAccounts = Array.from(accounts.keys()).join(', ');
            const accessType = operation === 'write' ? 'write' : 'read';
            throw new McpError(
                ErrorCode.InvalidRequest,
                `No account has ${accessType} access to calendar "${calendarNameOrId}". ` +
                `Available accounts: ${availableAccounts}. Please ensure the calendar exists and ` +
                `you have the necessary permissions, or specify the 'account' parameter explicitly.`
            );
        }

        const client = accounts.get(resolution.accountId);
        if (!client) {
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to retrieve client for account "${resolution.accountId}"`
            );
        }

        return {
            client,
            accountId: resolution.accountId,
            calendarId: resolution.calendarId,
            wasAutoSelected: true
        };
    }

    /**
     * Normalize account parameter to array of account IDs
     * @param accountIds string, string[], or undefined
     * @returns Array of account IDs (empty array if undefined)
     */
    protected normalizeAccountIds(accountIds: string | string[] | undefined): string[] {
        if (!accountIds) {
            return [];
        }
        return Array.isArray(accountIds) ? accountIds : [accountIds];
    }

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

    /**
     * Combined setup for calendar operations that need both OAuth2Client and Calendar API.
     * Returns the client, calendar instance, resolved calendar ID, and account ID in one call.
     * Use this when you need immediate access to the calendar API in your handler.
     *
     * @param accountId Optional account ID from args
     * @param calendarNameOrId Calendar name or ID
     * @param accounts Map of available accounts
     * @param operation 'read' or 'write' operation type
     * @returns Object with client, calendar, accountId, and resolved calendarId
     */
    protected async setupOperation(
        accountId: string | undefined,
        calendarNameOrId: string,
        accounts: Map<string, OAuth2Client>,
        operation: 'read' | 'write'
    ): Promise<{
        client: OAuth2Client;
        calendar: calendar_v3.Calendar;
        accountId: string;
        calendarId: string;
    }> {
        const { client, accountId: selectedAccountId, calendarId: resolvedCalendarId } =
            await this.getClientWithAutoSelection(accountId, calendarNameOrId, accounts, operation);
        const calendar = this.getCalendar(client);

        return {
            client,
            calendar,
            accountId: selectedAccountId,
            calendarId: resolvedCalendarId
        };
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
     * Normalizes time range parameters to RFC3339 format for Google Calendar API.
     * Determines timezone with precedence: explicit timeZone > calendar's default > UTC.
     *
     * @param client OAuth2Client
     * @param calendarId Calendar ID (used to get default timezone if needed)
     * @param timeMin Optional start of time range
     * @param timeMax Optional end of time range
     * @param timeZone Optional explicit timezone override
     * @returns Normalized time range with resolved timezone
     */
    protected async normalizeTimeRange(
        client: OAuth2Client,
        calendarId: string,
        timeMin?: string,
        timeMax?: string,
        timeZone?: string
    ): Promise<{ timeMin?: string; timeMax?: string; timezone: string }> {
        const timezone = timeZone || await this.getCalendarTimezone(client, calendarId);
        return {
            timeMin: timeMin ? convertToRFC3339(timeMin, timezone) : undefined,
            timeMax: timeMax ? convertToRFC3339(timeMax, timezone) : undefined,
            timezone
        };
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
     * Sorts events by start time (chronological order).
     * Works with both regular events and extended events.
     * Mutates the array in place and returns it for chaining.
     */
    protected sortEventsByStartTime<T extends calendar_v3.Schema$Event>(events: T[]): T[] {
        return events.sort((a, b) => {
            const aStart = a.start?.dateTime || a.start?.date || '';
            const bStart = b.start?.dateTime || b.start?.date || '';
            return aStart.localeCompare(bStart);
        });
    }

    /**
     * Throws an error when no calendars could be resolved from multi-account resolution.
     * Provides a helpful error message listing available calendars.
     */
    protected async throwNoCalendarsFoundError(
        requestedCalendars: string[],
        selectedAccounts: Map<string, OAuth2Client>
    ): Promise<never> {
        const allCalendars = await this.calendarRegistry.getUnifiedCalendars(selectedAccounts);
        const calendarList = allCalendars.map(c => `"${c.displayName}" (${c.calendarId})`).join(', ');
        throw new McpError(
            ErrorCode.InvalidRequest,
            `None of the requested calendars could be found: ${requestedCalendars.map(c => `"${c}"`).join(', ')}. ` +
            `Available calendars: ${calendarList || 'none'}. Use 'list-calendars' to see all available calendars.`
        );
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

    /**
     * Fetches calendar default colors for multiple calendars.
     * Returns a map of calendarId to background/foreground colors.
     *
     * Handles both explicit colors (backgroundColor/foregroundColor) and
     * colorId references (which need to be resolved from the calendar color palette).
     *
     * @param client OAuth2Client
     * @param calendarIds Array of calendar IDs to fetch colors for
     * @returns Map of calendarId to hex colors
     */
    protected async getCalendarColors(
        client: OAuth2Client,
        calendarIds: string[]
    ): Promise<{
        colors: Record<string, { background: string; foreground: string }>;
        names: Record<string, string>;
        eventPalette: Record<string, { background: string; foreground: string }>;
    }> {
        const colors: Record<string, { background: string; foreground: string }> = {};
        const names: Record<string, string> = {};
        const eventPalette: Record<string, { background: string; foreground: string }> = {};

        try {
            const calendarApi = this.getCalendar(client);

            // Fetch both calendar list and color palette in parallel
            const [calendarListResponse, colorsResponse] = await Promise.all([
                calendarApi.calendarList.list(),
                calendarApi.colors.get()
            ]);

            const calendars = calendarListResponse.data.items || [];

            // Extract event color palette from the same response (avoids separate colors.get() call)
            if (colorsResponse.data.event) {
                for (const [id, color] of Object.entries(colorsResponse.data.event)) {
                    eventPalette[id] = {
                        background: color.background || '',
                        foreground: color.foreground || ''
                    };
                }
            }

            // Build calendar color palette for resolving colorId references
            const calendarPalette: Record<string, { background: string; foreground: string }> = {};
            if (colorsResponse.data.calendar) {
                for (const [id, color] of Object.entries(colorsResponse.data.calendar)) {
                    if (color.background && color.foreground) {
                        calendarPalette[id] = {
                            background: color.background,
                            foreground: color.foreground
                        };
                    }
                }
            }

            // Build a set of requested calendar IDs for fast lookup
            const requestedIds = new Set(calendarIds);
            const wantsPrimary = requestedIds.has('primary');

            for (const cal of calendars) {
                if (!cal.id) {
                    continue;
                }

                // Resolve colors: prefer explicit colors, fall back to colorId lookup
                let colorEntry: { background: string; foreground: string } | undefined;

                if (cal.backgroundColor && cal.foregroundColor) {
                    // Calendar has explicit colors set
                    colorEntry = {
                        background: cal.backgroundColor,
                        foreground: cal.foregroundColor
                    };
                } else if (cal.colorId && calendarPalette[cal.colorId]) {
                    // Calendar uses a colorId reference - resolve from palette
                    colorEntry = calendarPalette[cal.colorId];
                }

                // Calendar display name: user's override takes precedence over calendar title
                const displayName = cal.summaryOverride || cal.summary || cal.id;

                // If this calendar ID was explicitly requested, add it
                if (requestedIds.has(cal.id)) {
                    if (colorEntry) {
                        colors[cal.id] = colorEntry;
                    }
                    names[cal.id] = displayName;
                }

                // If "primary" was requested and this is the primary calendar,
                // add for both "primary" alias and the actual calendar ID
                if (wantsPrimary && cal.primary) {
                    if (colorEntry) {
                        colors['primary'] = colorEntry;
                        colors[cal.id] = colorEntry;
                    }
                    names['primary'] = displayName;
                    names[cal.id] = displayName;
                }
            }
        } catch (error) {
            // Non-fatal: return empty maps, but log for debugging
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[getCalendarColors] Failed to fetch calendar colors: ${message}`);
        }

        return { colors, names, eventPalette };
    }

    /**
     * Builds the complete color context for resolving event display colors.
     * Fetches both event color palette and calendar default colors.
     *
     * @param client OAuth2Client
     * @param calendarIds Array of calendar IDs being queried
     * @returns EventColorContext for use with convertGoogleEventToStructured
     */
    protected async buildColorContext(
        client: OAuth2Client,
        calendarIds: string[]
    ): Promise<EventColorContext> {
        // getCalendarColors returns event palette, calendar colors, and names from a single colors.get() call
        const calendarData = await this.getCalendarColors(client, calendarIds);

        return {
            eventPalette: calendarData.eventPalette,
            calendarColors: calendarData.colors,
            calendarNames: calendarData.names
        };
    }

    /**
     * Builds color context across multiple accounts by collecting calendar colors/names
     * and event palette from getCalendarColors (single colors.get() call per account).
     *
     * @param accountCalendars Array of { accountId, calendarIds } to fetch colors for
     * @param accounts Map of available OAuth2 clients
     * @returns Complete EventColorContext for use with convertGoogleEventToStructured
     */
    protected async buildMultiAccountColorContext(
        accountCalendars: Array<{ accountId: string; calendarIds: string[] }>,
        accounts: Map<string, OAuth2Client>
    ): Promise<EventColorContext> {
        const calendarColors: Record<string, { background: string; foreground: string }> = {};
        const calendarNames: Record<string, string> = {};
        let eventPalette: Record<string, { background: string; foreground: string }> = {};

        await Promise.all(
            accountCalendars
                .filter(entry => entry.calendarIds.length > 0)
                .map(async (entry) => {
                    const client = accounts.get(entry.accountId);
                    if (client) {
                        const data = await this.getCalendarColors(client, entry.calendarIds);
                        Object.assign(calendarColors, data.colors);
                        Object.assign(calendarNames, data.names);
                        // Event palette is global (same for all accounts), take from first result
                        if (Object.keys(eventPalette).length === 0 && Object.keys(data.eventPalette).length > 0) {
                            eventPalette = data.eventPalette;
                        }
                    }
                })
        );

        return { eventPalette, calendarColors, calendarNames };
    }

    /**
     * Fetches all events for a given day across all calendars and accounts.
     * Uses CalendarRegistry for deduplicated calendar list and BatchRequestHandler
     * for efficient multi-calendar fetching.
     *
     * @param date Date string (YYYY-MM-DD)
     * @param timezone IANA timezone string
     * @param accounts All available accounts
     * @returns Events sorted by start time and color context for all calendars
     */
    protected async fetchDayEventsAllCalendars(
        date: string,
        timezone: string,
        accounts: Map<string, OAuth2Client>
    ): Promise<{ events: ExtendedEvent[]; colorContext: EventColorContext }> {
        const allAccounts = this.getClientsForAccounts(undefined, accounts);

        // Get unified calendar list (cached, 5-min TTL)
        const unifiedCalendars = await this.calendarRegistry.getUnifiedCalendars(allAccounts);

        // Group calendars by preferredAccount to avoid duplicate fetches
        const calendarsByAccount = new Map<string, string[]>();
        for (const cal of unifiedCalendars) {
            const accountId = cal.preferredAccount;
            const existing = calendarsByAccount.get(accountId) || [];
            existing.push(cal.calendarId);
            calendarsByAccount.set(accountId, existing);
        }

        // Build time range for the full day (timeMax is exclusive per Google Calendar API)
        const timeMin = convertToRFC3339(`${date}T00:00:00`, timezone);
        const nextDate = new Date(`${date}T00:00:00`);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];
        const timeMax = convertToRFC3339(`${nextDateStr}T00:00:00`, timezone);

        // Fetch events from all accounts in parallel
        const eventsPerAccount: Array<{ accountId: string; calendarIds: string[]; events: ExtendedEvent[] }> = [];

        await Promise.all(
            Array.from(calendarsByAccount.entries()).map(async ([accountId, calendarIds]) => {
                const client = allAccounts.get(accountId);
                if (!client) return;

                try {
                    let events: ExtendedEvent[];
                    if (calendarIds.length === 1) {
                        const calendar = this.getCalendar(client);
                        const response = await calendar.events.list({
                            calendarId: calendarIds[0],
                            timeMin,
                            timeMax,
                            singleEvents: true,
                            orderBy: 'startTime'
                        });
                        events = (response.data.items || []).map(event => ({
                            ...event,
                            calendarId: calendarIds[0],
                            accountId
                        }));
                    } else {
                        const batchHandler = new BatchRequestHandler(client);
                        const requests = calendarIds.map(calendarId => {
                            const params = new URLSearchParams({
                                singleEvents: 'true',
                                orderBy: 'startTime',
                                timeMin,
                                timeMax
                            });
                            return {
                                method: 'GET' as const,
                                path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
                            };
                        });
                        const responses = await batchHandler.executeBatch(requests);
                        events = [];
                        responses.forEach((response, index) => {
                            const calendarId = calendarIds[index];
                            if (response.statusCode === 200 && response.body?.items) {
                                for (const event of response.body.items) {
                                    events.push({ ...event, calendarId, accountId });
                                }
                            } else {
                                const errorMessage = response.body?.error?.message || `HTTP ${response.statusCode}`;
                                process.stderr.write(`[fetchDayEventsAllCalendars] Batch error for calendar "${calendarId}": ${errorMessage}\n`);
                            }
                        });
                    }
                    eventsPerAccount.push({ accountId, calendarIds, events });
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    process.stderr.write(`[fetchDayEventsAllCalendars] Failed to fetch events for account "${accountId}": ${reason}\n`);
                    eventsPerAccount.push({ accountId, calendarIds, events: [] });
                }
            })
        );

        // Flatten and sort
        const allEvents = eventsPerAccount.flatMap(r => r.events);
        this.sortEventsByStartTime(allEvents);

        // Build color context from all accounts
        const colorContext = await this.buildMultiAccountColorContext(eventsPerAccount, allAccounts);

        return { events: allEvents, colorContext };
    }

    /**
     * Build day context for a focus event (created or updated) with graceful fallback.
     * Fetches surrounding events across all calendars, converts to structured format,
     * and assembles the day context. Falls back to single-calendar color context on error.
     */
    protected async buildEventDayContext(
        event: calendar_v3.Schema$Event,
        calendarId: string,
        accountId: string,
        timezone: string,
        accounts: Map<string, OAuth2Client>,
        oauth2Client: OAuth2Client
    ): Promise<{ structuredEvent: StructuredEvent; dayContext: DayContext | undefined }> {
        const eventDate = event.start?.dateTime || event.start?.date || '';
        const dateOnly = eventDate.split('T')[0];

        const dayContextService = new DayContextService();
        let dayContext: DayContext | undefined;
        let structuredEvent: StructuredEvent | undefined;

        try {
            const { events: allDayEvents, colorContext } = await this.fetchDayEventsAllCalendars(
                dateOnly, timezone, accounts
            );

            structuredEvent = convertGoogleEventToStructured(event, calendarId, accountId, colorContext);

            const surroundingEvents = allDayEvents
                .filter(e => e.id !== event.id)
                .map(e => convertGoogleEventToStructured(e, e.calendarId, e.accountId, colorContext));

            dayContext = dayContextService.buildDayContext(structuredEvent, surroundingEvents, timezone);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[buildEventDayContext] Failed to build day context: ${message}`);

            if (!structuredEvent) {
                const colorContext = await this.buildColorContext(oauth2Client, [calendarId]);
                structuredEvent = convertGoogleEventToStructured(event, calendarId, accountId, colorContext);
            }
        }

        return { structuredEvent: structuredEvent!, dayContext };
    }

}
