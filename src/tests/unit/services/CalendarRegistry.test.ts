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
    // Reset singleton instance to ensure clean state for each test
    CalendarRegistry.resetInstance();
    registry = CalendarRegistry.getInstance();

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

  describe('singleton behavior', () => {
    it('should return the same instance from multiple getInstance() calls', () => {
      const instance1 = CalendarRegistry.getInstance();
      const instance2 = CalendarRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should return a new instance after resetInstance()', () => {
      const instance1 = CalendarRegistry.getInstance();
      CalendarRegistry.resetInstance();
      const instance2 = CalendarRegistry.getInstance();
      expect(instance1).not.toBe(instance2);
    });
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

  describe('resolveCalendarNameToId', () => {
    beforeEach(() => {
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
              id: 'team@group.calendar.google.com',
              summary: 'Team Events',
              summaryOverride: 'My Team',
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
              id: 'team@group.calendar.google.com',
              summary: 'Team Events',
              summaryOverride: 'Shared Team',
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

    it('should resolve calendar by exact summaryOverride match', async () => {
      const result = await registry.resolveCalendarNameToId('My Team', accounts, 'read');

      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should resolve calendar by case-insensitive summaryOverride match', async () => {
      const result = await registry.resolveCalendarNameToId('my team', accounts, 'read');

      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should resolve calendar by exact summary match', async () => {
      const result = await registry.resolveCalendarNameToId('Team Events', accounts, 'read');

      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should resolve calendar by case-insensitive summary match', async () => {
      const result = await registry.resolveCalendarNameToId('team events', accounts, 'read');

      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should return calendar ID directly when input looks like an ID', async () => {
      const result = await registry.resolveCalendarNameToId('team@group.calendar.google.com', accounts, 'read');

      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should return null for write operations on read-only calendar', async () => {
      // The team calendar has writer access from 'work', but let's test a different scenario
      const result = await registry.resolveCalendarNameToId('Shared Team', accounts, 'write');

      // 'Shared Team' is personal's summaryOverride with reader access
      // work has 'My Team' as override with writer access
      // The preferred account is 'work' (writer > reader), so this should return work's access
      expect(result).toEqual({
        calendarId: 'team@group.calendar.google.com',
        accountId: 'work',
        accessRole: 'writer'
      });
    });

    it('should return null for non-existent calendar name', async () => {
      const result = await registry.resolveCalendarNameToId('Non Existent Calendar', accounts, 'read');

      expect(result).toBeNull();
    });

    it('should handle "primary" as special calendar ID', async () => {
      // "primary" is a special alias - with multiple accounts, falls back to first account
      const result = await registry.resolveCalendarNameToId('primary', accounts, 'read');

      // With multiple accounts and no registry match, returns first account with 'primary' alias
      expect(result).toEqual({
        calendarId: 'primary',
        accountId: 'work', // First account in the Map
        accessRole: 'owner'
      });
    });

    it('should handle "primary" with single account directly', async () => {
      // With only one account, should use it directly without registry lookup
      const singleAccount = new Map([['solo', workClient]]);

      const result = await registry.resolveCalendarNameToId('primary', singleAccount, 'read');

      expect(result).toEqual({
        calendarId: 'primary',
        accountId: 'solo',
        accessRole: 'owner'
      });
    });
  });

  describe('resolveCalendarsToAccounts', () => {
    beforeEach(() => {
      // Setup calendars where:
      // - "Family" only exists on personal account
      // - "Work Calendar" only exists on work account
      // - "team@group.calendar.google.com" is shared but work has higher permission
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
              id: 'team@group.calendar.google.com',
              summary: 'Team Events',
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
              summary: 'Personal',
              accessRole: 'owner',
              primary: true
            },
            {
              id: 'family@group.calendar.google.com',
              summary: 'Family',
              accessRole: 'owner'
            },
            {
              id: 'team@group.calendar.google.com',
              summary: 'Team Events',
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

    it('should route calendars to correct accounts based on ownership', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Family', 'Work Calendar'],
        accounts
      );

      // Family should be routed to personal, Work Calendar to work
      expect(resolved.size).toBe(2);
      expect(resolved.get('personal')).toEqual(['family@group.calendar.google.com']);
      expect(resolved.get('work')).toEqual(['work@gmail.com']);
      expect(warnings).toHaveLength(0);
    });

    it('should route shared calendar to account with highest permission', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Team Events'],
        accounts
      );

      // Team Events should go to work (writer > reader)
      expect(resolved.size).toBe(1);
      expect(resolved.get('work')).toEqual(['team@group.calendar.google.com']);
      expect(warnings).toHaveLength(0);
    });

    it('should include warnings for calendars not found', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Family', 'NonExistent'],
        accounts
      );

      expect(resolved.get('personal')).toEqual(['family@group.calendar.google.com']);
      expect(warnings).toContain('Calendar "NonExistent" not found on any account');
    });

    it('should handle calendar IDs directly', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['family@group.calendar.google.com', 'work@gmail.com'],
        accounts
      );

      expect(resolved.get('personal')).toEqual(['family@group.calendar.google.com']);
      expect(resolved.get('work')).toEqual(['work@gmail.com']);
      expect(warnings).toHaveLength(0);
    });

    it('should group multiple calendars per account', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Family', 'Personal'],  // Both on personal account
        accounts
      );

      expect(resolved.size).toBe(1);
      const personalCalendars = resolved.get('personal');
      expect(personalCalendars).toHaveLength(2);
      expect(personalCalendars).toContain('family@group.calendar.google.com');
      expect(personalCalendars).toContain('personal@gmail.com');
      expect(warnings).toHaveLength(0);
    });

    it('should respect restrictToAccounts option', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Family', 'Work Calendar'],
        accounts,
        { restrictToAccounts: ['work'] }
      );

      // Family only exists on personal, so it won't be found when restricted to work
      expect(resolved.size).toBe(1);
      expect(resolved.get('work')).toEqual(['work@gmail.com']);
      expect(warnings).toContain('Calendar "Family" not found on any account');
    });

    it('should return empty map when no calendars found', async () => {
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['NonExistent1', 'NonExistent2'],
        accounts
      );

      expect(resolved.size).toBe(0);
      expect(warnings).toHaveLength(2);
    });

    it('should not duplicate calendar IDs in the same account', async () => {
      // Request the same calendar twice
      const { resolved, warnings } = await registry.resolveCalendarsToAccounts(
        ['Family', 'family@group.calendar.google.com'],  // Same calendar, different references
        accounts
      );

      expect(resolved.get('personal')).toHaveLength(1);
      expect(resolved.get('personal')).toEqual(['family@group.calendar.google.com']);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('concurrent access', () => {
    it('should prevent duplicate API calls during concurrent requests', async () => {
      const mockCalendar = vi.fn().mockImplementation(() =>
        new Promise(resolve => {
          // Simulate API latency
          setTimeout(() => resolve({ data: { items: [] } }), 50);
        })
      );

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      // Make concurrent requests
      const [result1, result2, result3] = await Promise.all([
        registry.getUnifiedCalendars(accounts),
        registry.getUnifiedCalendars(accounts),
        registry.getUnifiedCalendars(accounts)
      ]);

      // All should return the same result
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      // API should only be called once per account (2 total), not 6 times
      expect(mockCalendar).toHaveBeenCalledTimes(2);
    });

    it('should allow new API calls after in-flight request completes', async () => {
      const mockCalendar = vi.fn().mockResolvedValue({
        data: { items: [] }
      });

      vi.mocked(google.calendar).mockImplementation(() => ({
        calendarList: { list: mockCalendar }
      } as any));

      // First request
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(2);

      // Clear cache to force new API call
      registry.clearCache();

      // Second request should make new API calls
      await registry.getUnifiedCalendars(accounts);
      expect(mockCalendar).toHaveBeenCalledTimes(4);
    });
  });
});
