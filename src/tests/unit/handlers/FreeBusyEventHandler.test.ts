import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreeBusyEventHandler } from '../../../handlers/core/FreeBusyEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      freebusy: {
        query: vi.fn()
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

describe('FreeBusyEventHandler', () => {
  let handler: FreeBusyEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

    handler = new FreeBusyEventHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      freebusy: {
        query: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
  });

  describe('Basic FreeBusy Query', () => {
    it('should query freebusy for a single calendar', async () => {
      const mockResponse = {
        calendars: {
          'primary': {
            busy: [
              { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
              { start: '2025-01-15T14:00:00Z', end: '2025-01-15T15:00:00Z' }
            ]
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: {
          timeMin: '2025-01-15T00:00:00Z',
          timeMax: '2025-01-15T23:59:59Z',
          items: [{ id: 'primary' }],
          timeZone: 'America/Los_Angeles'
        }
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.calendars.primary.busy).toHaveLength(2);
      expect(response.timeMin).toBe('2025-01-15T00:00:00');
      expect(response.timeMax).toBe('2025-01-15T23:59:59');
    });

    it('should query freebusy for multiple calendars', async () => {
      const mockResponse = {
        calendars: {
          'calendar1@group.calendar.google.com': {
            busy: [{ start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' }]
          },
          'calendar2@group.calendar.google.com': {
            busy: [{ start: '2025-01-15T14:00:00Z', end: '2025-01-15T15:00:00Z' }]
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [
          { id: 'calendar1@group.calendar.google.com' },
          { id: 'calendar2@group.calendar.google.com' }
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(Object.keys(response.calendars)).toHaveLength(2);
      expect(response.calendars['calendar1@group.calendar.google.com'].busy).toHaveLength(1);
      expect(response.calendars['calendar2@group.calendar.google.com'].busy).toHaveLength(1);
    });

    it('should handle calendars with no busy periods', async () => {
      const mockResponse = {
        calendars: {
          'primary': {
            busy: []
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars.primary.busy).toHaveLength(0);
    });
  });

  describe('Time Range Validation', () => {
    it('should reject time ranges longer than 3 months', async () => {
      const args = {
        timeMin: '2025-01-01T00:00:00',
        timeMax: '2025-05-01T00:00:00', // 4 months
        calendars: [{ id: 'primary' }]
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'The time gap between timeMin and timeMax must be less than 3 months'
      );
    });

    it('should accept time ranges exactly at 3 months', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-01T00:00:00',
        timeMax: '2025-03-31T00:00:00', // ~90 days
        calendars: [{ id: 'primary' }]
      };

      await expect(handler.runTool(args, mockAccounts)).resolves.toBeDefined();
    });

    it('should accept time ranges less than 3 months', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-01T00:00:00',
        timeMax: '2025-01-15T00:00:00', // 2 weeks
        calendars: [{ id: 'primary' }]
      };

      await expect(handler.runTool(args, mockAccounts)).resolves.toBeDefined();
    });
  });

  describe('Timezone Handling', () => {
    it('should use custom timezone when specified', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        timeZone: 'Europe/London'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          timeZone: 'Europe/London'
        })
      });
    });

    it('should use calendar default timezone when not specified', async () => {
      const spy = vi.spyOn(handler as any, 'getCalendarTimezone');
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      await handler.runTool(args, mockAccounts);

      expect(spy).toHaveBeenCalledWith(mockOAuth2Client, 'primary');
      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          timeZone: 'America/Los_Angeles'
        })
      });
    });

    it('should fallback to UTC if calendar timezone fails', async () => {
      vi.spyOn(handler as any, 'getCalendarTimezone').mockRejectedValue(new Error('Failed'));
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          timeZone: 'UTC'
        })
      });
    });
  });

  describe('Expansion Parameters', () => {
    it('should include groupExpansionMax when provided', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        groupExpansionMax: 10
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          groupExpansionMax: 10
        })
      });
    });

    it('should include calendarExpansionMax when provided', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        calendarExpansionMax: 50
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          calendarExpansionMax: 50
        })
      });
    });

    it('should include both expansion parameters', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        groupExpansionMax: 10,
        calendarExpansionMax: 50
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          groupExpansionMax: 10,
          calendarExpansionMax: 50
        })
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle calendar errors in response', async () => {
      const mockResponse = {
        calendars: {
          'invalid@calendar.com': {
            errors: [
              { domain: 'global', reason: 'notFound' }
            ],
            busy: []
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'invalid@calendar.com' }]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars['invalid@calendar.com'].errors).toBeDefined();
      expect(response.calendars['invalid@calendar.com'].errors[0].reason).toBe('notFound');
    });

    it('should handle API errors by returning error in response', async () => {
      // With multi-account support, API errors are caught and logged per-account
      // If all accounts fail, the calendar will show as notFound in the response
      const apiError = new Error('Bad Request');
      (apiError as any).code = 400;
      mockCalendar.freebusy.query.mockRejectedValue(apiError);

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      // The handler now catches errors per-account and returns notFound for calendars
      // that couldn't be queried from any account
      const result = await handler.runTool(args, mockAccounts);
      const response = JSON.parse(result.content[0].text);

      // Calendar should show as notFound since the query failed
      expect(response.calendars['primary'].errors).toBeDefined();
      expect(response.calendars['primary'].errors[0].reason).toBe('notFound');
    });
  });

  describe('Multi-Account Handling', () => {
    it('should use first account when no account specified', async () => {
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      await handler.runTool(args, mockAccounts);

      // Should use first account from mockAccounts
      expect(mockCalendar.freebusy.query).toHaveBeenCalled();
    });

    it('should use specified account when provided', async () => {
      const spy = vi.spyOn(handler as any, 'getClientsForAccounts');
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: { 'primary': { busy: [] } } } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        account: 'test'
      };

      await handler.runTool(args, mockAccounts);

      // The handler now uses getClientsForAccounts which accepts account parameter
      expect(spy).toHaveBeenCalledWith('test', mockAccounts);
    });

    it('should route calendars to correct accounts in multi-account queries', async () => {
      // Setup two accounts
      const workClient = new OAuth2Client();
      const personalClient = new OAuth2Client();
      const multiAccounts = new Map([
        ['work', workClient],
        ['personal', personalClient]
      ]);

      // Setup different calendar responses for each client
      const workCalendar = {
        freebusy: {
          query: vi.fn().mockResolvedValue({
            data: {
              calendars: {
                'work@example.com': {
                  busy: [{ start: '2025-01-15T09:00:00Z', end: '2025-01-15T10:00:00Z' }]
                }
              }
            }
          })
        }
      };

      const personalCalendar = {
        freebusy: {
          query: vi.fn().mockResolvedValue({
            data: {
              calendars: {
                'family@group.calendar.google.com': {
                  busy: [{ start: '2025-01-15T14:00:00Z', end: '2025-01-15T15:00:00Z' }]
                }
              }
            }
          })
        }
      };

      vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => {
        if (client === workClient) return workCalendar;
        return personalCalendar;
      });

      // Mock CalendarRegistry to route calendars to different accounts
      vi.spyOn((handler as any).calendarRegistry, 'resolveCalendarsToAccounts').mockResolvedValue({
        resolved: new Map([
          ['work', ['work@example.com']],
          ['personal', ['family@group.calendar.google.com']]
        ]),
        warnings: []
      });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [
          { id: 'work@example.com' },
          { id: 'family@group.calendar.google.com' }
        ],
        account: ['work', 'personal']
      };

      const result = await handler.runTool(args, multiAccounts);
      const response = JSON.parse(result.content[0].text);

      // Work calendar should only be queried for work@example.com
      expect(workCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          items: [{ id: 'work@example.com' }]
        })
      });

      // Personal calendar should only be queried for family calendar
      expect(personalCalendar.freebusy.query).toHaveBeenCalledWith({
        requestBody: expect.objectContaining({
          items: [{ id: 'family@group.calendar.google.com' }]
        })
      });

      // Both calendars should have results
      expect(response.calendars['work@example.com'].busy).toHaveLength(1);
      expect(response.calendars['family@group.calendar.google.com'].busy).toHaveLength(1);
    });
  });

  describe('Response Formatting', () => {
    it('should format response with all required fields', async () => {
      const mockResponse = {
        calendars: {
          'primary': {
            busy: [
              { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' }
            ]
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty('timeMin');
      expect(response).toHaveProperty('timeMax');
      expect(response).toHaveProperty('calendars');
      expect(response.calendars.primary).toHaveProperty('busy');
    });

    it('should format busy periods correctly', async () => {
      const mockResponse = {
        calendars: {
          'primary': {
            busy: [
              { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
              { start: '2025-01-15T14:00:00Z', end: '2025-01-15T15:00:00Z' }
            ]
          }
        }
      };

      mockCalendar.freebusy.query.mockResolvedValue({ data: mockResponse });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      const busyPeriods = response.calendars.primary.busy;
      expect(busyPeriods[0]).toHaveProperty('start');
      expect(busyPeriods[0]).toHaveProperty('end');
      expect(busyPeriods[0].start).toBe('2025-01-15T10:00:00Z');
      expect(busyPeriods[0].end).toBe('2025-01-15T11:00:00Z');
    });
  });
});
