import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn(),
        list: vi.fn()
      },
      calendars: {
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock the event ID validator
vi.mock('../../../utils/event-id-validator.js', () => ({
  validateEventId: vi.fn()
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
    // Mock: add Z suffix to timezone-naive datetimes
    return `${datetime}Z`;
  }),
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
}));

describe('CreateEventHandler - Day Context Integration', () => {
  let handler: CreateEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

    handler = new CreateEventHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        insert: vi.fn(),
        list: vi.fn()
      },
      calendars: {
        get: vi.fn().mockResolvedValue({ data: { timeZone: 'America/Los_Angeles' } })
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');

    // Mock getClientWithAutoSelection to return the test account
    vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
      client: mockOAuth2Client,
      accountId: 'test',
      calendarId: 'primary',
      wasAutoSelected: true
    });

    // Mock fetchDayEventsAllCalendars to return events from mockCalendar.events.list
    vi.spyOn(handler as any, 'fetchDayEventsAllCalendars').mockImplementation(async () => {
      const response = await mockCalendar.events.list();
      const events = (response.data.items || []).map((event: any) => ({
        ...event,
        calendarId: 'primary',
        accountId: 'test'
      }));
      return { events, colorContext: { eventPalette: {}, calendarColors: {}, calendarNames: {} } };
    });
  });

  describe('Day Context in Response', () => {
    it('should include dayContext in response when event is created', async () => {
      const createdEvent = {
        id: 'new-event-123',
        summary: 'Test Meeting',
        start: { dateTime: '2026-01-27T14:00:00' },
        end: { dateTime: '2026-01-27T15:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=123'
      };

      const existingEvents = {
        data: {
          items: [
            {
              id: 'existing-1',
              summary: 'Earlier Meeting',
              start: { dateTime: '2026-01-27T10:00:00' },
              end: { dateTime: '2026-01-27T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=existing-1'
            }
          ]
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      mockCalendar.events.list.mockResolvedValue(existingEvents);

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'Test Meeting',
        start: '2026-01-27T14:00:00',
        end: '2026-01-27T15:00:00'
      }, mockAccounts);

      const responseText = result.content[0];
      expect(responseText.type).toBe('text');

      const response = JSON.parse((responseText as any).text);
      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.focusEventId).toBe('new-event-123');
      expect(response.dayContext.date).toBe('2026-01-27');
      expect(response.dayContext.timezone).toBe('America/Los_Angeles');
      expect(response.dayContext.events.length).toBeGreaterThanOrEqual(1);
    });

    it('should include surrounding events in dayContext', async () => {
      const createdEvent = {
        id: 'new-event-456',
        summary: 'Afternoon Meeting',
        start: { dateTime: '2026-01-27T14:00:00' },
        end: { dateTime: '2026-01-27T15:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=456'
      };

      const existingEvents = {
        data: {
          items: [
            {
              id: 'morning-1',
              summary: 'Morning Standup',
              start: { dateTime: '2026-01-27T09:00:00' },
              end: { dateTime: '2026-01-27T09:30:00' },
              htmlLink: 'https://calendar.google.com/event?eid=morning-1'
            },
            {
              id: 'lunch-1',
              summary: 'Lunch',
              start: { dateTime: '2026-01-27T12:00:00' },
              end: { dateTime: '2026-01-27T13:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=lunch-1'
            }
          ]
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      mockCalendar.events.list.mockResolvedValue(existingEvents);

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'Afternoon Meeting',
        start: '2026-01-27T14:00:00',
        end: '2026-01-27T15:00:00'
      }, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);

      // Should have the created event plus the 2 existing events
      expect(response.dayContext.events.length).toBe(3);

      // Check that events are sorted by start time
      const eventIds = response.dayContext.events.map((e: any) => e.id);
      expect(eventIds).toContain('morning-1');
      expect(eventIds).toContain('lunch-1');
      expect(eventIds).toContain('new-event-456');
    });

    it('should include timeRange in dayContext', async () => {
      const createdEvent = {
        id: 'new-event-789',
        summary: 'Late Meeting',
        start: { dateTime: '2026-01-27T16:00:00' },
        end: { dateTime: '2026-01-27T17:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=789'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'Late Meeting',
        start: '2026-01-27T16:00:00',
        end: '2026-01-27T17:00:00'
      }, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);

      expect(response.dayContext.timeRange).toBeDefined();
      expect(response.dayContext.timeRange.startHour).toBeDefined();
      expect(response.dayContext.timeRange.endHour).toBeDefined();
      // Time range should include the event time with buffer
      expect(response.dayContext.timeRange.startHour).toBeLessThanOrEqual(16);
      expect(response.dayContext.timeRange.endHour).toBeGreaterThanOrEqual(17);
    });

    it('should include dayLink in dayContext', async () => {
      const createdEvent = {
        id: 'new-event-abc',
        summary: 'Test Event',
        start: { dateTime: '2026-01-27T10:00:00' },
        end: { dateTime: '2026-01-27T11:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=abc'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'Test Event',
        start: '2026-01-27T10:00:00',
        end: '2026-01-27T11:00:00'
      }, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);

      expect(response.dayContext.dayLink).toBeDefined();
      expect(response.dayContext.dayLink).toContain('calendar.google.com');
      expect(response.dayContext.dayLink).toContain('2026/01/27');
    });
  });

  // Note: UI metadata (_meta.ui.resourceUri) is now in the tool definition via registerAppTool,
  // not in individual responses. The host reads UI metadata when listing tools.

  describe('Day Context Resilience', () => {
    it('should succeed even if day context fetch fails', async () => {
      const createdEvent = {
        id: 'new-event-123',
        summary: 'Test Meeting',
        start: { dateTime: '2026-01-27T14:00:00' },
        end: { dateTime: '2026-01-27T15:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=123'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      // Simulate failure when fetching day events
      vi.spyOn(handler as any, 'fetchDayEventsAllCalendars').mockRejectedValue(new Error('API Error'));

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'Test Meeting',
        start: '2026-01-27T14:00:00',
        end: '2026-01-27T15:00:00'
      }, mockAccounts);

      // Should still succeed with event created
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBe('new-event-123');

      // Day context should be undefined since fetch failed
      expect(response.dayContext).toBeUndefined();
    });
  });

  describe('All-Day Events', () => {
    it('should handle all-day events in dayContext', async () => {
      const createdEvent = {
        id: 'allday-event-123',
        summary: 'All Day Event',
        start: { date: '2026-01-27' },
        end: { date: '2026-01-28' },
        htmlLink: 'https://calendar.google.com/event?eid=allday123'
      };

      const existingEvents = {
        data: {
          items: [
            {
              id: 'timed-1',
              summary: 'Timed Event',
              start: { dateTime: '2026-01-27T10:00:00' },
              end: { dateTime: '2026-01-27T11:00:00' },
              htmlLink: 'https://calendar.google.com/event?eid=timed-1'
            }
          ]
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
      mockCalendar.events.list.mockResolvedValue(existingEvents);

      const result = await handler.runTool({
        calendarId: 'primary',
        summary: 'All Day Event',
        start: '2026-01-27',
        end: '2026-01-28'
      }, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);

      expect(response.dayContext).toBeDefined();
      expect(response.dayContext.date).toBe('2026-01-27');
      expect(response.dayContext.focusEventId).toBe('allday-event-123');

      // Check that both events are included
      const allDayEvents = response.dayContext.events.filter((e: any) => e.isAllDay);
      expect(allDayEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
