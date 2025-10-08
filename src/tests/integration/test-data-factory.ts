// Test data factory utilities for integration tests

export interface TestEvent {
  id?: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  timeZone?: string; // Optional for all-day events
  location?: string;
  attendees?: Array<{ email: string }>;
  colorId?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: "email" | "popup"; minutes: number }>;
  };
  recurrence?: string[];
  modificationScope?: "thisAndFollowing" | "all" | "thisEventOnly";
  originalStartTime?: string;
  futureStartDate?: string;
  calendarId?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export interface PerformanceMetric {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
}

export class TestDataFactory {
  private static readonly TEST_CALENDAR_ID = process.env.TEST_CALENDAR_ID || 'primary';
  
  private createdEventIds: string[] = [];
  private performanceMetrics: PerformanceMetric[] = [];

  static getTestCalendarId(): string {
    return TestDataFactory.TEST_CALENDAR_ID;
  }

  // Helper method to format dates in RFC3339 format without milliseconds
  // For events with a timeZone field, use timezone-naive format to avoid conflicts
  public static formatDateTimeRFC3339(date: Date): string {
    const isoString = date.toISOString();
    // Return timezone-naive format (without Z suffix) to work better with timeZone field
    return isoString.replace(/\.\d{3}Z$/, '');
  }

  // Helper method to format dates in RFC3339 format with timezone (for search operations)
  public static formatDateTimeRFC3339WithTimezone(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // Event data generators
  static createSingleEvent(overrides: Partial<TestEvent> = {}): TestEvent {
    const now = new Date();
    const start = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration

    return {
      summary: 'Test Integration Event',
      description: 'Created by integration test suite',
      start: this.formatDateTimeRFC3339(start),
      end: this.formatDateTimeRFC3339(end),
      timeZone: 'America/Los_Angeles',
      location: 'Test Conference Room',
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 15 }]
      },
      ...overrides
    };
  }

  static createAllDayEvent(overrides: Partial<TestEvent> = {}): TestEvent {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    // For all-day events, use date-only format (YYYY-MM-DD)
    const startDate = tomorrow.toISOString().split('T')[0];
    const endDate = dayAfter.toISOString().split('T')[0];

    return {
      summary: 'Test All-Day Event',
      description: 'All-day test event',
      start: startDate,
      end: endDate,
      // Note: timeZone is not used for all-day events (they're date-only)
      ...overrides
    };
  }

  static createRecurringEvent(overrides: Partial<TestEvent> = {}): TestEvent {
    const start = new Date();
    start.setDate(start.getDate() + 1); // Tomorrow
    start.setHours(10, 0, 0, 0); // 10 AM
    
    const end = new Date(start);
    end.setHours(11, 0, 0, 0); // 11 AM

    return {
      summary: 'Test Recurring Meeting',
      description: 'Weekly recurring test meeting',
      start: this.formatDateTimeRFC3339(start),
      end: this.formatDateTimeRFC3339(end),
      timeZone: 'America/Los_Angeles',
      location: 'Recurring Meeting Room',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=5'], // 5 weeks
      reminders: {
        useDefault: false,
        overrides: [{ method: 'email', minutes: 1440 }] // 1 day before
      },
      ...overrides
    };
  }

  static createEventWithAttendees(overrides: Partial<TestEvent> = {}): TestEvent {
    const invitee1 = process.env.INVITEE_1;
    const invitee2 = process.env.INVITEE_2;
    
    if (!invitee1 || !invitee2) {
      throw new Error('INVITEE_1 and INVITEE_2 environment variables are required for creating events with attendees');
    }
    
    return this.createSingleEvent({
      summary: 'Test Meeting with Attendees',
      attendees: [
        { email: invitee1 },
        { email: invitee2 }
      ],
      ...overrides
    });
  }

  static createColoredEvent(colorId: string, overrides: Partial<TestEvent> = {}): TestEvent {
    return this.createSingleEvent({
      summary: `Test Event - Color ${colorId}`,
      colorId,
      ...overrides
    });
  }

  // Time range generators
  static getTimeRanges() {
    const now = new Date();
    
    return {
      // Past week
      pastWeek: {
        timeMin: this.formatDateTimeRFC3339WithTimezone(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
        timeMax: this.formatDateTimeRFC3339WithTimezone(now)
      },
      // Next week
      nextWeek: {
        timeMin: this.formatDateTimeRFC3339WithTimezone(now),
        timeMax: this.formatDateTimeRFC3339WithTimezone(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
      },
      // Next month
      nextMonth: {
        timeMin: this.formatDateTimeRFC3339WithTimezone(now),
        timeMax: this.formatDateTimeRFC3339WithTimezone(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
      },
      // Large range (3 months)
      threeMonths: {
        timeMin: this.formatDateTimeRFC3339WithTimezone(now),
        timeMax: this.formatDateTimeRFC3339WithTimezone(new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000))
      }
    };
  }

  // Performance tracking
  startTimer(_operation: string): number {
    return Date.now();
  }

  endTimer(operation: string, startTime: number, success: boolean, error?: string): void {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    this.performanceMetrics.push({
      operation,
      startTime,
      endTime,
      duration,
      success,
      error
    });
  }

  getPerformanceMetrics(): PerformanceMetric[] {
    return [...this.performanceMetrics];
  }

  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }

  // Event tracking for cleanup
  addCreatedEventId(eventId: string): void {
    this.createdEventIds.push(eventId);
  }

  getCreatedEventIds(): string[] {
    return [...this.createdEventIds];
  }

  clearCreatedEventIds(): void {
    this.createdEventIds = [];
  }

  // Search queries
  static getSearchQueries() {
    return [
      'Test Integration',
      'meeting',
      'recurring',
      'attendees',
      'Conference Room',
      'nonexistent_query_should_return_empty'
    ];
  }

  // Validation helpers
  static validateEventResponse(response: any): boolean {
    if (!response || !response.content || !Array.isArray(response.content)) {
      return false;
    }
    
    const text = response.content[0]?.text;
    // Accept empty strings for search operations - they indicate "no results found"
    return typeof text === 'string';
  }

  static extractEventIdFromResponse(response: any): string | null {
    const text = response.content[0]?.text;
    if (!text) return null;
    
    // Try to parse as JSON first (v2.0 structured response)
    try {
      const parsed = JSON.parse(text);
      if (parsed.event?.id) {
        return parsed.event.id;
      }
    } catch {
      // Fall back to legacy text parsing
    }
    
    // Look for various event ID patterns in the response (legacy)
    // Google Calendar event IDs can contain letters, numbers, underscores, and special characters
    const patterns = [
      /Event created: .* \(([^)]+)\)/, // Legacy format - Match anything within parentheses after "Event created:"
      /Event updated: .* \(([^)]+)\)/, // Legacy format - Match anything within parentheses after "Event updated:"
      /✅ Event created successfully[\s\S]*?([^\s\(]+) \(([^)]+)\)/, // New format - Extract ID from parentheses in event details
      /✅ Event updated successfully[\s\S]*?([^\s\(]+) \(([^)]+)\)/, // New format - Extract ID from parentheses in event details
      /Event ID: ([^\s]+)/, // Match non-whitespace characters after "Event ID:"
      /Created event: .* \(ID: ([^)]+)\)/, // Match anything within parentheses after "ID:"
      /\(([a-zA-Z0-9_@.-]{10,})\)/, // Specific pattern for Google Calendar IDs with common characters
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // For patterns with multiple capture groups, we want the event ID
        // which is typically in the last parentheses
        let eventId = match[match.length - 1] || match[1];
        if (eventId) {
          // Clean up the captured ID (trim whitespace)
          eventId = eventId.trim();
          // Basic validation - should be at least 10 characters
          if (eventId.length >= 10) {
            return eventId;
          }
        }
      }
    }
    
    return null;
  }

  static extractAllEventIds(response: any): string[] {
    const text = response.content[0]?.text;
    if (!text) return [];
    
    const eventIds: string[] = [];
    
    // Look for event IDs in list format - they appear in parentheses after event titles
    // Pattern: anything that looks like an event ID in parentheses
    const pattern = /\(([a-zA-Z0-9_@.-]{10,})\)/g;
    
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const eventId = match[1].trim();
      // Basic validation - should be at least 10 characters and not contain spaces
      if (eventId.length >= 10 && !eventId.includes(' ')) {
        eventIds.push(eventId);
      }
    }
    
    // Also look for Event ID: patterns
    const idPattern = /Event ID:\s*([a-zA-Z0-9_@.-]+)/g;
    while ((match = idPattern.exec(text)) !== null) {
      const eventId = match[1].trim();
      if (eventId.length >= 10 && !eventIds.includes(eventId)) {
        eventIds.push(eventId);
      }
    }
    
    return eventIds;
  }

  // Error simulation helpers
  static getInvalidTestData() {
    return {
      invalidCalendarId: 'invalid_calendar_id',
      invalidEventId: 'invalid_event_id',
      invalidTimeFormat: '2024-13-45T25:99:99Z',
      invalidTimezone: 'Invalid/Timezone',
      invalidEmail: 'not-an-email',
      invalidColorId: '999',
      malformedRecurrence: ['INVALID:RRULE'],
      futureDateInPast: '2020-01-01T10:00:00Z'
    };
  }
}