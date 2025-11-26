import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn()
  }
}));

describe('CalendarRegistry', () => {
  let registry: CalendarRegistry;
  let workClient: OAuth2Client;
  let personalClient: OAuth2Client;
  let accounts: Map<string, OAuth2Client>;

  beforeEach(() => {
    registry = new CalendarRegistry();
    workClient = new OAuth2Client('client-id', 'client-secret');
    personalClient = new OAuth2Client('client-id', 'client-secret');

    workClient.setCredentials({ access_token: 'work-token' });
    personalClient.setCredentials({ access_token: 'personal-token' });

    accounts = new Map([
      ['work', workClient],
      ['personal', personalClient]
    ]);

    registry.clearCache();
  });

  describe('getUnifiedCalendars', () => {
    it('should deduplicate calendars across accounts', async () => {
      // Mock calendar list responses
      const mockWorkCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'work@gmail.com',
              summary: 'Work Calendar',
              accessRole: 'owner',
              primary: true
            },
            {
              id: 'shared@group.calendar.google.com',
              summary: 'Shared Calendar',
              accessRole: 'writer'
            }
          ]
        }
      });

      const mockPersonalCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'personal@gmail.com',
              summary: 'Personal Calendar',
              accessRole: 'owner',
              primary: true
            },
            {
              id: 'shared@group.calendar.google.com',
              summary: 'Shared Calendar',
              accessRole: 'reader',
              summaryOverride: 'Team Events'
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation((config: any) => {
        const token = config.auth.credentials.access_token;
        return {
          calendarList: {
            list: token === 'work-token' ? mockWorkCalendar : mockPersonalCalendar
          }
        } as any;
      });

      const unified = await registry.getUnifiedCalendars(accounts);

      expect(unified).toHaveLength(3); // work@gmail.com, personal@gmail.com, shared@group.calendar.google.com

      // Check shared calendar is deduplicated
      const sharedCal = unified.find(c => c.calendarId === 'shared@group.calendar.google.com');
      expect(sharedCal).toBeDefined();
      expect(sharedCal!.accounts).toHaveLength(2);
      expect(sharedCal!.preferredAccount).toBe('work'); // writer > reader
    });

    it('should rank permissions correctly (owner > writer > reader)', async () => {
      const mockWorkCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'cal1@calendar.google.com',
              summary: 'Calendar 1',
              accessRole: 'reader'
            }
          ]
        }
      });

      const mockPersonalCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'cal1@calendar.google.com',
              summary: 'Calendar 1',
              accessRole: 'owner'
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation((config: any) => {
        const token = config.auth.credentials.access_token;
        return {
          calendarList: {
            list: token === 'work-token' ? mockWorkCalendar : mockPersonalCalendar
          }
        } as any;
      });

      const unified = await registry.getUnifiedCalendars(accounts);

      const cal = unified.find(c => c.calendarId === 'cal1@calendar.google.com');
      expect(cal!.preferredAccount).toBe('personal'); // owner > reader
    });

    it('should handle summaryOverride for display name', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'cal@gmail.com',
              summary: 'Original Name',
              summaryOverride: 'My Custom Name',
              accessRole: 'owner',
              primary: true
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      const unified = await registry.getUnifiedCalendars(accounts);

      const cal = unified[0];
      expect(cal.displayName).toBe('My Custom Name');
    });

    it('should cache results for 5 minutes', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: { items: [] }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      // First call
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(2); // Once per account

      // Second call should use cache
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(2); // Still 2, not 4
    });

    it('should handle account failures gracefully', async () => {
      const mockWorkCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            { id: 'work@gmail.com', summary: 'Work', accessRole: 'owner', primary: true }
          ]
        }
      });

      const mockPersonalCalendar = vi.fn().mockRejectedValue(new Error('API Error'));

      vi.mocked(google.calendar).mockImplementation((config: any) => {
        const token = config.auth.credentials.access_token;
        return {
          calendarList: {
            list: token === 'work-token' ? mockWorkCalendar : mockPersonalCalendar
          }
        } as any;
      });

      const unified = await registry.getUnifiedCalendars(accounts);

      // Should only have work calendar
      expect(unified).toHaveLength(1);
      expect(unified[0].calendarId).toBe('work@gmail.com');
    });
  });

  describe('getAccountForCalendar', () => {
    beforeEach(() => {
      const mockWorkCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'shared@group.calendar.google.com',
              summary: 'Shared Calendar',
              accessRole: 'writer'
            }
          ]
        }
      });

      const mockPersonalCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'shared@group.calendar.google.com',
              summary: 'Shared Calendar',
              accessRole: 'reader'
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation((config: any) => {
        const token = config.auth.credentials.access_token;
        return {
          calendarList: {
            list: token === 'work-token' ? mockWorkCalendar : mockPersonalCalendar
          }
        } as any;
      });
    });

    it('should return account with write permission for write operations', async () => {
      const result = await registry.getAccountForCalendar(
        'shared@group.calendar.google.com',
        accounts,
        'write'
      );

      expect(result).toEqual({
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should return null for write operations when no write access', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'readonly@calendar.google.com',
              summary: 'Read-only',
              accessRole: 'reader'
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      registry.clearCache();

      const result = await registry.getAccountForCalendar(
        'readonly@calendar.google.com',
        accounts,
        'write'
      );

      expect(result).toBeNull();
    });

    it('should return preferred account for read operations', async () => {
      const result = await registry.getAccountForCalendar(
        'shared@group.calendar.google.com',
        accounts,
        'read'
      );

      expect(result).toEqual({
        accountId: 'work', // writer > reader
        accessRole: 'writer'
      });
    });

    it('should return null for non-existent calendar', async () => {
      const result = await registry.getAccountForCalendar(
        'nonexistent@calendar.google.com',
        accounts,
        'read'
      );

      expect(result).toBeNull();
    });
  });

  describe('getAccountsForCalendar', () => {
    it('should return all accounts with access to a calendar', async () => {
      const mockWorkCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'shared@calendar.google.com',
              summary: 'Shared',
              accessRole: 'owner'
            }
          ]
        }
      });

      const mockPersonalCalendar = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'shared@calendar.google.com',
              summary: 'Shared',
              accessRole: 'writer'
            }
          ]
        }
      });

      vi.mocked(google.calendar).mockImplementation((config: any) => {
        const token = config.auth.credentials.access_token;
        return {
          calendarList: {
            list: token === 'work-token' ? mockWorkCalendar : mockPersonalCalendar
          }
        } as any;
      });

      const result = await registry.getAccountsForCalendar(
        'shared@calendar.google.com',
        accounts
      );

      expect(result).toHaveLength(2);
      expect(result.map(a => a.accountId).sort()).toEqual(['personal', 'work']);
      expect(result.find(a => a.accountId === 'work')?.accessRole).toBe('owner');
      expect(result.find(a => a.accountId === 'personal')?.accessRole).toBe('writer');
    });

    it('should return empty array for non-existent calendar', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: { items: [] }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      const result = await registry.getAccountsForCalendar(
        'nonexistent@calendar.google.com',
        accounts
      );

      expect(result).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear cache and fetch fresh data', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: { items: [] }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      // First call
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(2);

      // Clear cache
      registry.clearCache();

      // Second call should fetch fresh data
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(4); // 2 + 2
    });
  });
});
