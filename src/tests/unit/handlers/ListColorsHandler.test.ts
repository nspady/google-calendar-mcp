import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListColorsHandler } from '../../../handlers/core/ListColorsHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      colors: {
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

describe('ListColorsHandler', () => {
  let handler: ListColorsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockOAuth2Client2: OAuth2Client;
  let mockSingleAccount: Map<string, OAuth2Client>;
  let mockMultipleAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new ListColorsHandler();
    mockOAuth2Client = new OAuth2Client();
    mockOAuth2Client2 = new OAuth2Client();
    // Single account for most tests (auto-selects)
    mockSingleAccount = new Map([['test1', mockOAuth2Client]]);
    // Multiple accounts for multi-account specific tests
    mockMultipleAccounts = new Map([
      ['test1', mockOAuth2Client],
      ['test2', mockOAuth2Client2]
    ]);

    // Setup mock calendar
    mockCalendar = {
      colors: {
        get: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
  });

  describe('Basic Color Listing', () => {
    it('should list event and calendar colors', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
          '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
          '3': { background: '#dbadff', foreground: '#1d1d1d' }
        },
        calendar: {
          '1': { background: '#ac725e', foreground: '#f7f7f7' },
          '2': { background: '#d06b64', foreground: '#f7f7f7' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      expect(mockCalendar.colors.get).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);

      expect(response.event).toBeDefined();
      expect(response.calendar).toBeDefined();

      expect(Object.keys(response.event)).toHaveLength(3);
      expect(Object.keys(response.calendar)).toHaveLength(2);

      expect(response.event['1']).toEqual({
        background: '#a4bdfc',
        foreground: '#1d1d1d'
      });

      expect(response.calendar['1']).toEqual({
        background: '#ac725e',
        foreground: '#f7f7f7'
      });
    });

    it('should list only event colors when calendar colors are not present', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
          '2': { background: '#7ae7bf', foreground: '#1d1d1d' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(Object.keys(response.event)).toHaveLength(2);
      expect(response.calendar).toEqual({});
    });

    it('should list only calendar colors when event colors are not present', async () => {
      const mockColors = {
        calendar: {
          '1': { background: '#ac725e', foreground: '#f7f7f7' },
          '2': { background: '#d06b64', foreground: '#f7f7f7' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendar).toBeDefined();
      expect(Object.keys(response.calendar)).toHaveLength(2);
      expect(response.event).toEqual({});
    });

    it('should handle empty color response', async () => {
      const mockColors = {
        event: {},
        calendar: {}
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toEqual({});
      expect(response.calendar).toEqual({});
    });

    it('should handle colors with missing foreground/background', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc' }, // Missing foreground
          '2': { foreground: '#1d1d1d' }  // Missing background
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.event['1']).toEqual({
        background: '#a4bdfc',
        foreground: ''
      });
      expect(response.event['2']).toEqual({
        background: '',
        foreground: '#1d1d1d'
      });
    });
  });

  describe('Account Selection', () => {
    it('should auto-select when only one account exists', async () => {
      const mockColors = {
        event: { '1': { background: '#a4bdfc', foreground: '#1d1d1d' } }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      expect(mockCalendar.colors.get).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.event['1']).toBeDefined();
    });

    it('should use first available account when multiple accounts exist without specifying one', async () => {
      // Colors API returns same data for all accounts, so any account works
      const mockColors = {
        event: { '1': { background: '#a4bdfc', foreground: '#1d1d1d' } }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockMultipleAccounts);
      expect(result.content).toBeDefined();
    });

    it('should use specified account when provided', async () => {
      const spy = vi.spyOn(handler as any, 'getClientForAccountOrFirst');
      const mockColors = {
        event: { '1': { background: '#a4bdfc', foreground: '#1d1d1d' } }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      await handler.runTool({ account: 'test2' }, mockMultipleAccounts);

      expect(spy).toHaveBeenCalledWith('test2', mockMultipleAccounts);
    });
  });

  describe('Color Format Verification', () => {
    it('should return colors with correct structure', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
          '5': { background: '#fbd75b', foreground: '#1d1d1d' },
          '11': { background: '#dc2127', foreground: '#f7f7f7' }
        },
        calendar: {
          '1': { background: '#ac725e', foreground: '#f7f7f7' },
          '10': { background: '#92e1c0', foreground: '#1d1d1d' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);

      // Verify all event colors are present
      expect(response.event['1']).toBeDefined();
      expect(response.event['5']).toBeDefined();
      expect(response.event['11']).toBeDefined();

      // Verify all calendar colors are present
      expect(response.calendar['1']).toBeDefined();
      expect(response.calendar['10']).toBeDefined();

      // Verify structure
      Object.values(response.event).forEach((color: any) => {
        expect(color).toHaveProperty('background');
        expect(color).toHaveProperty('foreground');
      });

      Object.values(response.calendar).forEach((color: any) => {
        expect(color).toHaveProperty('background');
        expect(color).toHaveProperty('foreground');
      });
    });

    it('should preserve color IDs as strings', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
          '10': { background: '#b3dc6c', foreground: '#1d1d1d' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toHaveProperty('1');
      expect(response.event).toHaveProperty('10');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('API Error');
      (apiError as any).code = 500;
      mockCalendar.colors.get.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Failed to retrieve colors');
      });

      await expect(handler.runTool({}, mockSingleAccount)).rejects.toThrow('Failed to retrieve colors');
    });

    it('should handle null response data', async () => {
      mockCalendar.colors.get.mockResolvedValue({ data: null });

      await expect(handler.runTool({}, mockSingleAccount)).rejects.toThrow('Failed to retrieve colors');
    });

    it('should handle permission denied error', async () => {
      const apiError = new Error('Forbidden');
      (apiError as any).code = 403;
      mockCalendar.colors.get.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(handler.runTool({}, mockSingleAccount)).rejects.toThrow('Permission denied');
    });

    it('should handle network errors', async () => {
      const apiError = new Error('Network error');
      mockCalendar.colors.get.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Network error');
      });

      await expect(handler.runTool({}, mockSingleAccount)).rejects.toThrow('Network error');
    });
  });

  describe('Response Structure', () => {
    it('should return structured response with event and calendar keys', async () => {
      const mockColors = {
        event: {
          '1': { background: '#a4bdfc', foreground: '#1d1d1d' }
        },
        calendar: {
          '1': { background: '#ac725e', foreground: '#f7f7f7' }
        }
      };

      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });

      const result = await handler.runTool({}, mockSingleAccount);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty('event');
      expect(response).toHaveProperty('calendar');
      expect(typeof response.event).toBe('object');
      expect(typeof response.calendar).toBe('object');
    });
  });


  describe('Event Labels', () => {
    const mockColors = {
      event: { '1': { background: '#a4bdfc', foreground: '#1d1d1d' } },
      calendar: { '1': { background: '#ac725e', foreground: '#f7f7f7' } }
    };

    beforeEach(() => {
      mockCalendar.calendars = { get: vi.fn() };
      mockCalendar.colors.get.mockResolvedValue({ data: mockColors });
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
        client: mockOAuth2Client,
        accountId: 'test1',
        calendarId: 'primary',
        wasAutoSelected: true
      });
    });

    it('should not fetch labels when calendarId is omitted', async () => {
      const result = await handler.runTool({}, mockSingleAccount);

      expect(mockCalendar.calendars.get).not.toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response).not.toHaveProperty('eventLabels');
      expect(response).not.toHaveProperty('calendarId');
    });

    it('should return the calendar labels when calendarId is provided', async () => {
      mockCalendar.calendars.get.mockResolvedValue({
        data: {
          labelProperties: {
            eventLabels: [
              { id: '22222222-3333-4444-5555-666666666666', name: 'Design Work', backgroundColor: '#8e24aa' },
              { id: '42617328-8756-4291-8273-192837465647', backgroundColor: '#039be5' }
            ]
          }
        }
      });

      const result = await handler.runTool({ calendarId: 'primary' }, mockSingleAccount);

      expect(mockCalendar.calendars.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        fields: 'labelProperties'
      });
      const response = JSON.parse(result.content[0].text);
      expect(response.calendarId).toBe('primary');
      expect(response.eventLabels).toEqual([
        { id: '22222222-3333-4444-5555-666666666666', name: 'Design Work', backgroundColor: '#8e24aa' },
        { id: '42617328-8756-4291-8273-192837465647', backgroundColor: '#039be5' }
      ]);
      // Legacy colors are still returned alongside labels
      expect(response.event['1']).toBeDefined();
      expect(response.calendar['1']).toBeDefined();
    });

    it('should return an empty list for a calendar without labels', async () => {
      mockCalendar.calendars.get.mockResolvedValue({ data: {} });

      const result = await handler.runTool({ calendarId: 'primary' }, mockSingleAccount);

      const response = JSON.parse(result.content[0].text);
      expect(response.eventLabels).toEqual([]);
    });

    it('should resolve the calendar and account for label reads', async () => {
      const spy = vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
        client: mockOAuth2Client2,
        accountId: 'test2',
        calendarId: 'team@example.com',
        wasAutoSelected: true
      });
      mockCalendar.calendars.get.mockResolvedValue({ data: { labelProperties: { eventLabels: [] } } });

      const result = await handler.runTool({ calendarId: 'Team' }, mockMultipleAccounts);

      expect(spy).toHaveBeenCalledWith(undefined, 'Team', mockMultipleAccounts, 'read');
      expect(mockCalendar.calendars.get).toHaveBeenCalledWith({
        calendarId: 'team@example.com',
        fields: 'labelProperties'
      });
      expect(JSON.parse(result.content[0].text).calendarId).toBe('team@example.com');
    });

    it('should surface label read errors', async () => {
      mockCalendar.calendars.get.mockRejectedValue(Object.assign(new Error('Forbidden'), { code: 403 }));
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(handler.runTool({ calendarId: 'primary' }, mockSingleAccount)).rejects.toThrow('Permission denied');
    });
  });
});
