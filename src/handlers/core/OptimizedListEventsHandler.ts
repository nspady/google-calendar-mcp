import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { calendar_v3 } from 'googleapis';
import { ParallelExecutor } from "../../services/performance/ParallelExecutor.js";
import { EventStream } from "../../services/streaming/EventStream.js";
import { LazyResponseConverter } from "../../services/response/LazyResponseConverter.js";
import { createStructuredResponse } from "../../utils/response-builder.js";
import { ListEventsResponse, StructuredEvent } from "../../types/structured-responses.js";
import { convertToRFC3339 } from "../utils/datetime.js";
import { buildListFieldMask } from "../../utils/field-mask-builder.js";

interface ListEventsArgs {
  calendarId: string | string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  fields?: string[];
  privateExtendedProperty?: string[];
  sharedExtendedProperty?: string[];
  maxResults?: number;
  useStreaming?: boolean;
}

/**
 * Optimized list events handler with parallel fetching,
 * lazy field conversion, and streaming support
 */
export class OptimizedListEventsHandler extends BaseToolHandler {
  private parallelExecutor: ParallelExecutor;
  private eventStream: EventStream;
  
  constructor() {
    super();
    this.parallelExecutor = new ParallelExecutor({
      maxConcurrency: 5,
      timeout: 30000,
      retryAttempts: 2
    });
    this.eventStream = new EventStream();
  }
  
  async runTool(args: ListEventsArgs, oauth2Client: OAuth2Client): Promise<CallToolResult> {
    const validArgs = args;
    
    // Normalize calendarId to array
    const calendarIds = Array.isArray(validArgs.calendarId) 
      ? validArgs.calendarId 
      : [validArgs.calendarId];
    
    // Optimize requested fields
    const optimizedFields = LazyResponseConverter.optimizeFieldList(validArgs.fields);
    
    // Build query parameters
    const queryParams = this.buildQueryParams(validArgs, optimizedFields);
    
    // Determine if we should use streaming based on expected result size
    const shouldStream = validArgs.useStreaming || 
                        (validArgs.maxResults && validArgs.maxResults > 500) ||
                        calendarIds.length > 3;
    
    if (shouldStream) {
      return this.handleStreamingResponse(
        oauth2Client,
        calendarIds,
        queryParams,
        optimizedFields
      );
    } else {
      return this.handleParallelResponse(
        oauth2Client,
        calendarIds,
        queryParams,
        optimizedFields
      );
    }
  }
  
  /**
   * Handle response using parallel fetching
   */
  private async handleParallelResponse(
    oauth2Client: OAuth2Client,
    calendarIds: string[],
    queryParams: any,
    optimizedFields?: string[]
  ): Promise<CallToolResult> {
    const startTime = Date.now();
    
    // Fetch events from all calendars in parallel
    const result = await this.parallelExecutor.fetchEventsFromCalendars(
      oauth2Client,
      calendarIds,
      queryParams
    );
    
    // Convert to structured format using lazy loading
    const allEvents: StructuredEvent[] = [];
    
    for (const { calendarId, events } of result.successful) {
      const structuredEvents = LazyResponseConverter.convertBatch(
        events,
        calendarId,
        optimizedFields
      );
      allEvents.push(...structuredEvents);
    }
    
    // Sort by start time
    allEvents.sort((a, b) => {
      const startA = a.start?.dateTime || a.start?.date || '';
      const startB = b.start?.dateTime || b.start?.date || '';
      return startA.localeCompare(startB);
    });
    
    // Build response
    const response: ListEventsResponse = {
      events: allEvents,
      totalCount: allEvents.length,
      calendars: calendarIds,
      metadata: {
        fetchTime: Date.now() - startTime,
        parallelRequests: calendarIds.length,
        failedCalendars: result.failed.map(f => ({
          id: f.id,
          error: f.error.message
        }))
      }
    };
    
    return createStructuredResponse(response);
  }
  
  /**
   * Handle response using streaming for large result sets
   */
  private async handleStreamingResponse(
    oauth2Client: OAuth2Client,
    calendarIds: string[],
    queryParams: any,
    optimizedFields?: string[]
  ): Promise<CallToolResult> {
    const startTime = Date.now();
    const allEvents: StructuredEvent[] = [];
    const PAGE_SIZE = 100;
    const MAX_EVENTS = 1000; // Safety limit
    
    // Stream events from all calendars
    const multiStream = this.eventStream.createMultiCalendarStream(
      oauth2Client,
      calendarIds,
      queryParams,
      {
        pageSize: PAGE_SIZE,
        maxResults: MAX_EVENTS,
        fields: optimizedFields,
        filter: (event) => {
          // Filter out cancelled events
          return event.status !== 'cancelled';
        }
      }
    );
    
    // Collect events from stream
    for await (const { calendarId, event } of multiStream) {
      allEvents.push(event);
      
      // Stop if we reach the limit
      if (allEvents.length >= MAX_EVENTS) {
        break;
      }
    }
    
    // Sort by start time
    allEvents.sort((a, b) => {
      const startA = a.start?.dateTime || a.start?.date || '';
      const startB = b.start?.dateTime || b.start?.date || '';
      return startA.localeCompare(startB);
    });
    
    // Build response
    const response: ListEventsResponse = {
      events: allEvents,
      totalCount: allEvents.length,
      calendars: calendarIds,
      metadata: {
        fetchTime: Date.now() - startTime,
        streamingUsed: true,
        pageSize: PAGE_SIZE,
        truncated: allEvents.length >= MAX_EVENTS
      }
    };
    
    return createStructuredResponse(response);
  }
  
  /**
   * Build query parameters for calendar API
   */
  private buildQueryParams(args: ListEventsArgs, optimizedFields?: string[]): any {
    const params: any = {
      singleEvents: true,
      orderBy: 'startTime'
    };
    
    // Add time range
    if (args.timeMin || args.timeMax) {
      const timezone = args.timeZone;
      
      if (args.timeMin) {
        params.timeMin = this.formatDateTime(args.timeMin, timezone);
      }
      
      if (args.timeMax) {
        params.timeMax = this.formatDateTime(args.timeMax, timezone);
      }
    }
    
    // Add field mask if fields are specified
    if (optimizedFields && optimizedFields.length > 0) {
      params.fields = buildListFieldMask(optimizedFields);
    }
    
    // Add extended properties filters
    if (args.privateExtendedProperty) {
      params.privateExtendedProperty = args.privateExtendedProperty;
    }
    
    if (args.sharedExtendedProperty) {
      params.sharedExtendedProperty = args.sharedExtendedProperty;
    }
    
    // Add max results if specified
    if (args.maxResults && args.maxResults < 250) {
      params.maxResults = args.maxResults;
    }
    
    return params;
  }
  
  /**
   * Format datetime with timezone handling
   */
  private formatDateTime(datetime: string, timezone?: string): string {
    // Check if already in RFC3339 format
    if (datetime.includes('Z') || datetime.includes('+') || datetime.substring(10).includes('-')) {
      return datetime;
    }
    
    // If timezone is provided, convert to RFC3339
    if (timezone) {
      return convertToRFC3339(datetime, timezone);
    }
    
    return datetime;
  }
  
  /**
   * Get estimated result size for optimization decisions
   */
  private async estimateResultSize(
    oauth2Client: OAuth2Client,
    calendarIds: string[],
    queryParams: any
  ): Promise<number> {
    // Quick check with minimal fields to estimate size
    const calendar = this.getCalendar(oauth2Client);
    let totalEstimate = 0;
    
    for (const calendarId of calendarIds.slice(0, 3)) { // Sample first 3
      try {
        const response = await calendar.events.list({
          calendarId,
          ...queryParams,
          maxResults: 1,
          fields: 'items(id),nextPageToken'
        });
        
        // Rough estimate based on if there's a next page
        if (response.data.nextPageToken) {
          totalEstimate += 100; // Assume at least 100 events
        } else {
          totalEstimate += (response.data.items?.length || 0);
        }
      } catch {
        // Ignore errors in estimation
      }
    }
    
    // Extrapolate for remaining calendars
    if (calendarIds.length > 3) {
      totalEstimate = Math.ceil(totalEstimate * (calendarIds.length / 3));
    }
    
    return totalEstimate;
  }
}