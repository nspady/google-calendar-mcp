import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListCalendarsHandler } from '../../../handlers/core/ListCalendarsHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      calendarList: {
        list: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

describe('ListCalendarsHandler', () => {
  let handler: ListCalendarsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockOAuth2Client2: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new ListCalendarsHandler();
    mockOAuth2Client = new OAuth2Client();
    mockOAuth2Client2 = new OAuth2Client();
    mockAccounts = new Map([
      ['test1', mockOAuth2Client],
      ['test2', mockOAuth2Client2]
    ]);

    // Setup mock calendar
    mockCalendar = {
      calendarList: {
        list: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
  });

  describe('Single Account Calendar Listing', () => {
    it('should list calendars from single account', async () => {
      const mockCalendars = [
        {
          id: 'primary',
          summary: 'Work Calendar',
          description: 'Work events',
          timeZone: 'America/Los_Angeles',
          backgroundColor: '#0D7377',
          foregroundColor: '#FFFFFF',
          accessRole: 'owner',
          primary: true,
          selected: true,
          hidden: false
        },
        {
          id: 'calendar2@group.calendar.google.com',
          summary: 'Personal',
          timeZone: 'America/New_York',
          backgroundColor: '#D50000',
          accessRole: 'reader',
          primary: false,
          selected: true,
          hidden: false
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const args = {
        account: 'test1'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.calendarList.list).toHaveBeenCalled();
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.calendars).toHaveLength(2);
      expect(response.totalCount).toBe(2);
      expect(response.calendars[0]).toMatchObject({
        id: 'primary',
        summary: 'Work Calendar',
        description: 'Work events',
        timeZone: 'America/Los_Angeles',
        backgroundColor: '#0D7377',
        foregroundColor: '#FFFFFF',
        accessRole: 'owner',
        primary: true,
        selected: true,
        hidden: false
      });
    });

    it('should list calendars with default reminders', async () => {
      const mockCalendars = [
        {
          id: 'primary',
          summary: 'Calendar with Reminders',
          timeZone: 'UTC',
          defaultReminders: [
            { method: 'popup', minutes: 15 },
            { method: 'email', minutes: 60 }
          ]
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars[0].defaultReminders).toHaveLength(2);
      expect(response.calendars[0].defaultReminders[0]).toEqual({ method: 'popup', minutes: 15 });
      expect(response.calendars[0].defaultReminders[1]).toEqual({ method: 'email', minutes: 60 });
    });

    it('should list calendars with notification settings', async () => {
      const mockCalendars = [
        {
          id: 'primary',
          summary: 'Calendar with Notifications',
          timeZone: 'UTC',
          notificationSettings: {
            notifications: [
              { type: 'eventCreation', method: 'email' },
              { type: 'eventChange', method: 'email' }
            ]
          }
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars[0].notificationSettings).toBeDefined();
      expect(response.calendars[0].notificationSettings.notifications).toHaveLength(2);
      expect(response.calendars[0].notificationSettings.notifications[0]).toEqual({
        type: 'eventCreation',
        method: 'email'
      });
    });

    it('should list calendars with conference properties', async () => {
      const mockCalendars = [
        {
          id: 'primary',
          summary: 'Calendar with Conference',
          timeZone: 'UTC',
          conferenceProperties: {
            allowedConferenceSolutionTypes: ['hangoutsMeet', 'eventNamedHangout']
          }
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars[0].conferenceProperties).toBeDefined();
      expect(response.calendars[0].conferenceProperties.allowedConferenceSolutionTypes).toEqual([
        'hangoutsMeet',
        'eventNamedHangout'
      ]);
    });

    it('should handle empty calendar list', async () => {
      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars).toHaveLength(0);
      expect(response.totalCount).toBe(0);
    });

    it('should handle calendars with minimal fields', async () => {
      const mockCalendars = [
        {
          id: 'minimal@calendar.com',
          summary: 'Minimal Calendar'
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars[0]).toMatchObject({
        id: 'minimal@calendar.com',
        summary: 'Minimal Calendar'
      });
      // Other fields should be undefined
      expect(response.calendars[0].description).toBeUndefined();
      expect(response.calendars[0].location).toBeUndefined();
    });
  });

  describe('Multi-Account Calendar Listing', () => {
    it('should list calendars from multiple accounts with deduplication', async () => {
      const mockCalendarsAccount1 = [
        {
          id: 'shared@group.calendar.google.com',
          summary: 'Shared Calendar',
          timeZone: 'America/Los_Angeles',
          accessRole: 'owner',
          primary: false
        },
        {
          id: 'account1only@calendar.com',
          summary: 'Account 1 Only',
          accessRole: 'owner'
        }
      ];

      const mockCalendarsAccount2 = [
        {
          id: 'shared@group.calendar.google.com',
          summary: 'Shared Calendar',
          timeZone: 'America/Los_Angeles',
          accessRole: 'reader',
          primary: false
        },
        {
          id: 'account2only@calendar.com',
          summary: 'Account 2 Only',
          accessRole: 'owner'
        }
      ];

      // Mock listCalendars to return different calendars per account
      let callCount = 0;
      mockCalendar.calendarList.list.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ data: { items: mockCalendarsAccount1 } });
        } else {
          return Promise.resolve({ data: { items: mockCalendarsAccount2 } });
        }
      });

      // Mock CalendarRegistry
      const mockUnifiedCalendars = [
        {
          calendarId: 'shared@group.calendar.google.com',
          preferredAccount: 'test1',
          accounts: [
            { accountId: 'test1', accessRole: 'owner', primary: false },
            { accountId: 'test2', accessRole: 'reader', primary: false }
          ]
        },
        {
          calendarId: 'account1only@calendar.com',
          preferredAccount: 'test1',
          accounts: [
            { accountId: 'test1', accessRole: 'owner', primary: false }
          ]
        },
        {
          calendarId: 'account2only@calendar.com',
          preferredAccount: 'test2',
          accounts: [
            { accountId: 'test2', accessRole: 'owner', primary: false }
          ]
        }
      ];

      vi.spyOn(handler['calendarRegistry'], 'getUnifiedCalendars').mockResolvedValue(mockUnifiedCalendars);

      const args = {}; // No account specified - should use all accounts

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.calendars).toHaveLength(3);
      expect(response.totalCount).toBe(3);
      expect(response.note).toContain('2 account(s)');

      // Check that shared calendar has accountAccess information
      const sharedCalendar = response.calendars.find((c: any) => c.id === 'shared@group.calendar.google.com');
      expect(sharedCalendar.accountAccess).toHaveLength(2);
      expect(sharedCalendar.accountAccess[0]).toMatchObject({
        accountId: 'test1',
        accessRole: 'owner'
      });
      expect(sharedCalendar.accountAccess[1]).toMatchObject({
        accountId: 'test2',
        accessRole: 'reader'
      });
    });

    it('should use preferred account data in multi-account scenarios', async () => {
      const mockCalendarsAccount1 = [
        {
          id: 'shared@calendar.com',
          summary: 'Shared - Account 1 View',
          description: 'Account 1 description',
          timeZone: 'America/Los_Angeles',
          accessRole: 'writer'
        }
      ];

      const mockCalendarsAccount2 = [
        {
          id: 'shared@calendar.com',
          summary: 'Shared - Account 2 View',
          description: 'Account 2 description',
          timeZone: 'America/New_York',
          accessRole: 'reader'
        }
      ];

      let callCount = 0;
      mockCalendar.calendarList.list.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          data: { items: callCount === 1 ? mockCalendarsAccount1 : mockCalendarsAccount2 }
        });
      });

      const mockUnifiedCalendars = [
        {
          calendarId: 'shared@calendar.com',
          preferredAccount: 'test2', // Prefer account 2
          accounts: [
            { accountId: 'test1', accessRole: 'writer', primary: false },
            { accountId: 'test2', accessRole: 'reader', primary: false }
          ]
        }
      ];

      vi.spyOn(handler['calendarRegistry'], 'getUnifiedCalendars').mockResolvedValue(mockUnifiedCalendars);

      const result = await handler.runTool({}, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      // Should use account2's data since it's preferred
      expect(response.calendars[0].summary).toBe('Shared - Account 2 View');
      expect(response.calendars[0].description).toBe('Account 2 description');
      expect(response.calendars[0].timeZone).toBe('America/New_York');
    });
  });

  describe('Account Selection', () => {
    it('should use first account when no account specified and only one account exists', async () => {
      const singleAccountMap = new Map([['test1', mockOAuth2Client]]);

      mockCalendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'primary', summary: 'Calendar' }] }
      });

      const result = await handler.runTool({}, singleAccountMap);

      expect(mockCalendar.calendarList.list).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.calendars).toHaveLength(1);
      // Should not have note about multiple accounts
      expect(response.note).toBeUndefined();
    });

    it('should use all accounts when no account specified and multiple accounts exist', async () => {
      mockCalendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'cal1', summary: 'Calendar 1' }] }
      });

      const mockUnifiedCalendars = [
        {
          calendarId: 'cal1',
          preferredAccount: 'test1',
          accounts: [{ accountId: 'test1', accessRole: 'owner', primary: false }]
        }
      ];

      vi.spyOn(handler['calendarRegistry'], 'getUnifiedCalendars').mockResolvedValue(mockUnifiedCalendars);

      const result = await handler.runTool({}, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.note).toContain('2 account(s)');
    });

    it('should use specified account when provided', async () => {
      const spy = vi.spyOn(handler as any, 'getClientsForAccounts');
      mockCalendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'primary', summary: 'Calendar' }] }
      });

      await handler.runTool({ account: 'test2' }, mockAccounts);

      expect(spy).toHaveBeenCalledWith('test2', mockAccounts);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('Bad Request');
      (apiError as any).code = 400;
      mockCalendar.calendarList.list.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Bad Request');
      });

      await expect(handler.runTool({ account: 'test1' }, mockAccounts)).rejects.toThrow('Bad Request');
    });

    it('should handle permission denied error', async () => {
      const apiError = new Error('Forbidden');
      (apiError as any).code = 403;
      mockCalendar.calendarList.list.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(handler.runTool({ account: 'test1' }, mockAccounts)).rejects.toThrow('Permission denied');
    });

    it('should handle network errors', async () => {
      const apiError = new Error('Network error');
      mockCalendar.calendarList.list.mockRejectedValue(apiError);

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Network error');
      });

      await expect(handler.runTool({ account: 'test1' }, mockAccounts)).rejects.toThrow('Network error');
    });
  });

  describe('Field Mapping', () => {
    it('should correctly map all calendar fields', async () => {
      const mockCalendars = [
        {
          id: 'full@calendar.com',
          summary: 'Full Calendar',
          description: 'A calendar with all fields',
          location: 'Building A',
          timeZone: 'Europe/London',
          summaryOverride: 'Override Summary',
          colorId: '1',
          backgroundColor: '#9FC6E7',
          foregroundColor: '#000000',
          hidden: false,
          selected: true,
          accessRole: 'owner',
          primary: true,
          deleted: false,
          defaultReminders: [{ method: 'popup', minutes: 10 }],
          notificationSettings: {
            notifications: [{ type: 'eventCreation', method: 'email' }]
          },
          conferenceProperties: {
            allowedConferenceSolutionTypes: ['hangoutsMeet']
          }
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      const calendar = response.calendars[0];

      expect(calendar).toMatchObject({
        id: 'full@calendar.com',
        summary: 'Full Calendar',
        description: 'A calendar with all fields',
        location: 'Building A',
        timeZone: 'Europe/London',
        summaryOverride: 'Override Summary',
        colorId: '1',
        backgroundColor: '#9FC6E7',
        foregroundColor: '#000000',
        hidden: false,
        selected: true,
        accessRole: 'owner',
        primary: true,
        deleted: false
      });

      expect(calendar.defaultReminders).toEqual([{ method: 'popup', minutes: 10 }]);
      expect(calendar.notificationSettings.notifications).toEqual([
        { type: 'eventCreation', method: 'email' }
      ]);
      expect(calendar.conferenceProperties.allowedConferenceSolutionTypes).toEqual(['hangoutsMeet']);
    });

    it('should handle null/undefined fields gracefully', async () => {
      const mockCalendars = [
        {
          id: 'sparse@calendar.com',
          summary: null,
          description: undefined,
          timeZone: 'UTC',
          backgroundColor: null,
          defaultReminders: null
        }
      ];

      mockCalendar.calendarList.list.mockResolvedValue({ data: { items: mockCalendars } });

      const result = await handler.runTool({ account: 'test1' }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      const calendar = response.calendars[0];

      expect(calendar.id).toBe('sparse@calendar.com');
      expect(calendar.timeZone).toBe('UTC');
      expect(calendar.summary).toBeUndefined();
      expect(calendar.description).toBeUndefined();
      expect(calendar.backgroundColor).toBeUndefined();
    });
  });
});
