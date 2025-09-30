/**
 * Tests for the Google Calendar MCP Server implementation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuth2Client } from "google-auth-library";

// Import tool handlers to test them directly
import { ListCalendarsHandler } from "../../handlers/core/ListCalendarsHandler.js";
import { CreateEventHandler } from "../../handlers/core/CreateEventHandler.js";
import { ListEventsHandler } from "../../handlers/core/ListEventsHandler.js";

// Mock OAuth2Client
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue({ credentials: { access_token: 'mock_access_token' } }),
    on: vi.fn(),
  }))
}));

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn().mockReturnValue({
      calendarList: {
        list: vi.fn(),
        get: vi.fn()
      },
      events: {
        list: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      },
      colors: {
        get: vi.fn()
      },
      freebusy: {
        query: vi.fn()
      }
    })
  }
}));

// Mock TokenManager
vi.mock('./auth/tokenManager.js', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    validateTokens: vi.fn().mockResolvedValue(true),
    loadSavedTokens: vi.fn().mockResolvedValue(true),
    clearTokens: vi.fn(),
  })),
}));

describe('Google Calendar MCP Server', () => {
  let mockOAuth2Client: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOAuth2Client = new OAuth2Client();
  });

  describe('McpServer Configuration', () => {
    it('should create McpServer with correct configuration', () => {
      const server = new McpServer({
        name: "google-calendar",
        version: "1.2.0"
      });

      expect(server).toBeDefined();
      // McpServer doesn't expose internal configuration for testing,
      // but we can verify it doesn't throw during creation
    });
  });

  describe('Tool Handlers', () => {
    it('should handle list-calendars tool correctly', async () => {
      const handler = new ListCalendarsHandler();
      const { google } = await import('googleapis');
      const mockCalendarApi = google.calendar('v3');

      // Mock the API response
      (mockCalendarApi.calendarList.list as any).mockResolvedValue({
        data: {
          items: [
            { 
              id: 'cal1', 
              summary: 'Work Calendar',
              timeZone: 'America/New_York',
              kind: 'calendar#calendarListEntry',
              accessRole: 'owner',
              primary: true,
              selected: true,
              hidden: false,
              backgroundColor: '#0D7377',
              defaultReminders: [
                { method: 'popup', minutes: 15 },
                { method: 'email', minutes: 60 }
              ],
              description: 'Work-related events and meetings'
            },
            { 
              id: 'cal2', 
              summary: 'Personal',
              timeZone: 'America/Los_Angeles',
              kind: 'calendar#calendarListEntry',
              accessRole: 'reader',
              primary: false,
              selected: true,
              hidden: false,
              backgroundColor: '#D50000'
            },
          ]
        }
      });

      const result = await handler.runTool({}, mockOAuth2Client);

      expect(mockCalendarApi.calendarList.list).toHaveBeenCalled();

      // Parse the JSON response
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.totalCount).toBe(2);
      expect(response.calendars).toHaveLength(2);
      expect(response.calendars[0]).toMatchObject({
        id: 'cal1',
        summary: 'Work Calendar',
        description: 'Work-related events and meetings',
        timeZone: 'America/New_York',
        backgroundColor: '#0D7377',
        accessRole: 'owner',
        primary: true,
        selected: true,
        hidden: false
      });
      expect(response.calendars[0].defaultReminders).toHaveLength(2);
      expect(response.calendars[1]).toMatchObject({
        id: 'cal2',
        summary: 'Personal',
        timeZone: 'America/Los_Angeles',
        backgroundColor: '#D50000',
        accessRole: 'reader',
        primary: false
      });
    });

    it('should handle create-event tool with valid arguments', async () => {
      const handler = new CreateEventHandler();
      const { google } = await import('googleapis');
      const mockCalendarApi = google.calendar('v3');

      const mockEventArgs = {
        calendarId: 'primary',
        summary: 'Team Meeting',
        description: 'Discuss project progress',
        start: '2024-08-15T10:00:00',
        end: '2024-08-15T11:00:00',
        attendees: [{ email: 'test@example.com' }],
        location: 'Conference Room 4',
      };

      const mockApiResponse = {
        id: 'eventId123',
        summary: mockEventArgs.summary,
      };

      // Mock calendar details for timezone retrieval
      (mockCalendarApi.calendarList.get as any).mockResolvedValue({
        data: {
          id: 'primary',
          timeZone: 'America/Los_Angeles'
        }
      });

      (mockCalendarApi.events.insert as any).mockResolvedValue({ data: mockApiResponse });

      const result = await handler.runTool(mockEventArgs, mockOAuth2Client);

      expect(mockCalendarApi.calendarList.get).toHaveBeenCalledWith({ calendarId: 'primary' });
      expect(mockCalendarApi.events.insert).toHaveBeenCalledWith({
        calendarId: mockEventArgs.calendarId,
        requestBody: expect.objectContaining({
          summary: mockEventArgs.summary,
          description: mockEventArgs.description,
          start: { dateTime: mockEventArgs.start, timeZone: 'America/Los_Angeles' },
          end: { dateTime: mockEventArgs.end, timeZone: 'America/Los_Angeles' },
          attendees: mockEventArgs.attendees,
          location: mockEventArgs.location,
        }),
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBe('eventId123');
      expect(response.event.summary).toBe('Team Meeting');
    });

    it('should use calendar default timezone when timeZone is not provided', async () => {
      const handler = new CreateEventHandler();
      const { google } = await import('googleapis');
      const mockCalendarApi = google.calendar('v3');

      const mockEventArgs = {
        calendarId: 'primary',
        summary: 'Meeting without timezone',
        start: '2024-08-15T10:00:00', // Timezone-naive datetime
        end: '2024-08-15T11:00:00', // Timezone-naive datetime
      };

      // Mock calendar details with specific timezone
      (mockCalendarApi.calendarList.get as any).mockResolvedValue({
        data: {
          id: 'primary',
          timeZone: 'Europe/London'
        }
      });

      (mockCalendarApi.events.insert as any).mockResolvedValue({
        data: { id: 'testEvent', summary: mockEventArgs.summary }
      });

      await handler.runTool(mockEventArgs, mockOAuth2Client);

      // Verify that the calendar's timezone was used
      expect(mockCalendarApi.events.insert).toHaveBeenCalledWith({
        calendarId: mockEventArgs.calendarId,
        requestBody: expect.objectContaining({
          start: { dateTime: mockEventArgs.start, timeZone: 'Europe/London' },
          end: { dateTime: mockEventArgs.end, timeZone: 'Europe/London' },
        }),
      });
    });

    it('should handle timezone-aware datetime strings correctly', async () => {
      const handler = new CreateEventHandler();
      const { google } = await import('googleapis');
      const mockCalendarApi = google.calendar('v3');

      const mockEventArgs = {
        calendarId: 'primary',
        summary: 'Meeting with timezone in datetime',
        start: '2024-08-15T10:00:00-07:00', // Timezone-aware datetime
        end: '2024-08-15T11:00:00-07:00', // Timezone-aware datetime
      };

      // Mock calendar details (should not be used since timezone is in datetime)
      (mockCalendarApi.calendarList.get as any).mockResolvedValue({
        data: {
          id: 'primary',
          timeZone: 'Europe/London'
        }
      });

      (mockCalendarApi.events.insert as any).mockResolvedValue({
        data: { id: 'testEvent', summary: mockEventArgs.summary }
      });

      await handler.runTool(mockEventArgs, mockOAuth2Client);

      // Verify that timezone from datetime was used (no timeZone property)
      expect(mockCalendarApi.events.insert).toHaveBeenCalledWith({
        calendarId: mockEventArgs.calendarId,
        requestBody: expect.objectContaining({
          start: { dateTime: mockEventArgs.start }, // No timeZone property
          end: { dateTime: mockEventArgs.end }, // No timeZone property
        }),
      });
    });

    it('should handle list-events tool correctly', async () => {
      const handler = new ListEventsHandler();
      const { google } = await import('googleapis');
      const mockCalendarApi = google.calendar('v3');

      const listEventsArgs = {
        calendarId: 'primary',
        timeMin: '2024-08-01T00:00:00Z',
        timeMax: '2024-08-31T23:59:59Z',
      };

      const mockEvents = [
        { 
          id: 'event1', 
          summary: 'Meeting', 
          start: { dateTime: '2024-08-15T10:00:00Z' }, 
          end: { dateTime: '2024-08-15T11:00:00Z' } 
        },
      ];

      (mockCalendarApi.events.list as any).mockResolvedValue({
        data: { items: mockEvents }
      });

      const result = await handler.runTool(listEventsArgs, mockOAuth2Client);

      expect(mockCalendarApi.events.list).toHaveBeenCalledWith({
        calendarId: listEventsArgs.calendarId,
        timeMin: listEventsArgs.timeMin,
        timeMax: listEventsArgs.timeMax,
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

  describe('Configuration and Environment Variables', () => {
    it('should parse environment variables correctly', async () => {
      const originalEnv = process.env;
      
      try {
        // Set test environment variables
        process.env.TRANSPORT = 'http';
        process.env.PORT = '4000';
        process.env.HOST = '0.0.0.0';
        process.env.DEBUG = 'true';

        // Import config parser after setting env vars
        const { parseArgs } = await import('../../config/TransportConfig.js');
        
        const config = parseArgs([]);

        expect(config.transport.type).toBe('http');
        expect(config.transport.port).toBe(4000);
        expect(config.transport.host).toBe('0.0.0.0');
        expect(config.debug).toBe(true);
      } finally {
        // Restore original environment
        process.env = originalEnv;
      }
    });

    it('should allow CLI arguments to override environment variables', async () => {
      const originalEnv = process.env;
      
      try {
        // Set environment variables
        process.env.TRANSPORT = 'http';
        process.env.PORT = '4000';

        const { parseArgs } = await import('../../config/TransportConfig.js');
        
        // CLI arguments should override env vars
        const config = parseArgs(['--transport', 'stdio', '--port', '5000']);

        expect(config.transport.type).toBe('stdio');
        expect(config.transport.port).toBe(5000);
      } finally {
        process.env = originalEnv;
      }
    });
  });
});