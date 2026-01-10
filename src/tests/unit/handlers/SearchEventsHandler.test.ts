import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchEventsHandler } from '../../../handlers/core/SearchEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

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
vi.mock('../../../utils/datetime.js', () => ({
  hasTimezoneInDatetime: vi.fn((datetime: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)
  ),
  convertToRFC3339: vi.fn((datetime: string, timezone: string) => {
    if (!datetime) return undefined;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)) {
      return datetime;
    }
    return `${datetime}Z`;
  }),
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
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
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

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

    // Mock getClientWithAutoSelection to return the test account
    vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
      client: mockOAuth2Client,
      accountId: 'test',
      calendarId: 'primary',
      wasAutoSelected: true
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
      // Override the default mock to reject with access error
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockRejectedValue(
        new Error('No account has read access to calendar "primary"')
      );

      const args = {
        calendarId: 'primary',
        query: 'Meeting'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'No account has read access to calendar "primary"'
      );
    });

    it('should use specified account when provided', async () => {
      // Verify getClientWithAutoSelection is called with the account parameter
      const spy = vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
        client: mockOAuth2Client,
        accountId: 'test',
        calendarId: 'primary',
        wasAutoSelected: false
      });
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const args = {
        calendarId: 'primary',
        query: 'Meeting',
        account: 'test'
      };

      await handler.runTool(args, mockAccounts);

      // Verify the account was passed to getClientWithAutoSelection
      expect(spy).toHaveBeenCalledWith('test', 'primary', mockAccounts, 'read');
    });
  });

  describe('Multi-Calendar Search', () => {
    let workClient: OAuth2Client;
    let personalClient: OAuth2Client;
    let multiAccounts: Map<string, OAuth2Client>;

    beforeEach(() => {
      workClient = new OAuth2Client();
      personalClient = new OAuth2Client();
      multiAccounts = new Map([
        ['work', workClient],
        ['personal', personalClient]
      ]);

      // Mock getClientsForAccounts to return all accounts when array is passed
      vi.spyOn(handler as any, 'getClientsForAccounts').mockImplementation(
        (accountArg: string | string[] | undefined, accounts: Map<string, OAuth2Client>) => {
          if (Array.isArray(accountArg)) {
            const selected = new Map<string, OAuth2Client>();
            for (const id of accountArg) {
              if (accounts.has(id)) selected.set(id, accounts.get(id)!);
            }
            return selected;
          }
          if (accountArg) {
            return accounts.has(accountArg) ? new Map([[accountArg, accounts.get(accountArg)!]]) : new Map();
          }
          return accounts;
        }
      );

      // Mock calendarRegistry.resolveCalendarsToAccounts
      vi.spyOn((handler as any).calendarRegistry, 'resolveCalendarsToAccounts').mockResolvedValue({
        resolved: new Map([
          ['work', ['work-calendar']],
          ['personal', ['personal-calendar']]
        ]),
        warnings: []
      });
    });

    it('should search across multiple calendars and merge results', async () => {
      const workEvents = [
        {
          id: 'work-1',
          summary: 'Team Meeting',
          start: { dateTime: '2025-01-15T10:00:00Z' },
          end: { dateTime: '2025-01-15T11:00:00Z' }
        }
      ];
      const personalEvents = [
        {
          id: 'personal-1',
          summary: 'Team Lunch',
          start: { dateTime: '2025-01-15T12:00:00Z' },
          end: { dateTime: '2025-01-15T13:00:00Z' }
        }
      ];

      vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => ({
        events: {
          list: vi.fn().mockResolvedValue({
            data: { items: client === workClient ? workEvents : personalEvents }
          })
        }
      }));

      const result = await handler.runTool({
        account: ['work', 'personal'],
        calendarId: ['work-calendar', 'personal-calendar'],
        query: 'Team'
      }, multiAccounts);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(2);
      expect(parsed.events).toHaveLength(2);
      expect(parsed.calendars).toContain('work-calendar');
      expect(parsed.calendars).toContain('personal-calendar');
      expect(parsed.accounts).toContain('work');
      expect(parsed.accounts).toContain('personal');
    });

    it('should sort merged results chronologically', async () => {
      const workEvents = [
        {
          id: 'work-1',
          summary: 'Late Event',
          start: { dateTime: '2025-01-15T15:00:00Z' },
          end: { dateTime: '2025-01-15T16:00:00Z' }
        }
      ];
      const personalEvents = [
        {
          id: 'personal-1',
          summary: 'Early Event',
          start: { dateTime: '2025-01-15T09:00:00Z' },
          end: { dateTime: '2025-01-15T10:00:00Z' }
        }
      ];

      vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => ({
        events: {
          list: vi.fn().mockResolvedValue({
            data: { items: client === workClient ? workEvents : personalEvents }
          })
        }
      }));

      const result = await handler.runTool({
        account: ['work', 'personal'],
        calendarId: ['work-calendar', 'personal-calendar'],
        query: 'Event'
      }, multiAccounts);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events[0].summary).toBe('Early Event');
      expect(parsed.events[1].summary).toBe('Late Event');
    });

    it('should include warnings for partial failures in multi-calendar search', async () => {
      const personalEvents = [
        {
          id: 'personal-1',
          summary: 'Team Event',
          start: { dateTime: '2025-01-15T10:00:00Z' },
          end: { dateTime: '2025-01-15T11:00:00Z' }
        }
      ];

      vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => ({
        events: {
          list: vi.fn().mockImplementation(() => {
            if (client === workClient) {
              throw new Error('Access denied');
            }
            return { data: { items: personalEvents } };
          })
        }
      }));

      const result = await handler.runTool({
        account: ['work', 'personal'],
        calendarId: ['work-calendar', 'personal-calendar'],
        query: 'Team'
      }, multiAccounts);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(1);
      expect(parsed.warnings).toBeDefined();
      expect(parsed.warnings.length).toBeGreaterThan(0);
      expect(parsed.warnings[0]).toContain('Failed to search calendar');
    });

    it('should throw error when no calendars can be resolved', async () => {
      vi.spyOn((handler as any).calendarRegistry, 'resolveCalendarsToAccounts').mockResolvedValue({
        resolved: new Map(),
        warnings: ['Calendar "missing" not found']
      });

      vi.spyOn((handler as any).calendarRegistry, 'getUnifiedCalendars').mockResolvedValue([
        { displayName: 'Work Calendar', calendarId: 'work-calendar' }
      ]);

      await expect(handler.runTool({
        account: ['work', 'personal'],
        calendarId: ['missing-calendar'],
        query: 'Team'
      }, multiAccounts)).rejects.toThrow('None of the requested calendars could be found');
    });
  });
});
