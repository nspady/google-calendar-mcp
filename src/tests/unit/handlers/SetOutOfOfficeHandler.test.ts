import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetOutOfOfficeHandler } from '../../../handlers/core/SetOutOfOfficeHandler.js';
import { OAuth2Client } from 'google-auth-library';
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
vi.mock('../../../handlers/utils/datetime.js', () => ({
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
}));

describe('SetOutOfOfficeHandler', () => {
  let handler: SetOutOfOfficeHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

    handler = new SetOutOfOfficeHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        insert: vi.fn()
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
  });

  describe('Basic Out of Office Event Creation', () => {
    it('should create an out of office event with default settings', async () => {
      const mockCreatedEvent = {
        id: 'ooo-event-123',
        summary: 'Out of office',
        eventType: 'outOfOffice',
        transparency: 'opaque',
        start: { dateTime: '2025-01-15T09:00:00-08:00' },
        end: { dateTime: '2025-01-15T17:00:00-08:00' },
        outOfOfficeProperties: {
          autoDeclineMode: 'declineAllConflictingInvitations'
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Out of office',
          eventType: 'outOfOffice',
          transparency: 'opaque',
          outOfOfficeProperties: expect.objectContaining({
            autoDeclineMode: 'declineAllConflictingInvitations'
          })
        })
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.eventType).toBe('outOfOffice');
    });

    it('should create out of office event with custom summary', async () => {
      const mockCreatedEvent = {
        id: 'ooo-event-123',
        summary: 'On vacation 🏖️',
        eventType: 'outOfOffice',
        transparency: 'opaque'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'On vacation 🏖️',
        start: '2025-01-15T09:00:00',
        end: '2025-01-20T17:00:00'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'On vacation 🏖️'
          })
        })
      );
    });

    it('should create out of office event with auto-decline settings', async () => {
      const mockCreatedEvent = {
        id: 'ooo-event-123',
        summary: 'Out of office',
        eventType: 'outOfOffice',
        outOfOfficeProperties: {
          autoDeclineMode: 'declineOnlyNewConflictingInvitations',
          declineMessage: 'I am out of office until January 20th.'
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-20T17:00:00',
        autoDeclineMode: 'declineOnlyNewConflictingInvitations' as const,
        declineMessage: 'I am out of office until January 20th.'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            outOfOfficeProperties: {
              autoDeclineMode: 'declineOnlyNewConflictingInvitations',
              declineMessage: 'I am out of office until January 20th.'
            }
          })
        })
      );
    });

    it('should create out of office event with declineNone mode', async () => {
      const mockCreatedEvent = {
        id: 'ooo-event-123',
        summary: 'Working remotely',
        eventType: 'outOfOffice',
        outOfOfficeProperties: {
          autoDeclineMode: 'declineNone'
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Working remotely',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        autoDeclineMode: 'declineNone' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            outOfOfficeProperties: expect.objectContaining({
              autoDeclineMode: 'declineNone'
            })
          })
        })
      );
    });
  });

  describe('Timezone Handling', () => {
    it('should use provided timezone', async () => {
      const mockCreatedEvent = {
        id: 'ooo-event-123',
        summary: 'Out of office',
        eventType: 'outOfOffice'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        timeZone: 'Europe/London'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            start: expect.objectContaining({
              timeZone: 'Europe/London'
            }),
            end: expect.objectContaining({
              timeZone: 'Europe/London'
            })
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('API Error');
      (apiError as any).response = { status: 403 };
      mockCalendar.events.insert.mockRejectedValue(apiError);

      // Mock handleGoogleApiError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Access denied: Insufficient permissions');
      });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Access denied');
    });
  });
});
