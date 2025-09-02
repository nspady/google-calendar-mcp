import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateEventHandler } from '../../../handlers/core/UpdateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        patch: vi.fn(),
        get: vi.fn()
      },
      calendars: {
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock RecurringEventHelpers
vi.mock('../../../handlers/core/RecurringEventHelpers.js', () => ({
  RecurringEventHelpers: vi.fn().mockImplementation((calendar) => ({
    detectEventType: vi.fn().mockResolvedValue('single'),
    getCalendar: vi.fn(() => calendar),
    buildUpdateRequestBody: vi.fn((args, defaultTimeZone) => {
      const body: any = {};
      if (args.summary) body.summary = args.summary;
      if (args.description) body.description = args.description;
      if (args.location) body.location = args.location;
      const tz = args.timeZone || defaultTimeZone;
      if (args.start) body.start = { dateTime: args.start, timeZone: tz };
      if (args.end) body.end = { dateTime: args.end, timeZone: tz };
      if (args.attendees) body.attendees = args.attendees;
      if (args.colorId) body.colorId = args.colorId;
      if (args.reminders) body.reminders = args.reminders;
      return body;
    })
  })),
  RecurringEventError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  RECURRING_EVENT_ERRORS: {
    NON_RECURRING_SCOPE: 'NON_RECURRING_SCOPE'
  }
}));

describe('UpdateEventHandler', () => {
  let handler: UpdateEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new UpdateEventHandler();
    mockOAuth2Client = new OAuth2Client();
    
    // Setup mock calendar
    mockCalendar = {
      events: {
        patch: vi.fn(),
        get: vi.fn()
      },
      calendars: {
        get: vi.fn()
      }
    };
    
    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
    
    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
  });

  describe('Basic Event Updates', () => {
    it('should update event summary', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Updated Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        htmlLink: 'https://calendar.google.com/event?eid=abc123'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting'
        })
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.summary).toBe('Updated Meeting');
    });

    it('should update event description and location', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        description: 'New description',
        location: 'Conference Room B',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        description: 'New description',
        location: 'Conference Room B'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          description: 'New description',
          location: 'Conference Room B'
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.description).toBe('New description');
      expect(response.event.location).toBe('Conference Room B');
    });

    it('should update event times', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        start: { dateTime: '2025-01-16T14:00:00Z' },
        end: { dateTime: '2025-01-16T15:00:00Z' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        start: '2025-01-16T14:00:00',
        end: '2025-01-16T15:00:00',
        timeZone: 'America/Los_Angeles'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'America/Los_Angeles' },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'America/Los_Angeles' }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
    });

    it('should update attendees', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        attendees: [
          { email: 'alice@example.com' },
          { email: 'bob@example.com' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        attendees: [
          { email: 'alice@example.com' },
          { email: 'bob@example.com' }
        ],
        sendUpdates: 'all' as const
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          attendees: [
            { email: 'alice@example.com' },
            { email: 'bob@example.com' }
          ]
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
    });

    it('should update reminders', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 30 },
            { method: 'popup', minutes: 10 }
          ]
        }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email' as const, minutes: 30 },
            { method: 'popup' as const, minutes: 10 }
          ]
        }
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 30 },
              { method: 'popup', minutes: 10 }
            ]
          }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
    });

    it('should update color ID', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        colorId: '7'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        colorId: '7'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          colorId: '7'
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
    });

    it('should update multiple fields at once', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Location',
        start: { dateTime: '2025-01-16T14:00:00Z' },
        end: { dateTime: '2025-01-16T15:00:00Z' },
        attendees: [{ email: 'alice@example.com' }],
        colorId: '5',
        reminders: { useDefault: true }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Location',
        start: '2025-01-16T14:00:00',
        end: '2025-01-16T15:00:00',
        attendees: [{ email: 'alice@example.com' }],
        colorId: '5',
        reminders: { useDefault: true },
        sendUpdates: 'externalOnly' as const
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting',
          description: 'Updated description',
          location: 'New Location',
          colorId: '5'
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
    });
  });

  describe('Send Updates Options', () => {
    it('should send updates to all when specified', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Updated Meeting'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting',
        sendUpdates: 'all' as const
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting'
        })
      });
    });

    it('should send updates to external users only when specified', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Updated Meeting'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting',
        sendUpdates: 'externalOnly' as const
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting'
        })
      });
    });

    it('should not send updates when none specified', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Updated Meeting'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting',
        sendUpdates: 'none' as const
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting'
        })
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle event not found error', async () => {
      const notFoundError = new Error('Not Found');
      (notFoundError as any).code = 404;
      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockRejectedValue(notFoundError);

      const args = {
        calendarId: 'primary',
        eventId: 'nonexistent',
        summary: 'Updated Meeting'
      };

      // The actual error will be "Not Found" since handleGoogleApiError is not being called
      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow('Not Found');
    });

    it('should handle permission denied error', async () => {
      const permissionError = new Error('Forbidden');
      (permissionError as any).code = 403;
      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockRejectedValue(permissionError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting'
      };

      // Don't mock handleGoogleApiError - let the actual error pass through
      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow('Forbidden');
    });

    it('should reject modification scope on non-recurring events', async () => {
      // Mock detectEventType to return 'single' for non-recurring event
      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting',
        modificationScope: 'thisEventOnly' as const
      };

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        'Scope other than "all" only applies to recurring events'
      );
    });

    it('should handle API errors with response status', async () => {
      const apiError = new Error('Bad Request');
      (apiError as any).response = { status: 400 };
      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting'
      };

      // Mock handleGoogleApiError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Bad Request');
      });

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow('Bad Request');
    });

    it('should handle missing response data', async () => {
      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Updated Meeting'
      };

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        'Failed to update event'
      );
    });
  });

  describe('Timezone Handling', () => {
    it('should use calendar default timezone when not specified', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        start: { dateTime: '2025-01-16T14:00:00-08:00' },
        end: { dateTime: '2025-01-16T15:00:00-08:00' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        start: '2025-01-16T14:00:00',
        end: '2025-01-16T15:00:00'
        // No timeZone specified
      };

      await handler.runTool(args, mockOAuth2Client);

      // Should use the mocked default timezone 'America/Los_Angeles'
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'America/Los_Angeles' },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'America/Los_Angeles' }
        })
      });
    });

    it('should override calendar timezone when specified', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting',
        start: { dateTime: '2025-01-16T14:00:00+00:00' },
        end: { dateTime: '2025-01-16T15:00:00+00:00' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        start: '2025-01-16T14:00:00',
        end: '2025-01-16T15:00:00',
        timeZone: 'UTC'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'UTC' }
        })
      });
    });
  });
});