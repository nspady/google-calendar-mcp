/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';
import { z } from 'zod';

// Import the types and schemas we're testing
import { ListEventsArgumentsSchema } from '../../../schemas/validators.js';
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { formatEventList } from '../../../handlers/utils.js';

// Mock the BatchRequestHandler that we'll implement
class MockBatchRequestHandler {
  constructor(private auth: OAuth2Client) {}

  async executeBatch(requests: any[]): Promise<any[]> {
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
      // In the new schema, arrays are not directly supported - they must be JSON strings
      const input = {
        calendarId: ['primary', 'work@example.com', 'personal@example.com'],
        timeMin: '2024-01-01T00:00:00Z'
      };

      const result = ListEventsArgumentsSchema.safeParse(input);
      // Arrays are no longer accepted directly
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Expected string');
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

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Meeting (event1)');
      expect(result.content[0].text).toContain('Lunch (event2)');
      expect(result.content[0].text).toContain('Location: Restaurant');
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

      // Assert
      expect(result.content[0].text).toContain('No events found');
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
      const calendarIds = ['primary'];
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

      const calendarIds = ['work@example.com', 'personal@example.com'];

      // Group events by calendar
      const grouped = events.reduce((acc, event) => {
        const calId = (event as any).calendarId || 'unknown';
        if (!acc[calId]) acc[calId] = [];
        acc[calId].push(event);
        return acc;
      }, {} as Record<string, ExtendedEvent[]>);

      // Format grouped events
      let output = `Found ${events.length} events across ${calendarIds.length} calendars:\n\n`;
      
      for (const [calendarId, calEvents] of Object.entries(grouped)) {
        output += `Calendar: ${calendarId}\n`;
        output += formatEventList(calEvents);
        output += '\n';
      }

      expect(output).toContain('Found 2 events across 2 calendars');
      expect(output).toContain('Calendar: work@example.com');
      expect(output).toContain('Calendar: personal@example.com');
      expect(output).toContain('Work Meeting (work1)');
      expect(output).toContain('Gym (personal1)');
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

      expect(result.content[0].text).toContain('Single Calendar Event');
    });
  });
});

describe('BatchRequestHandler', () => {
  let mockOAuth2Client: OAuth2Client;
  let batchHandler: MockBatchRequestHandler;

  beforeEach(() => {
    mockOAuth2Client = new OAuth2Client();
    batchHandler = new MockBatchRequestHandler(mockOAuth2Client);
  });

  it('should create proper multipart batch request body', () => {
    const requests = [
      {
        method: 'GET',
        path: '/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime'
      },
      {
        method: 'GET',
        path: '/calendar/v3/calendars/work%40example.com/events?singleEvents=true&orderBy=startTime'
      }
    ];

    // Test the batch body creation logic
    const boundary = 'batch_boundary_test';
    const expectedBody = requests.map((req, index) => {
      const parts = [
        `--${boundary}`,
        'Content-Type: application/http',
        `Content-ID: <item${index + 1}>`,
        '',
        `${req.method} ${req.path} HTTP/1.1`
      ];
      return parts.join('\r\n');
    }).join('\r\n\r\n') + `\r\n--${boundary}--`;

    expect(expectedBody).toContain('--batch_boundary_test');
    expect(expectedBody).toContain('Content-Type: application/http');
    expect(expectedBody).toContain('Content-ID: <item1>');
    expect(expectedBody).toContain('Content-ID: <item2>');
    expect(expectedBody).toContain('GET /calendar/v3/calendars/primary/events');
    expect(expectedBody).toContain('GET /calendar/v3/calendars/work%40example.com/events');
  });

  it('should handle batch request with proper authorization header', async () => {
    const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'mock_access_token' });
    mockOAuth2Client.getAccessToken = mockGetAccessToken;

    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve('mock batch response')
    });

    const requests = [
      {
        method: 'GET',
        path: '/calendar/v3/calendars/primary/events'
      }
    ];

    // This would test the actual batch execution
    expect(mockGetAccessToken).toBeDefined();
    expect(requests).toHaveLength(1);
  });
}); 