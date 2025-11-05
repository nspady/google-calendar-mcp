import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreeBusyEventHandler } from '../../../handlers/core/FreeBusyEventHandler.js';
import { OAuth2Client } from 'google-auth-library';

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
vi.mock('../../../handlers/utils/datetime.js', () => ({
  convertToRFC3339: vi.fn((datetime, timezone) => {
    // Simplified for testing - just append Z
    return `${datetime}Z`;
  })
}));

describe('FreeBusyEventHandler', () => {
  let handler: FreeBusyEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
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

    it('should handle API errors', async () => {
      const apiError = new Error('Bad Request');
      (apiError as any).code = 400;
      mockCalendar.freebusy.query.mockRejectedValue(apiError);

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }]
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Bad Request');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Bad Request');
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
      const spy = vi.spyOn(handler as any, 'getClientForAccount');
      mockCalendar.freebusy.query.mockResolvedValue({ data: { calendars: {} } });

      const args = {
        timeMin: '2025-01-15T00:00:00',
        timeMax: '2025-01-15T23:59:59',
        calendars: [{ id: 'primary' }],
        account: 'test'
      };

      await handler.runTool(args, mockAccounts);

      expect(spy).toHaveBeenCalledWith('test', mockAccounts);
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
