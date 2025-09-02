import { OAuth2Client } from "google-auth-library";
import { calendar_v3, google } from 'googleapis';

export interface ParallelExecutorOptions {
  maxConcurrency?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ 
    id: string; 
    error: Error;
    attemptsMade: number;
  }>;
  totalTime: number;
}

/**
 * High-performance parallel executor for Google Calendar API operations
 * with concurrency control, retry logic, and connection pooling
 */
export class ParallelExecutor {
  private readonly maxConcurrency: number;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;
  private activeRequests = 0;
  private requestQueue: Array<() => void> = [];
  
  constructor(options: ParallelExecutorOptions = {}) {
    this.maxConcurrency = options.maxConcurrency || 5;
    this.timeout = options.timeout || 30000;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
  }
  
  /**
   * Execute multiple operations in parallel with concurrency control
   */
  async executeParallel<T>(
    operations: Array<{
      id: string;
      operation: () => Promise<T>;
    }>
  ): Promise<BatchResult<T>> {
    const startTime = Date.now();
    const results: Array<{
      id: string;
      result: T | Error;
      attemptsMade: number;
    }> = [];
    
    // Create promise for each operation with concurrency control
    const promises = operations.map(({ id, operation }) => 
      this.executeWithConcurrencyControl(async () => {
        const result = await this.executeWithRetry(operation, id);
        return { id, ...result };
      })
    );
    
    // Wait for all operations to complete
    const settledResults = await Promise.allSettled(promises);
    
    // Separate successful and failed results
    const successful: T[] = [];
    const failed: Array<{ id: string; error: Error; attemptsMade: number }> = [];
    
    settledResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { id, value, error, attemptsMade } = result.value;
        if (error) {
          failed.push({ id, error, attemptsMade });
        } else {
          successful.push(value);
        }
      } else {
        // This shouldn't happen with our error handling, but just in case
        failed.push({ 
          id: 'unknown', 
          error: result.reason,
          attemptsMade: 1
        });
      }
    });
    
    return {
      successful,
      failed,
      totalTime: Date.now() - startTime
    };
  }
  
  /**
   * Execute operation with concurrency control
   */
  private async executeWithConcurrencyControl<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    // Wait if we're at max concurrency
    while (this.activeRequests >= this.maxConcurrency) {
      await new Promise<void>(resolve => {
        this.requestQueue.push(resolve);
      });
    }
    
    this.activeRequests++;
    
    try {
      return await operation();
    } finally {
      this.activeRequests--;
      
      // Process next queued request if any
      const nextRequest = this.requestQueue.shift();
      if (nextRequest) {
        nextRequest();
      }
    }
  }
  
  /**
   * Execute operation with retry logic and timeout
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    identifier: string
  ): Promise<{ value: T | null; error: Error | null; attemptsMade: number }> {
    let lastError: Error | null = null;
    let attemptsMade = 0;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      attemptsMade = attempt;
      
      try {
        // Execute with timeout
        const result = await this.withTimeout(operation(), this.timeout);
        return { value: result, error: null, attemptsMade };
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors (4xx) except rate limiting (429)
        if (error.code && error.code >= 400 && error.code < 500 && error.code !== 429) {
          return { value: null, error, attemptsMade };
        }
        
        // Don't retry on the last attempt
        if (attempt < this.retryAttempts) {
          // Exponential backoff with jitter
          const baseDelay = this.retryDelay * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 1000;
          const delay = Math.min(baseDelay + jitter, 30000); // Max 30 seconds
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    return { 
      value: null, 
      error: lastError || new Error(`Failed after ${attemptsMade} attempts`),
      attemptsMade 
    };
  }
  
  /**
   * Add timeout to a promise
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
      )
    ]);
  }
  
  /**
   * Batch fetch events from multiple calendars
   */
  async fetchEventsFromCalendars(
    oauth2Client: OAuth2Client,
    calendarIds: string[],
    queryParams: any
  ): Promise<BatchResult<{ calendarId: string; events: calendar_v3.Schema$Event[] }>> {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const operations = calendarIds.map(calendarId => ({
      id: calendarId,
      operation: async () => {
        const response = await calendar.events.list({
          calendarId,
          ...queryParams
        });
        return {
          calendarId,
          events: response.data.items || []
        };
      }
    }));
    
    return this.executeParallel(operations);
  }
}