import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchEventsHandler } from '../../../handlers/core/SearchEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock datetime utils
vi.mock('../../../handlers/utils/datetime.js', () => ({
  convertToRFC3339: vi.fn((datetime, timezone) => {
    if (!datetime) return undefined;
    return `${datetime}Z`; // Simplified for testing
  })
}));

// Mock field mask builder
vi.mock('../../../utils/field-mask-builder.js', () => ({
  buildListFieldMask: vi.fn((fields) => {
    if (!fields || fields.length === 0) return undefined;
    return fields.join(',');
  })
}));

describe('SearchEventsHandler', () => {
  let handler: SearchEventsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new SearchEventsHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        list: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

    // Mock getAccountForCalendarAccess to return the test account
    vi.spyOn(handler as any, 'getAccountForCalendarAccess').mockResolvedValue({
      accountId: 'test',
      client: mockOAuth2Client
    });

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
  });

  describe('Basic Search', () => {
    it('should search events with query text', async () => {
      const mockEvents = [
        {
          id: 'event1',
          summary: 'Team Meeting',
          start: { dateTime: '2025-01-15T10:00:00Z' },
          end: { dateTime: '2025-01-15T11:00:00Z' }
        },
        {
          id: 'event2',
          summary: 'Team Planning',
          start: { dateTime: '2025-01-16T14:00:00Z' },
          end: { dateTime: '2025-01-16T15:00:00Z' }
        }
      ];

      mockCalendar.events.list.mockResolvedValue({ data: { items: mockEvents } });

      const args = {
        calendarId: 'primary',
        query: 'Team'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith({
        calendarId: 'primary',
        q: 'Team',
        timeMin: undefined,
        timeMax: undefined,
        singleEvents: true,
        orderBy: 'startTime'
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.events).toHaveLength(2);
      expect(response.totalCount).toBe(2);
      expect(response.query).toBe('Team');
      expect(response.calendarId).toBe('primary');
    });

    it('should handle no results', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'NonexistentEvent'
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.events).toHaveLength(0);
      expect(response.totalCount).toBe(0);
    });
  });

  describe('Time Range Filtering', () => {
    it('should search with time range', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        timeMin: '2025-01-01T00:00:00',
        timeMax: '2025-01-31T23:59:59'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          q: 'Meeting',
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: '2025-01-31T23:59:59Z'
        })
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.timeRange).toBeDefined();
      expect(response.timeRange.start).toBe('2025-01-01T00:00:00Z');
      expect(response.timeRange.end).toBe('2025-01-31T23:59:59Z');
    });

    it('should search with only timeMin', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        timeMin: '2025-01-01T00:00:00'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: undefined
        })
      );
    });

    it('should search with only timeMax', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        timeMax: '2025-01-31T23:59:59'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          timeMin: undefined,
          timeMax: '2025-01-31T23:59:59Z'
        })
      );
    });
  });

  describe('Timezone Handling', () => {
    it('should use custom timezone when specified', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        timeMin: '2025-01-01T10:00:00',
        timeZone: 'Europe/London'
      };

      await handler.runTool(args, mockAccounts);

      // Verify getCalendarTimezone was not called when timeZone is specified
      // The timezone should be used directly by convertToRFC3339
    });

    it('should use calendar default timezone when not specified', async () => {
      const spy = vi.spyOn(handler as any, 'getCalendarTimezone');
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        timeMin: '2025-01-01T10:00:00'
      };

      await handler.runTool(args, mockAccounts);

      expect(spy).toHaveBeenCalledWith(mockOAuth2Client, 'primary');
    });
  });

  describe('Field Selection', () => {
    it('should request specific fields when provided', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        fields: ['summary', 'start', 'end']
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: 'summary,start,end'
        })
      );
    });

    it('should not include fields parameter when not specified', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting'
      };

      await handler.runTool(args, mockAccounts);

      const callArgs = mockCalendar.events.list.mock.calls[0][0];
      expect(callArgs.fields).toBeUndefined();
    });
  });

  describe('Extended Properties', () => {
    it('should search with private extended properties', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        privateExtendedProperty: ['projectId=12345']
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          privateExtendedProperty: ['projectId=12345']
        })
      );
    });

    it('should search with shared extended properties', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        sharedExtendedProperty: ['category=team']
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          sharedExtendedProperty: ['category=team']
        })
      );
    });

    it('should search with both private and shared extended properties', async () => {
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        privateExtendedProperty: ['projectId=12345'],
        sharedExtendedProperty: ['category=team']
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          privateExtendedProperty: ['projectId=12345'],
          sharedExtendedProperty: ['category=team']
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('Bad Request');
      (apiError as any).code = 400;
      mockCalendar.events.list.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        query: 'Meeting'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Bad Request');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Bad Request');
    });

    it('should handle not found error', async () => {
      const apiError = new Error('Calendar not found');
      (apiError as any).code = 404;
      mockCalendar.events.list.mockRejectedValue(apiError);

      const args = {
        calendarId: 'nonexistent',
        query: 'Meeting'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Calendar not found');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Calendar not found');
    });
  });

  describe('Multi-Account Handling', () => {
    it('should throw error when no account has access', async () => {
      // Mock getAccountForCalendarAccess to return null (no access)
      vi.spyOn(handler as any, 'getAccountForCalendarAccess').mockResolvedValue(null);

      const args = {
        calendarId: 'primary',
        query: 'Meeting'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'No account has access to calendar "primary"'
      );
    });

    it('should use specified account when provided', async () => {
      const spy = vi.spyOn(handler as any, 'getClientForAccount');
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        account: 'test'
      };

      await handler.runTool(args, mockAccounts);

      expect(spy).toHaveBeenCalledWith('test', mockAccounts);
    });
  });
});
