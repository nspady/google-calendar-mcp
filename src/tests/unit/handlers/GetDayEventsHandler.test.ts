import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetDayEventsHandler } from '../../../handlers/core/GetDayEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry, UnifiedCalendar } from '../../../services/CalendarRegistry.js';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: vi.fn()
      },
      calendarList: {
        list: vi.fn(),
        get: vi.fn()
      },
      colors: {
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock datetime utilities
vi.mock('../../../utils/datetime.js', () => ({
  hasTimezoneInDatetime: vi.fn((datetime: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)
  ),
  convertToRFC3339: vi.fn((datetime: string, _timezone: string) => {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)) {
      return datetime;
    }
    return `${datetime}Z`;
  })
}));

describe('GetDayEventsHandler', () => {
  let handler: GetDayEventsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockOAuth2Client2: OAuth2Client;
  let mockCalendar: any;
  let mockCalendar2: any;

  beforeEach(() => {
    vi.clearAllMocks();
    CalendarRegistry.resetInstance();

    handler = new GetDayEventsHandler();
    mockOAuth2Client = new OAuth2Client();
    mockOAuth2Client2 = new OAuth2Client();

    // Setup mock calendar for first account
    mockCalendar = {
      events: { list: vi.fn() },
      calendarList: { list: vi.fn(), get: vi.fn() },
      colors: {
        get: vi.fn().mockResolvedValue({ data: { event: {}, calendar: {} } })
      }
    };

    // Setup mock calendar for second account
    mockCalendar2 = {
      events: { list: vi.fn() },
      calendarList: { list: vi.fn(), get: vi.fn() },
      colors: {
        get: vi.fn().mockResolvedValue({ data: { event: {}, calendar: {} } })
      }
    };

    // Mock getCalendar to return appropriate mock based on the client
    vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => {
      if (client === mockOAuth2Client2) return mockCalendar2;
      return mockCalendar;
    });

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');

    // Mock getCalendarColors
    vi.spyOn(handler as any, 'getCalendarColors').mockResolvedValue({ colors: {}, names: {}, eventPalette: {} });
  });

  function setupUnifiedCalendars(calendars: UnifiedCalendar[]): void {
    const registry = CalendarRegistry.getInstance();
    vi.spyOn(registry, 'getUnifiedCalendars').mockResolvedValue(calendars);
  }

  function parseResponse(result: any): any {
    const text = (result.content[0] as any).text;
    return JSON.parse(text);
  }

  describe('Single account', () => {
    it('should return dayContext with events from a single account', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'event-1',
              summary: 'Meeting',
              start: { dateTime: '2026-02-05T10:00:00' },
              end: { dateTime: '2026-02-05T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=1'
            }
          ]
        }
      });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.date).toBe('2026-02-05');
      expect(response.dayContext.timezone).toBe('America/Los_Angeles');
      expect(response.dayContext.events).toHaveLength(1);
      expect(response.dayContext.events[0].summary).toBe('Meeting');
    });
  });

  describe('Multiple accounts', () => {
    it('should return dayContext with events from multiple calendars across accounts', async () => {
      const accounts = new Map([
        ['work', mockOAuth2Client],
        ['personal', mockOAuth2Client2]
      ]);

      setupUnifiedCalendars([
        {
          calendarId: 'work@gmail.com',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        },
        {
          calendarId: 'personal@gmail.com',
          accounts: [{ accountId: 'personal', accessRole: 'owner', primary: true, summary: 'Personal' }],
          preferredAccount: 'personal',
          displayName: 'Personal'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'work-event',
              summary: 'Work Meeting',
              start: { dateTime: '2026-02-05T10:00:00' },
              end: { dateTime: '2026-02-05T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=work'
            }
          ]
        }
      });

      mockCalendar2.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'personal-event',
              summary: 'Lunch',
              start: { dateTime: '2026-02-05T12:00:00' },
              end: { dateTime: '2026-02-05T13:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=personal'
            }
          ]
        }
      });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.events).toHaveLength(2);

      const summaries = response.dayContext.events.map((e: any) => e.summary);
      expect(summaries).toContain('Work Meeting');
      expect(summaries).toContain('Lunch');

      // Events should be sorted by start time
      const starts = response.dayContext.events.map((e: any) => e.start);
      expect(starts[0]).toBe('2026-02-05T10:00:00');
      expect(starts[1]).toBe('2026-02-05T12:00:00');
    });
  });

  describe('Error handling', () => {
    it('should continue if one account fails (partial results)', async () => {
      const accounts = new Map([
        ['work', mockOAuth2Client],
        ['personal', mockOAuth2Client2]
      ]);

      setupUnifiedCalendars([
        {
          calendarId: 'work@gmail.com',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        },
        {
          calendarId: 'personal@gmail.com',
          accounts: [{ accountId: 'personal', accessRole: 'owner', primary: true, summary: 'Personal' }],
          preferredAccount: 'personal',
          displayName: 'Personal'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'work-event',
              summary: 'Work Meeting',
              start: { dateTime: '2026-02-05T10:00:00' },
              end: { dateTime: '2026-02-05T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=work'
            }
          ]
        }
      });

      // Personal account fails
      mockCalendar2.events.list.mockRejectedValue(new Error('Auth token expired'));

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      // Should still succeed with events from the working account
      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.events).toHaveLength(1);
      expect(response.dayContext.events[0].summary).toBe('Work Meeting');
    });
  });

  describe('focusEventId', () => {
    it('should respect focusEventId parameter', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'event-1',
              summary: 'Meeting 1',
              start: { dateTime: '2026-02-05T10:00:00' },
              end: { dateTime: '2026-02-05T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=1'
            },
            {
              id: 'event-2',
              summary: 'Meeting 2',
              start: { dateTime: '2026-02-05T14:00:00' },
              end: { dateTime: '2026-02-05T15:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=2'
            }
          ]
        }
      });

      const result = await handler.runTool({
        date: '2026-02-05',
        focusEventId: 'event-2'
      }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext.focusEventId).toBe('event-2');
    });

    it('should default focusEventId to empty string when not provided', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'first-event',
              summary: 'First Meeting',
              start: { dateTime: '2026-02-05T09:00:00' },
              end: { dateTime: '2026-02-05T10:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=first'
            }
          ]
        }
      });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext.focusEventId).toBe('');
    });
  });

  describe('Timezone handling', () => {
    it('should use provided timeZone', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({
        date: '2026-02-05',
        timeZone: 'Europe/London'
      }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext.timezone).toBe('Europe/London');
    });

    it('should fall back to primary calendar timezone when timeZone omitted', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      // Should use the mocked timezone from getCalendarTimezone
      expect(response.dayContext.timezone).toBe('America/Los_Angeles');
    });
  });

  describe('Empty results', () => {
    it('should return empty dayContext when no events found', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.date).toBe('2026-02-05');
      expect(response.dayContext.events).toHaveLength(0);
      expect(response.dayContext.dayLink).toContain('2026/02/05');
    });
  });

  describe('Day context structure', () => {
    it('should include timeRange and dayLink', async () => {
      const accounts = new Map([['work', mockOAuth2Client]]);

      setupUnifiedCalendars([
        {
          calendarId: 'primary',
          accounts: [{ accountId: 'work', accessRole: 'owner', primary: true, summary: 'Work' }],
          preferredAccount: 'work',
          displayName: 'Work'
        }
      ]);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'event-1',
              summary: 'Morning Meeting',
              start: { dateTime: '2026-02-05T09:00:00' },
              end: { dateTime: '2026-02-05T10:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=1'
            }
          ]
        }
      });

      const result = await handler.runTool({ date: '2026-02-05' }, accounts);
      const response = parseResponse(result);

      expect(response.dayContext.timeRange).toBeDefined();
      expect(response.dayContext.timeRange.startHour).toBeLessThanOrEqual(9);
      expect(response.dayContext.timeRange.endHour).toBeGreaterThanOrEqual(10);
      expect(response.dayContext.dayLink).toBe('https://calendar.google.com/calendar/r/day/2026/02/05');
    });
  });
});
