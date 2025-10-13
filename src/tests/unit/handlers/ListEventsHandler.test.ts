import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { convertToRFC3339 } from '../../../handlers/utils/datetime.js';

// Mock googleapis globally
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: vi.fn()
      },
      calendarList: {
        get: vi.fn()
      }
    }))
  }
}));

describe('ListEventsHandler JSON String Handling', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;
  
  const handler = new ListEventsHandler();
  let mockCalendar: any;

  beforeEach(() => {
    mockCalendar = {
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'test-event',
                summary: 'Test Event',
                start: { dateTime: '2025-06-02T10:00:00Z' },
                end: { dateTime: '2025-06-02T11:00:00Z' },
              }
            ]
          }
        })
      },
      calendarList: {
        get: vi.fn().mockResolvedValue({
          data: { timeZone: 'UTC' }
        }),
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'primary', summary: 'Primary Calendar' },
              { id: 'work@example.com', summary: 'Work Calendar' },
              { id: 'personal@example.com', summary: 'Personal Calendar' }
            ]
          }
        })
      }
    };
    vi.mocked(google.calendar).mockReturnValue(mockCalendar);
  });

  // Mock fetch for batch requests
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http
Content-ID: <item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "test-event", "summary": "Test Event", "start": {"dateTime": "2025-06-02T10:00:00Z"}, "end": {"dateTime": "2025-06-02T11:00:00Z"}}]}

--batch_boundary--`)
  });

  it('should handle single calendar ID as string', async () => {
    const args = {
      calendarId: 'primary',
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    const result = await handler.runTool(args, mockOAuth2Client);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const response = JSON.parse((result.content[0] as any).text);
    expect(response.events).toBeDefined();
    expect(response.totalCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle multiple calendar IDs as array', async () => {
    const args = {
      calendarId: ['primary', 'secondary@gmail.com'],
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    const result = await handler.runTool(args, mockOAuth2Client);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const response = JSON.parse((result.content[0] as any).text);
    expect(response.events).toBeDefined();
    expect(response.totalCount).toBeGreaterThanOrEqual(0);
  });

  it('should handle calendar IDs passed as JSON string', async () => {
    // This simulates the problematic case from the user
    const args = {
      calendarId: '["primary", "secondary@gmail.com"]',
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    // This would be parsed by the Zod transform before reaching the handler
    // For testing, we'll manually simulate what the transform should do
    let processedArgs = { ...args };
    if (typeof args.calendarId === 'string' && args.calendarId.startsWith('[')) {
      processedArgs.calendarId = JSON.parse(args.calendarId);
    }

    const result = await handler.runTool(processedArgs, mockOAuth2Client);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const response = JSON.parse((result.content[0] as any).text);
    expect(response.events).toBeDefined();
    expect(response.totalCount).toBeGreaterThanOrEqual(0);
    expect(response.calendars).toEqual(['primary', 'secondary@gmail.com']);
  });
});

describe('ListEventsHandler - Timezone Handling', () => {
  let handler: ListEventsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new ListEventsHandler();
    mockOAuth2Client = {} as OAuth2Client;
    mockCalendar = {
      events: {
        list: vi.fn()
      },
      calendarList: {
        get: vi.fn(),
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'primary', summary: 'Primary Calendar' },
              { id: 'work@example.com', summary: 'Work Calendar' }
            ]
          }
        })
      }
    };
    vi.mocked(google.calendar).mockReturnValue(mockCalendar);
  });

  describe('convertToRFC3339 timezone interpretation', () => {
    it('should correctly convert timezone-naive datetime to Los Angeles time', () => {
      // Test the core issue: timezone-naive datetime should be interpreted in the target timezone
      const datetime = '2025-01-01T10:00:00';
      const timezone = 'America/Los_Angeles';
      
      const result = convertToRFC3339(datetime, timezone);
      
      // In January 2025, Los Angeles is UTC-8 (PST)
      // 10:00 AM PST = 18:00 UTC
      // The result should be '2025-01-01T18:00:00Z'
      expect(result).toBe('2025-01-01T18:00:00Z');
    });

    it('should correctly convert timezone-naive datetime to New York time', () => {
      const datetime = '2025-01-01T10:00:00';
      const timezone = 'America/New_York';
      
      const result = convertToRFC3339(datetime, timezone);
      
      // In January 2025, New York is UTC-5 (EST)
      // 10:00 AM EST = 15:00 UTC
      expect(result).toBe('2025-01-01T15:00:00Z');
    });

    it('should correctly convert timezone-naive datetime to London time', () => {
      const datetime = '2025-01-01T10:00:00';
      const timezone = 'Europe/London';
      
      const result = convertToRFC3339(datetime, timezone);
      
      // In January 2025, London is UTC+0 (GMT)
      // 10:00 AM GMT = 10:00 UTC
      expect(result).toBe('2025-01-01T10:00:00Z');
    });

    it('should handle DST transitions correctly', () => {
      // Test during DST period
      const datetime = '2025-07-01T10:00:00';
      const timezone = 'America/Los_Angeles';
      
      const result = convertToRFC3339(datetime, timezone);
      
      // In July 2025, Los Angeles is UTC-7 (PDT)
      // 10:00 AM PDT = 17:00 UTC
      expect(result).toBe('2025-07-01T17:00:00Z');
    });

    it('should leave timezone-aware datetime unchanged', () => {
      const datetime = '2025-01-01T10:00:00-08:00';
      const timezone = 'America/Los_Angeles';
      
      const result = convertToRFC3339(datetime, timezone);
      
      // Should remain unchanged since it already has timezone info
      expect(result).toBe('2025-01-01T10:00:00-08:00');
    });
  });

  describe('ListEventsHandler timezone parameter usage', () => {
    beforeEach(() => {
      // Mock successful calendar list response
      mockCalendar.calendarList.get.mockResolvedValue({
        data: { timeZone: 'UTC' }
      });
      
      // Mock successful events list response
      mockCalendar.events.list.mockResolvedValue({
        data: { items: [] }
      });
    });

    it('should use timeZone parameter to interpret timezone-naive timeMin/timeMax', async () => {
      const args = {
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00',
        timeMax: '2025-01-01T18:00:00',
        timeZone: 'America/Los_Angeles'
      };

      await handler.runTool(args, mockOAuth2Client);

      // Verify that the calendar.events.list was called with correctly converted times
      expect(mockCalendar.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: '2025-01-01T18:00:00Z', // 10:00 AM PST = 18:00 UTC
        timeMax: '2025-01-02T02:00:00Z', // 18:00 PM PST = 02:00 UTC next day
        singleEvents: true,
        orderBy: 'startTime'
      });
    });

    it('should preserve timezone-aware timeMin/timeMax regardless of timeZone parameter', async () => {
      const args = {
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00-08:00',
        timeMax: '2025-01-01T18:00:00-08:00',
        timeZone: 'America/New_York' // Different timezone, should be ignored
      };

      await handler.runTool(args, mockOAuth2Client);

      // Verify that the original timezone-aware times are preserved
      expect(mockCalendar.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00-08:00',
        timeMax: '2025-01-01T18:00:00-08:00',
        singleEvents: true,
        orderBy: 'startTime'
      });
    });

    it('should fall back to calendar timezone when timeZone parameter not provided', async () => {
      // Mock calendar with Los Angeles timezone
      mockCalendar.calendarList.get.mockResolvedValue({
        data: { timeZone: 'America/Los_Angeles' }
      });

      const args = {
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00',
        timeMax: '2025-01-01T18:00:00'
        // No timeZone parameter
      };

      await handler.runTool(args, mockOAuth2Client);

      // Verify that the calendar's timezone is used for conversion
      expect(mockCalendar.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: '2025-01-01T18:00:00Z', // 10:00 AM PST = 18:00 UTC
        timeMax: '2025-01-02T02:00:00Z', // 18:00 PM PST = 02:00 UTC next day
        singleEvents: true,
        orderBy: 'startTime'
      });
    });

    it('should handle UTC timezone correctly', async () => {
      const args = {
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00',
        timeMax: '2025-01-01T18:00:00',
        timeZone: 'UTC'
      };

      await handler.runTool(args, mockOAuth2Client);

      // Verify that UTC times are handled correctly
      expect(mockCalendar.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: '2025-01-01T10:00:00Z',
        timeMax: '2025-01-01T18:00:00Z',
        singleEvents: true,
        orderBy: 'startTime'
      });
    });
  });
});