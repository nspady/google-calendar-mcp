import { OAuth2Client } from "google-auth-library";
import { calendar_v3, google } from 'googleapis';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { StructuredEvent } from '../../types/structured-responses.js';
import { LazyResponseConverter } from '../response/LazyResponseConverter.js';

export interface StreamOptions {
  pageSize?: number;
  maxResults?: number;
  fields?: string[];
  transform?: (event: StructuredEvent) => any;
  filter?: (event: StructuredEvent) => boolean;
}

export interface StreamResult {
  stream: Readable;
  metadata: {
    totalProcessed: number;
    totalFiltered: number;
    startTime: number;
    calendarId: string;
  };
}

/**
 * Streaming service for handling large event result sets
 * Uses generators and streams to minimize memory usage
 */
export class EventStream {
  private readonly defaultPageSize = 100;
  private readonly maxPageSize = 250;
  
  /**
   * Create a readable stream of events from a calendar
   * Uses pagination to fetch events in chunks
   */
  createEventStream(
    oauth2Client: OAuth2Client,
    calendarId: string,
    queryParams: any,
    options: StreamOptions = {}
  ): StreamResult {
    const pageSize = Math.min(
      options.pageSize || this.defaultPageSize,
      this.maxPageSize
    );
    
    const metadata = {
      totalProcessed: 0,
      totalFiltered: 0,
      startTime: Date.now(),
      calendarId
    };
    
    // Create async generator for fetching events
    const eventGenerator = this.createEventGenerator(
      oauth2Client,
      calendarId,
      queryParams,
      pageSize,
      options.maxResults,
      metadata
    );
    
    // Create readable stream from generator
    const stream = Readable.from(eventGenerator);
    
    // Apply transformations if provided
    if (options.transform || options.filter) {
      const transformStream = this.createTransformStream(
        options,
        metadata,
        calendarId,
        options.fields
      );
      
      return {
        stream: stream.pipe(transformStream),
        metadata
      };
    }
    
    return { stream, metadata };
  }
  
  /**
   * Create async generator that yields events page by page
   */
  private async *createEventGenerator(
    oauth2Client: OAuth2Client,
    calendarId: string,
    queryParams: any,
    pageSize: number,
    maxResults?: number,
    metadata: any
  ): AsyncGenerator<calendar_v3.Schema$Event> {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    let pageToken: string | undefined;
    let totalYielded = 0;
    
    do {
      try {
        // Fetch next page
        const response = await calendar.events.list({
          calendarId,
          ...queryParams,
          maxResults: pageSize,
          pageToken
        });
        
        const events = response.data.items || [];
        
        // Yield events one by one
        for (const event of events) {
          if (maxResults && totalYielded >= maxResults) {
            return;
          }
          
          yield event;
          totalYielded++;
          metadata.totalProcessed++;
        }
        
        // Get next page token
        pageToken = response.data.nextPageToken ?? undefined;
        
        // Stop if we've reached the max
        if (maxResults && totalYielded >= maxResults) {
          return;
        }
      } catch (error) {
        // Emit error and stop
        throw new Error(`Failed to fetch events: ${error}`);
      }
    } while (pageToken);
  }
  
  /**
   * Create transform stream for filtering and transforming events
   */
  private createTransformStream(
    options: StreamOptions,
    metadata: any,
    calendarId: string,
    requestedFields?: string[]
  ): Transform {
    return new Transform({
      objectMode: true,
      async transform(googleEvent: calendar_v3.Schema$Event, encoding, callback) {
        try {
          // Convert to structured format with lazy loading
          const structuredEvent = LazyResponseConverter.createLazyEvent(
            googleEvent,
            calendarId,
            requestedFields
          );
          
          // Apply filter if provided
          if (options.filter && !options.filter(structuredEvent)) {
            metadata.totalFiltered++;
            callback();
            return;
          }
          
          // Apply transformation if provided
          const result = options.transform 
            ? options.transform(structuredEvent)
            : structuredEvent;
          
          // Push transformed event
          this.push(result);
          callback();
        } catch (error: any) {
          callback(error);
        }
      }
    });
  }
  
  /**
   * Stream events from multiple calendars in parallel
   */
  async *createMultiCalendarStream(
    oauth2Client: OAuth2Client,
    calendarIds: string[],
    queryParams: any,
    options: StreamOptions = {}
  ): AsyncGenerator<{ calendarId: string; event: StructuredEvent }> {
    // Create streams for each calendar
    const streams = calendarIds.map(calendarId => ({
      calendarId,
      generator: this.createEventGenerator(
        oauth2Client,
        calendarId,
        queryParams,
        options.pageSize || this.defaultPageSize,
        options.maxResults,
        { totalProcessed: 0, totalFiltered: 0, startTime: Date.now(), calendarId }
      )
    }));
    
    // Merge streams using round-robin to ensure fairness
    const iterators = streams.map(s => ({
      calendarId: s.calendarId,
      iterator: s.generator[Symbol.asyncIterator]()
    }));
    
    let activeIterators = [...iterators];
    
    while (activeIterators.length > 0) {
      const completedIndexes: number[] = [];
      
      // Get one event from each active iterator
      for (let i = 0; i < activeIterators.length; i++) {
        const { calendarId, iterator } = activeIterators[i];
        const { value, done } = await iterator.next();
        
        if (done) {
          completedIndexes.push(i);
        } else {
          // Convert and yield
          const structuredEvent = LazyResponseConverter.createLazyEvent(
            value,
            calendarId,
            options.fields
          );
          
          if (!options.filter || options.filter(structuredEvent)) {
            yield {
              calendarId,
              event: options.transform ? options.transform(structuredEvent) : structuredEvent
            };
          }
        }
      }
      
      // Remove completed iterators
      for (let i = completedIndexes.length - 1; i >= 0; i--) {
        activeIterators.splice(completedIndexes[i], 1);
      }
    }
  }
  
  /**
   * Process stream in batches for bulk operations
   */
  async processBatches<T>(
    stream: Readable,
    batchSize: number,
    processor: (batch: T[]) => Promise<void>
  ): Promise<{ totalProcessed: number; totalBatches: number }> {
    let batch: T[] = [];
    let totalProcessed = 0;
    let totalBatches = 0;
    
    for await (const item of stream) {
      batch.push(item);
      
      if (batch.length >= batchSize) {
        await processor(batch);
        totalProcessed += batch.length;
        totalBatches++;
        batch = [];
      }
    }
    
    // Process remaining items
    if (batch.length > 0) {
      await processor(batch);
      totalProcessed += batch.length;
      totalBatches++;
    }
    
    return { totalProcessed, totalBatches };
  }
  
  /**
   * Convert stream to async iterable for easier consumption
   */
  async *streamToAsyncIterable<T>(stream: Readable): AsyncGenerator<T> {
    for await (const chunk of stream) {
      yield chunk as T;
    }
  }
  
  /**
   * Create a streaming JSON response
   * Outputs events as newline-delimited JSON (NDJSON)
   */
  createNDJSONStream(
    oauth2Client: OAuth2Client,
    calendarId: string,
    queryParams: any,
    options: StreamOptions = {}
  ): Readable {
    const { stream } = this.createEventStream(
      oauth2Client,
      calendarId,
      queryParams,
      options
    );
    
    // Transform to NDJSON format
    const ndjsonTransform = new Transform({
      objectMode: true,
      transform(event, encoding, callback) {
        try {
          const json = JSON.stringify(event);
          this.push(json + '\n');
          callback();
        } catch (error: any) {
          callback(error);
        }
      }
    });
    
    return stream.pipe(ndjsonTransform);
  }
}