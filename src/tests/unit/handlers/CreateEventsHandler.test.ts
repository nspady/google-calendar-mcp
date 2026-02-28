import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateEventsHandler } from '../../../handlers/core/CreateEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn()
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
  }),
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
}));

function makeMockEvent(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'event-1',
    summary: overrides.summary ?? 'Test Event',
    start: { dateTime: '2025-06-15T10:00:00Z' },
    end: { dateTime: '2025-06-15T11:00:00Z' },
    htmlLink: 'https://calendar.google.com/event?eid=abc',
    ...overrides,
  };
}

describe('CreateEventsHandler', () => {
  let handler: CreateEventsHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    CalendarRegistry.resetInstance();

    handler = new CreateEventsHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    mockCalendar = {
      events: {
        insert: vi.fn()
      }
    };

    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
    vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
      client: mockOAuth2Client,
      accountId: 'test',
      calendarId: 'primary',
      wasAutoSelected: true
    });
  });

  describe('Happy Path', () => {
    it('should create a single event successfully', async () => {
      const mockEvent = makeMockEvent();
      mockCalendar.events.insert.mockResolvedValue({ data: mockEvent });

      const args = {
        events: [{
          summary: 'Test Event',
          start: '2025-06-15T10:00:00',
          end: '2025-06-15T11:00:00',
        }]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.totalRequested).toBe(1);
      expect(response.totalCreated).toBe(1);
      expect(response.totalFailed).toBe(0);
      expect(response.created).toHaveLength(1);
      expect(response.created[0].id).toBe('event-1');
      expect(response.failed).toBeUndefined();
    });

    it('should create multiple events successfully', async () => {
      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'event-1', summary: 'Event 1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'event-2', summary: 'Event 2' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'event-3', summary: 'Event 3' }) });

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'Event 3', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.totalRequested).toBe(3);
      expect(response.totalCreated).toBe(3);
      expect(response.totalFailed).toBe(0);
      expect(mockCalendar.events.insert).toHaveBeenCalledTimes(3);
    });

    it('should pass all optional fields through to the API', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        events: [{
          summary: 'Full Event',
          start: '2025-06-15T10:00:00',
          end: '2025-06-15T11:00:00',
          description: 'A detailed description',
          location: 'Conference Room A',
          attendees: [{ email: 'user@example.com' }],
          colorId: '5',
          reminders: { useDefault: false, overrides: [{ method: 'popup' as const, minutes: 10 }] },
          recurrence: ['RRULE:FREQ=WEEKLY;COUNT=5'],
          transparency: 'transparent' as const,
          visibility: 'private' as const,
          guestsCanInviteOthers: false,
          guestsCanModify: true,
          guestsCanSeeOtherGuests: false,
          anyoneCanAddSelf: false,
        }]
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Full Event',
            description: 'A detailed description',
            location: 'Conference Room A',
            attendees: [{ email: 'user@example.com' }],
            colorId: '5',
            recurrence: ['RRULE:FREQ=WEEKLY;COUNT=5'],
            transparency: 'transparent',
            visibility: 'private',
            guestsCanInviteOthers: false,
            guestsCanModify: true,
            guestsCanSeeOtherGuests: false,
            anyoneCanAddSelf: false,
          })
        })
      );
    });

    it('should include conferenceDataVersion when conferenceData is provided', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        events: [{
          summary: 'Meet Event',
          start: '2025-06-15T10:00:00',
          end: '2025-06-15T11:00:00',
          conferenceData: {
            createRequest: {
              requestId: 'unique-id',
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        }]
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({ conferenceDataVersion: 1 })
      );
    });
  });

  describe('Partial Failure', () => {
    it('should return partial results when some events fail', async () => {
      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'ok-1', summary: 'Good Event' }) })
        .mockRejectedValueOnce(new Error('API error for event 2'))
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'ok-3', summary: 'Also Good' }) });

      // handleGoogleApiError converts raw errors to McpError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
      });

      const args = {
        events: [
          { summary: 'Good Event', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Bad Event', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'Also Good', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      // Partial success should NOT set isError
      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.totalRequested).toBe(3);
      expect(response.totalCreated).toBe(2);
      expect(response.totalFailed).toBe(1);
      expect(response.created).toHaveLength(2);
      expect(response.failed).toHaveLength(1);
      expect(response.failed[0].index).toBe(1);
      expect(response.failed[0].summary).toBe('Bad Event');
      expect(response.failed[0].error).toContain('API error for event 2');
    });

    it('should use formatGoogleApiError to format error messages', async () => {
      const formatSpy = vi.spyOn(handler as any, 'formatGoogleApiError').mockReturnValue('Bad Request: Invalid time range');

      mockCalendar.events.insert.mockRejectedValueOnce(new Error('raw error'));

      const args = {
        events: [
          { summary: 'Bad Event', start: '2025-06-15T10:00:00', end: '2025-06-15T09:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(formatSpy).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.failed[0].error).toContain('Bad Request: Invalid time range');
    });
  });

  describe('All-Failure', () => {
    it('should set isError when all events fail', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
      });

      mockCalendar.events.insert
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'));

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.totalCreated).toBe(0);
      expect(response.totalFailed).toBe(2);
      expect(response.failed).toHaveLength(2);
    });

    it('should set isError when a single event fails', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
      });

      mockCalendar.events.insert.mockRejectedValueOnce(new Error('fail'));

      const args = {
        events: [
          { summary: 'Only Event', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.totalCreated).toBe(0);
      expect(response.totalFailed).toBe(1);
    });

    it('should throw when pre-validation of shared account fails', async () => {
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockRejectedValue(
        new McpError(ErrorCode.InvalidRequest, 'No account has write access to calendar "primary"')
      );

      const args = {
        account: 'nonexistent',
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
        ]
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'No account has write access to calendar "primary"'
      );
    });
  });

  describe('Shared Defaults vs Per-Event Overrides', () => {
    it('should apply shared defaults to all events', async () => {
      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e2' }) });

      const args = {
        calendarId: 'work-calendar',
        timeZone: 'Europe/London',
        sendUpdates: 'all' as const,
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // Both events should use shared calendarId
      for (const call of mockCalendar.events.insert.mock.calls) {
        expect(call[0].calendarId).toBe('primary'); // resolvedCalendarId from mock
        expect(call[0].sendUpdates).toBe('all');
      }
    });

    it('should let per-event overrides take precedence over shared defaults', async () => {
      const workClient = new OAuth2Client();
      const personalClient = new OAuth2Client();
      const multiAccounts = new Map([['work', workClient], ['personal', personalClient]]);

      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');
      getClientSpy
        .mockResolvedValueOnce({ client: workClient, accountId: 'work', calendarId: 'work-cal', wasAutoSelected: false })    // pre-validate
        .mockResolvedValueOnce({ client: workClient, accountId: 'work', calendarId: 'work-cal', wasAutoSelected: false })    // event 1 (shared)
        .mockResolvedValueOnce({ client: personalClient, accountId: 'personal', calendarId: 'personal-cal', wasAutoSelected: false }); // event 2 (override)

      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e2' }) });

      // Need getCalendar to work for both clients
      vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

      const args = {
        account: 'work',
        calendarId: 'work-cal',
        timeZone: 'America/New_York',
        sendUpdates: 'none' as const,
        events: [
          { summary: 'Work Event', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          {
            summary: 'Personal Event',
            start: '2025-06-15T10:00:00',
            end: '2025-06-15T11:00:00',
            account: 'personal',
            calendarId: 'personal-cal',
            timeZone: 'Europe/London',
            sendUpdates: 'all' as const,
          },
        ]
      };

      await handler.runTool(args, multiAccounts);

      // Event 1 uses shared defaults
      expect(mockCalendar.events.insert.mock.calls[0][0].sendUpdates).toBe('none');

      // Event 2 uses per-event overrides
      expect(mockCalendar.events.insert.mock.calls[1][0].sendUpdates).toBe('all');
    });

    it('should default calendarId to primary when neither shared nor per-event specified', async () => {
      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        events: [
          { summary: 'Event', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // Pre-validate call uses 'primary' as default
      expect(getClientSpy).toHaveBeenCalledWith(undefined, 'primary', mockAccounts, 'write');
    });

    it('should use ?? (nullish coalescing) so empty string per-event values are respected', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      // timeZone is explicitly set on the event; shared default should NOT override
      const args = {
        timeZone: 'America/New_York',
        events: [
          {
            summary: 'Event',
            start: '2025-06-15T10:00:00',
            end: '2025-06-15T11:00:00',
            timeZone: 'Europe/Berlin',
          },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // The timezone passed to createTimeObject should be the per-event one
      const { createTimeObject } = await import('../../../utils/datetime.js');
      expect(createTimeObject).toHaveBeenCalledWith('2025-06-15T10:00:00', 'Europe/Berlin');
    });
  });

  describe('Caching', () => {
    it('should cache getClientWithAutoSelection per (account, calendarId) pair', async () => {
      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');

      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e2' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e3' }) });

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'Event 3', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // 1 pre-validate call + 1 cache-miss in the loop (same key reused for events 2 & 3)
      expect(getClientSpy).toHaveBeenCalledTimes(2);
    });

    it('should cache getCalendarTimezone per (account, calendarId) pair', async () => {
      const tzSpy = vi.spyOn(handler as any, 'getCalendarTimezone');

      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e2' }) });

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // Only called once despite 2 events (cached for second event)
      expect(tzSpy).toHaveBeenCalledTimes(1);
    });

    it('should make separate cache entries for different calendars', async () => {
      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');
      getClientSpy
        .mockResolvedValueOnce({ client: mockOAuth2Client, accountId: 'test', calendarId: 'primary', wasAutoSelected: true })   // pre-validate
        .mockResolvedValueOnce({ client: mockOAuth2Client, accountId: 'test', calendarId: 'primary', wasAutoSelected: true })   // event 1
        .mockResolvedValueOnce({ client: mockOAuth2Client, accountId: 'test', calendarId: 'work-cal', wasAutoSelected: true }); // event 2

      mockCalendar.events.insert
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e1' }) })
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'e2' }) });

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00', calendarId: 'work-cal' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // pre-validate + 2 different cache keys
      expect(getClientSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Circuit Breaker', () => {
    it('should skip remaining events after 3 consecutive identical failures', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new McpError(ErrorCode.InvalidRequest, 'Access denied: Insufficient permissions');
      });

      mockCalendar.events.insert.mockRejectedValue(new Error('Forbidden'));

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'Event 3', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
          { summary: 'Event 4', start: '2025-06-15T12:00:00', end: '2025-06-15T13:00:00' },
          { summary: 'Event 5', start: '2025-06-15T13:00:00', end: '2025-06-15T14:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.totalFailed).toBe(5);
      // Only 3 API calls should have been made (circuit breaker trips after 3rd)
      expect(mockCalendar.events.insert).toHaveBeenCalledTimes(3);
      // Events 4 and 5 should be marked as skipped
      expect(response.failed[3].error).toContain('Skipped');
      expect(response.failed[4].error).toContain('Skipped');
    });

    it('should reset circuit breaker on success', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
      });

      // Fail twice, succeed, fail twice more - should NOT trigger circuit breaker
      mockCalendar.events.insert
        .mockRejectedValueOnce(new Error('same error'))
        .mockRejectedValueOnce(new Error('same error'))
        .mockResolvedValueOnce({ data: makeMockEvent({ id: 'ok' }) })
        .mockRejectedValueOnce(new Error('same error'))
        .mockRejectedValueOnce(new Error('same error'));

      const args = {
        events: [
          { summary: 'E1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'E2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'E3', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
          { summary: 'E4', start: '2025-06-15T12:00:00', end: '2025-06-15T13:00:00' },
          { summary: 'E5', start: '2025-06-15T13:00:00', end: '2025-06-15T14:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      // All 5 attempts should have been made (circuit breaker reset after E3 success)
      expect(mockCalendar.events.insert).toHaveBeenCalledTimes(5);
      expect(response.totalCreated).toBe(1);
      expect(response.totalFailed).toBe(4);
    });

    it('should not trigger circuit breaker for different error messages', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, error.message);
      });

      mockCalendar.events.insert
        .mockRejectedValueOnce(new Error('Error A'))
        .mockRejectedValueOnce(new Error('Error B'))
        .mockRejectedValueOnce(new Error('Error C'))
        .mockRejectedValueOnce(new Error('Error D'));

      const args = {
        events: [
          { summary: 'E1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'E2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
          { summary: 'E3', start: '2025-06-15T11:00:00', end: '2025-06-15T12:00:00' },
          { summary: 'E4', start: '2025-06-15T12:00:00', end: '2025-06-15T13:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      // All 4 calls should proceed since errors are different
      expect(mockCalendar.events.insert).toHaveBeenCalledTimes(4);
      const response = JSON.parse(result.content[0].text);
      expect(response.totalFailed).toBe(4);
    });
  });

  describe('Fail-Fast Pre-Validation', () => {
    it('should pre-validate shared defaults before iterating', async () => {
      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');

      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        account: 'test',
        calendarId: 'work-cal',
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // First call is pre-validation, second is in the loop (cache miss since getClientWithAutoSelection
      // is mocked to return different calendarId)
      expect(getClientSpy.mock.calls[0]).toEqual(['test', 'work-cal', mockAccounts, 'write']);
    });

    it('should skip pre-validation when events have per-event account overrides', async () => {
      const getClientSpy = vi.spyOn(handler as any, 'getClientWithAutoSelection');

      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00', account: 'work' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // No pre-validation call — only the in-loop call
      expect(getClientSpy).toHaveBeenCalledTimes(1);
      expect(getClientSpy.mock.calls[0][0]).toBe('work');
    });

    it('should fail fast when shared account is invalid', async () => {
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockRejectedValue(
        new McpError(ErrorCode.InvalidRequest, 'Account "bad-account" not found')
      );

      const args = {
        account: 'bad-account',
        events: [
          { summary: 'Event 1', start: '2025-06-15T09:00:00', end: '2025-06-15T10:00:00' },
          { summary: 'Event 2', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      // Should throw immediately without attempting any inserts
      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Account "bad-account" not found');
      expect(mockCalendar.events.insert).not.toHaveBeenCalled();
    });
  });

  describe('Schema Boundary Validation', () => {
    it('should handle the minimum: 1 event', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        events: [
          { summary: 'Single Event', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.totalRequested).toBe(1);
      expect(response.totalCreated).toBe(1);
    });

    it('should handle the maximum: 50 events', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const events = Array.from({ length: 50 }, (_, i) => ({
        summary: `Event ${i + 1}`,
        start: '2025-06-15T10:00:00',
        end: '2025-06-15T11:00:00',
      }));

      const args = { events };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.totalRequested).toBe(50);
      expect(response.totalCreated).toBe(50);
      expect(mockCalendar.events.insert).toHaveBeenCalledTimes(50);
    });

    it('should handle event with no data returned from API', async () => {
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation((error: any) => {
        throw new McpError(ErrorCode.InternalError, `Internal error: ${error.message}`);
      });

      mockCalendar.events.insert.mockResolvedValue({ data: null });

      const args = {
        events: [
          { summary: 'Event', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.totalFailed).toBe(1);
      expect(response.failed[0].error).toContain('Failed to create event');
    });

    it('should use calendar timezone fallback when no timezone provided', async () => {
      const tzSpy = vi.spyOn(handler as any, 'getCalendarTimezone');
      mockCalendar.events.insert.mockResolvedValue({ data: makeMockEvent() });

      const args = {
        // No timeZone at shared or event level
        events: [
          { summary: 'Event', start: '2025-06-15T10:00:00', end: '2025-06-15T11:00:00' },
        ]
      };

      await handler.runTool(args, mockAccounts);

      // getCalendarTimezone should have been called as fallback
      expect(tzSpy).toHaveBeenCalled();

      // The createTimeObject should receive the mocked timezone
      const { createTimeObject } = await import('../../../utils/datetime.js');
      expect(createTimeObject).toHaveBeenCalledWith('2025-06-15T10:00:00', 'America/Los_Angeles');
    });
  });
});
