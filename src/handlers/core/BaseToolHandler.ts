import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { GaxiosError } from 'gaxios';
import { calendar_v3, google } from "googleapis";


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
                throw new McpError(
                    ErrorCode.InternalError,
                    'Rate limit exceeded. Please try again later.'
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
        return google.calendar({ 
            version: 'v3', 
            auth,
            timeout: 3000 // 3 second timeout for API calls
        });
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

}
