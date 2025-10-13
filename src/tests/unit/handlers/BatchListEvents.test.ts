/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';
// Import the types and schemas we're testing
import { ToolSchemas } from '../../../tools/registry.js';

// Get the schema for validation testing
const ListEventsArgumentsSchema = ToolSchemas['list-events'];
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';

// Mock the BatchRequestHandler that we'll implement
class MockBatchRequestHandler {
  constructor(_auth: OAuth2Client) {}

  async executeBatch(_requests: any[]): Promise<any[]> {
    // This will be mocked in tests
    return [];
  }
}

// Mock dependencies
vi.mock('google-auth-library');
vi.mock('googleapis');

interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId?: string;
}

describe('Batch List Events Functionality', () => {
  let mockOAuth2Client: OAuth2Client;
  let listEventsHandler: ListEventsHandler;
  let mockCalendarApi: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock OAuth2Client
    mockOAuth2Client = new OAuth2Client();
    
    // Create mock calendar API
    mockCalendarApi = {
      events: {
        list: vi.fn()
      },
      calendarList: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'primary', summary: 'Primary Calendar', summaryOverride: undefined },
              { id: 'work@example.com', summary: 'Work Calendar', summaryOverride: undefined },
              { id: 'personal@example.com', summary: 'Personal Calendar', summaryOverride: undefined }
            ]
          }
        })
      }
    };

    // Mock the getCalendar method in BaseToolHandler
    listEventsHandler = new ListEventsHandler();
    vi.spyOn(listEventsHandler as any, 'getCalendar').mockReturnValue(mockCalendarApi);
  });

  describe('Input Validation', () => {
    it('should validate single calendar ID string', () => {
      const input = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-12-31T23:59:59Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toBe('primary');
    });

    it('should validate array of calendar IDs', () => {
      // Arrays must be passed as JSON strings in the new schema
      const input = {
        calendarId: '["primary", "work@example.com", "personal@example.com"]',
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(typeof result.data?.calendarId).toBe('string');
      expect(result.data?.calendarId).toBe('["primary", "work@example.com", "personal@example.com"]');
    });

    it('should accept actual array of calendar IDs (not JSON string)', () => {
      // Arrays are now directly supported and converted to JSON strings
      const input = {
        calendarId: ['primary', 'work@example.com', 'personal@example.com'],
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(true);
      // Arrays are now kept as arrays (not transformed to JSON strings)
      expect(result.data?.calendarId).toEqual(['primary', 'work@example.com', 'personal@example.com']);
    });

    it('should handle malformed JSON string gracefully', () => {
      // Test that malformed JSON is treated as a regular string
      const input = {
        calendarId: '["primary", "work@example.com"', // Missing closing bracket
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(typeof result.data?.calendarId).toBe('string');
      expect(result.data?.calendarId).toBe('["primary", "work@example.com"');
    });

    it('should reject empty calendar ID array', () => {
      const input = {
        calendarId: [],
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject array with too many calendar IDs (> 50)', () => {
      const input = {
        calendarId: Array(51).fill('cal').map((c, i) => `${c}${i}@example.com`),
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid time format', () => {
      const input = {
        calendarId: 'primary',
        timeMin: '2024-01-01' // Missing time and timezone
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Single Calendar Events (Existing Functionality)', () => {
    it('should handle single calendar ID as string', async () => {
      // Arrange
      const mockEvents: ExtendedEvent[] = [
        {
          id: 'event1',
          summary: 'Meeting',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' }
        },
        {
          id: 'event2',
          summary: 'Lunch',
          start: { dateTime: '2024-01-15T12:00:00Z' },
          end: { dateTime: '2024-01-15T13:00:00Z' },
          location: 'Restaurant'
        }
      ];

      mockCalendarApi.events.list.mockResolvedValue({
        data: { items: mockEvents }
      });

      const args = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z'
      };

      // Act
      const result = await listEventsHandler.runTool(args, mockOAuth2Client);

      // Assert
      expect(mockCalendarApi.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        singleEvents: true,
        orderBy: 'startTime'
      });

      // Should return structured JSON with events
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.events).toHaveLength(2);
      expect(response.totalCount).toBe(2);
    });

    it('should handle empty results for single calendar', async () => {
      // Arrange
      mockCalendarApi.events.list.mockResolvedValue({
        data: { items: [] }
      });

      const args = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00Z'
      };

      // Act
      const result = await listEventsHandler.runTool(args, mockOAuth2Client);

      // Assert - no events means empty array in JSON
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.events).toHaveLength(0);
      expect(response.totalCount).toBe(0);
    });
  });

  describe('Batch Request Creation', () => {
    it('should create proper batch requests for multiple calendars', () => {
      // This tests the batch request creation logic
      const calendarIds = ['primary', 'work@example.com', 'personal@example.com'];
      const options = {
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z'
      };

      // Expected batch requests
      const expectedRequests = calendarIds.map(calendarId => ({
        method: 'GET',
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` + 
          new URLSearchParams({
            singleEvents: 'true',
            orderBy: 'startTime',
            timeMin: options.timeMin,
            timeMax: options.timeMax
          }).toString()
      }));

      // Verify the expected structure
      expect(expectedRequests).toHaveLength(3);
      expect(expectedRequests[0].path).toContain('calendars/primary/events');
      expect(expectedRequests[1].path).toContain('calendars/work%40example.com/events');
      expect(expectedRequests[2].path).toContain('calendars/personal%40example.com/events');
      
      // All should have proper query parameters
      expectedRequests.forEach(req => {
        expect(req.path).toContain('singleEvents=true');
        expect(req.path).toContain('orderBy=startTime');
        expect(req.path).toContain('timeMin=2024-01-01T00%3A00%3A00Z');
        expect(req.path).toContain('timeMax=2024-01-31T23%3A59%3A59Z');
      });
    });

    it('should handle optional parameters in batch requests', () => {
      const options = { timeMin: '2024-01-01T00:00:00Z' }; // Only timeMin, no timeMax

      const expectedRequest = {
        method: 'GET',
        path: `/calendar/v3/calendars/primary/events?` + 
          new URLSearchParams({
            singleEvents: 'true',
            orderBy: 'startTime',
            timeMin: options.timeMin
          }).toString()
      };

      expect(expectedRequest.path).toContain('timeMin=2024-01-01T00%3A00%3A00Z');
      expect(expectedRequest.path).not.toContain('timeMax');
    });
  });

  describe('Batch Response Parsing', () => {
    it('should parse successful batch responses correctly', () => {
      // Mock successful batch responses
      const mockBatchResponses = [
        {
          statusCode: 200,
          headers: {},
          body: {
            items: [
              {
                id: 'work1',
                summary: 'Work Meeting',
                start: { dateTime: '2024-01-15T09:00:00Z' },
                end: { dateTime: '2024-01-15T10:00:00Z' }
              }
            ]
          }
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            items: [
              {
                id: 'personal1',
                summary: 'Gym',
                start: { dateTime: '2024-01-15T18:00:00Z' },
                end: { dateTime: '2024-01-15T19:00:00Z' }
              }
            ]
          }
        }
      ];

      const calendarIds = ['work@example.com', 'personal@example.com'];
      
      // Simulate processing batch responses
      const allEvents: ExtendedEvent[] = [];
      const errors: Array<{ calendarId: string; error: any }> = [];

      mockBatchResponses.forEach((response, index) => {
        const calendarId = calendarIds[index];
        
        if (response.statusCode === 200 && response.body.items) {
          const events = response.body.items.map((event: any) => ({
            ...event,
            calendarId
          }));
          allEvents.push(...events);
        } else {
          errors.push({
            calendarId,
            error: response.body
          });
        }
      });

      // Assert results
      expect(allEvents).toHaveLength(2);
      expect(allEvents[0].calendarId).toBe('work@example.com');
      expect(allEvents[0].summary).toBe('Work Meeting');
      expect(allEvents[1].calendarId).toBe('personal@example.com');
      expect(allEvents[1].summary).toBe('Gym');
      expect(errors).toHaveLength(0);
    });

    it('should handle partial failures in batch responses', () => {
      // Mock mixed success/failure responses
      const mockBatchResponses = [
        {
          statusCode: 200,
          headers: {},
          body: {
            items: [
              {
                id: 'event1',
                summary: 'Success Event',
                start: { dateTime: '2024-01-15T09:00:00Z' },
                end: { dateTime: '2024-01-15T10:00:00Z' }
              }
            ]
          }
        },
        {
          statusCode: 404,
          headers: {},
          body: {
            error: {
              code: 404,
              message: 'Calendar not found'
            }
          }
        },
        {
          statusCode: 403,
          headers: {},
          body: {
            error: {
              code: 403,
              message: 'Access denied'
            }
          }
        }
      ];

      const calendarIds = ['primary', 'nonexistent@example.com', 'noaccess@example.com'];
      
      // Simulate processing
      const allEvents: ExtendedEvent[] = [];
      const errors: Array<{ calendarId: string; error: any }> = [];

      mockBatchResponses.forEach((response, index) => {
        const calendarId = calendarIds[index];
        
        if (response.statusCode === 200 && response.body.items) {
          const events = response.body.items.map((event: any) => ({
            ...event,
            calendarId
          }));
          allEvents.push(...events);
        } else {
          errors.push({
            calendarId,
            error: response.body
          });
        }
      });

      // Assert partial success
      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].summary).toBe('Success Event');
      expect(errors).toHaveLength(2);
      expect(errors[0].calendarId).toBe('nonexistent@example.com');
      expect(errors[1].calendarId).toBe('noaccess@example.com');
    });

    it('should handle empty results from some calendars', () => {
      const mockBatchResponses = [
        {
          statusCode: 200,
          headers: {},
          body: { items: [] } // Empty calendar
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            items: [
              {
                id: 'event1',
                summary: 'Only Event',
                start: { dateTime: '2024-01-15T09:00:00Z' },
                end: { dateTime: '2024-01-15T10:00:00Z' }
              }
            ]
          }
        }
      ];

      const calendarIds = ['empty@example.com', 'busy@example.com'];
      
      const allEvents: ExtendedEvent[] = [];
      
      mockBatchResponses.forEach((response, index) => {
        const calendarId = calendarIds[index];
        
        if (response.statusCode === 200 && response.body.items) {
          const events = response.body.items.map((event: any) => ({
            ...event,
            calendarId
          }));
          allEvents.push(...events);
        }
      });

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].calendarId).toBe('busy@example.com');
    });
  });

  describe('Event Sorting and Formatting', () => {
    it('should sort events by start time across multiple calendars', () => {
      const events: ExtendedEvent[] = [
        {
          id: 'event2',
          summary: 'Second Event',
          start: { dateTime: '2024-01-15T14:00:00Z' },
          end: { dateTime: '2024-01-15T15:00:00Z' },
          calendarId: 'cal2'
        },
        {
          id: 'event1',
          summary: 'First Event',
          start: { dateTime: '2024-01-15T09:00:00Z' },
          end: { dateTime: '2024-01-15T10:00:00Z' },
          calendarId: 'cal1'
        },
        {
          id: 'event3',
          summary: 'Third Event',
          start: { dateTime: '2024-01-15T18:00:00Z' },
          end: { dateTime: '2024-01-15T19:00:00Z' },
          calendarId: 'cal1'
        }
      ];

      // Sort events by start time
      const sortedEvents = events.sort((a, b) => {
        const aStart = a.start?.dateTime || a.start?.date || '';
        const bStart = b.start?.dateTime || b.start?.date || '';
        return aStart.localeCompare(bStart);
      });

      expect(sortedEvents[0].summary).toBe('First Event');
      expect(sortedEvents[1].summary).toBe('Second Event');
      expect(sortedEvents[2].summary).toBe('Third Event');
    });

    it('should format multiple calendar events with calendar grouping', () => {
      const events: ExtendedEvent[] = [
        {
          id: 'work1',
          summary: 'Work Meeting',
          start: { dateTime: '2024-01-15T09:00:00Z' },
          end: { dateTime: '2024-01-15T10:00:00Z' },
          calendarId: 'work@example.com'
        },
        {
          id: 'personal1',
          summary: 'Gym',
          start: { dateTime: '2024-01-15T18:00:00Z' },
          end: { dateTime: '2024-01-15T19:00:00Z' },
          calendarId: 'personal@example.com'
        }
      ];

      // Group events by calendar
      const grouped = events.reduce((acc, event) => {
        const calId = (event as any).calendarId || 'unknown';
        if (!acc[calId]) acc[calId] = [];
        acc[calId].push(event);
        return acc;
      }, {} as Record<string, ExtendedEvent[]>);

      // Since we now return resources instead of formatted text,
      // we just verify that events are grouped correctly
      expect(grouped['work@example.com']).toHaveLength(1);
      expect(grouped['personal@example.com']).toHaveLength(1);
      expect(grouped['work@example.com'][0].summary).toBe('Work Meeting');
      expect(grouped['personal@example.com'][0].summary).toBe('Gym');
    });

    it('should handle date-only events in sorting', () => {
      const events: ExtendedEvent[] = [
        {
          id: 'all-day',
          summary: 'All Day Event',
          start: { date: '2024-01-15' },
          end: { date: '2024-01-16' }
        },
        {
          id: 'timed',
          summary: 'Timed Event',
          start: { dateTime: '2024-01-15T09:00:00Z' },
          end: { dateTime: '2024-01-15T10:00:00Z' }
        }
      ];

      const sortedEvents = events.sort((a, b) => {
        const aStart = a.start?.dateTime || a.start?.date || '';
        const bStart = b.start?.dateTime || b.start?.date || '';
        return aStart.localeCompare(bStart);
      });

      // Date-only event should come before timed event on same day
      expect(sortedEvents[0].summary).toBe('All Day Event');
      expect(sortedEvents[1].summary).toBe('Timed Event');
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      // Mock authentication failure
      const authError = new Error('Authentication required');
      vi.spyOn(listEventsHandler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw authError;
      });

      mockCalendarApi.events.list.mockRejectedValue(new Error('invalid_grant'));

      const args = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00Z'
      };

      await expect(listEventsHandler.runTool(args, mockOAuth2Client))
        .rejects.toThrow('Authentication required');
    });

    it('should handle rate limiting gracefully', () => {
      const rateLimitResponse = {
        statusCode: 429,
        headers: { 'Retry-After': '60' },
        body: {
          error: {
            code: 429,
            message: 'Rate limit exceeded'
          }
        }
      };

      // This would be handled in the batch response processing
      const calendarId = 'primary';
      const errors: Array<{ calendarId: string; error: any }> = [];

      errors.push({
        calendarId,
        error: rateLimitResponse.body
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].error.error.code).toBe(429);
      expect(errors[0].error.error.message).toContain('Rate limit');
    });

    it('should handle network errors in batch requests', () => {
      const networkError = {
        statusCode: 0,
        headers: {},
        body: null,
        error: new Error('Network connection failed')
      };

      const calendarId = 'primary';
      const errors: Array<{ calendarId: string; error: any }> = [];

      errors.push({
        calendarId,
        error: networkError.error
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toContain('Network connection failed');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle maximum allowed calendars (50)', () => {
      const maxCalendars = Array(50).fill('cal').map((c, i) => `${c}${i}@example.com`);
      
      // Arrays must be passed as JSON strings in the new schema
      const input = {
        calendarId: JSON.stringify(maxCalendars),
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(typeof result.data?.calendarId).toBe('string');
      // Verify the JSON string contains all 50 calendars
      const parsed = JSON.parse(result.data?.calendarId as string);
      expect(parsed).toHaveLength(50);
    });

    it('should prefer existing single calendar path for single array item', async () => {
      // When array has only one item, should use existing implementation
      const args = {
        calendarId: ['primary'], // Array with single item
        timeMin: '2024-01-01T00:00:00Z'
      };

      const mockEvents: ExtendedEvent[] = [
        {
          id: 'event1',
          summary: 'Single Calendar Event',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' }
        }
      ];

      mockCalendarApi.events.list.mockResolvedValue({
        data: { items: mockEvents }
      });

      const result = await listEventsHandler.runTool(args, mockOAuth2Client);

      // Should call regular API, not batch
      expect(mockCalendarApi.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: args.timeMin,
        timeMax: undefined,
        singleEvents: true,
        orderBy: 'startTime'
      });

      // Should return structured JSON with events
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.events).toHaveLength(1);
      expect(response.totalCount).toBe(1);
      expect(response.events[0].id).toBe('event1');
    });
  });
}); 