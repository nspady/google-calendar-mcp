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
            
            // Generic Google API error
            throw new McpError(
                ErrorCode.InvalidRequest,
                `Google API error: ${errorData?.error?.message || error.message}`
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
        let quotaProjectId: string | undefined;
        
        try {
            // Read credentials file to extract project ID
            const fs = require('fs');
            const path = require('path');
            
            // Get credentials file path (same logic as in auth/utils.ts)
            const credentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS || 
                                  path.join(process.cwd(), 'gcp-oauth.keys.json');
            
            if (fs.existsSync(credentialsPath)) {
                const credentialsContent = fs.readFileSync(credentialsPath, 'utf-8');
                const credentials = JSON.parse(credentialsContent);
                
                // Extract project_id from installed format or direct format
                if (credentials.installed?.project_id) {
                    quotaProjectId = credentials.installed.project_id;
                } else if (credentials.project_id) {
                    quotaProjectId = credentials.project_id;
                }
            }
        } catch (error) {
            // If we can't read project ID, continue without it (backward compatibility)
        }

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

}
