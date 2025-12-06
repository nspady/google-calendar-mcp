import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RespondToEventHandler } from '../../../handlers/core/RespondToEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        get: vi.fn(),
        patch: vi.fn()
      },
      calendarList: {
        list: vi.fn(),
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

describe('RespondToEventHandler', () => {
  let handler: RespondToEventHandler;
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new RespondToEventHandler();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        get: vi.fn(),
        patch: vi.fn()
      },
      calendarList: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'primary', summary: 'Primary Calendar', primary: true, accessRole: 'owner' }
            ]
          }
        }),
        get: vi.fn().mockResolvedValue({
          data: { timeZone: 'UTC' }
        })
      }
    };

    vi.mocked(google.calendar).mockReturnValue(mockCalendar);
  });

  describe('runTool', () => {
    it('should successfully accept an event invitation', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      const updatedEvent = {
        ...mockEvent,
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'accepted' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: updatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123'
      });

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: {
          attendees: [
            { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
            { email: 'self@example.com', self: true, responseStatus: 'accepted' }
          ]
        },
        sendUpdates: 'none'
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.responseStatus).toBe('accepted');
      expect(response.sendUpdates).toBe('none');
      expect(response.message).toBe('Your response has been set to "accepted"');
      expect(response.event).toBeDefined();
    });

    it('should successfully decline an event invitation', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      const updatedEvent = {
        ...mockEvent,
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'declined' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: updatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'declined' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: {
          attendees: expect.arrayContaining([
            expect.objectContaining({ responseStatus: 'declined', self: true })
          ])
        },
        sendUpdates: 'none'
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.responseStatus).toBe('declined');
      expect(response.sendUpdates).toBe('none');
    });

    it('should successfully respond with tentative (maybe)', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      const updatedEvent = {
        ...mockEvent,
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'tentative' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: updatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'tentative' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.responseStatus).toBe('tentative');
      expect(response.sendUpdates).toBe('none');
      expect(response.message).toBe('Your response has been set to "tentative"');
    });

    it('should respect custom sendUpdates parameter', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const,
        sendUpdates: 'all' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          sendUpdates: 'all'
        })
      );

      // Verify response includes the sendUpdates value
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.sendUpdates).toBe('all');
    });

    it('should throw error when user is not an attendee', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'other@example.com', responseStatus: 'accepted' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'You are not an attendee of this event. Only attendees can respond to event invitations.'
      );
    });

    it('should throw error when user is the organizer', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'self@example.com', self: true, organizer: true, responseStatus: 'accepted' },
          { email: 'other@example.com', responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'You are the organizer of this event. Organizers do not respond to their own event invitations.'
      );
    });

    it('should throw error when event not found', async () => {
      mockCalendar.events.get.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'nonexistent',
        response: 'accepted' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Event not found');
    });

    it('should throw error when event has no attendees', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Solo Event',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' }
        // No attendees
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'You are not an attendee of this event. Only attendees can respond to event invitations.'
      );
    });

    it('should handle patch failure', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Failed to update event response'
      );
    });

    it('should handle API errors gracefully', async () => {
      const apiError = new Error('API Error');
      (apiError as any).code = 500;
      mockCalendar.events.get.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      // Mock handleGoogleApiError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Handled API Error');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Handled API Error');
    });

    it('should preserve other attendee properties when updating response', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          {
            email: 'self@example.com',
            self: true,
            responseStatus: 'needsAction',
            displayName: 'My Name',
            optional: false,
            comment: 'Looking forward to it'
          }
        ]
      };

      const updatedEvent = { ...mockEvent };
      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: updatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: {
          attendees: expect.arrayContaining([
            expect.objectContaining({
              email: 'self@example.com',
              self: true,
              responseStatus: 'accepted',
              displayName: 'My Name',
              optional: false,
              comment: 'Looking forward to it'
            })
          ])
        },
        sendUpdates: 'none'
      });
    });
  });

  describe('Comment Support', () => {
    it('should include comment when declining', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      const updatedEvent = {
        ...mockEvent,
        attendees: [
          { email: 'organizer@example.com', organizer: true, responseStatus: 'accepted' },
          { email: 'self@example.com', self: true, responseStatus: 'declined', comment: 'I have a conflict' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: updatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'declined' as const,
        comment: 'I have a conflict'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: {
          attendees: expect.arrayContaining([
            expect.objectContaining({
              responseStatus: 'declined',
              comment: 'I have a conflict'
            })
          ])
        },
        sendUpdates: 'none'
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.message).toContain('I have a conflict');
    });

    it('should include comment when accepting', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const,
        comment: 'Looking forward to it!'
      };

      const result = await handler.runTool(args, mockAccounts);

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.message).toContain('Looking forward to it!');
    });

    it('should not include comment field when comment is not provided', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        response: 'accepted' as const
      };

      await handler.runTool(args, mockAccounts);

      const patchCall = mockCalendar.events.patch.mock.calls[0][0];
      const updatedAttendee = patchCall.requestBody.attendees[0];

      expect(updatedAttendee.responseStatus).toBe('accepted');
      expect(updatedAttendee).not.toHaveProperty('comment');
    });
  });

  describe('Recurring Event Support', () => {
    it('should respond to single instance of recurring event', async () => {
      const mockRecurringEvent = {
        id: 'recurring123',
        summary: 'Weekly Standup',
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      // Setup mock calendar for recurring event detection
      mockCalendar.events.get
        .mockResolvedValueOnce({ data: mockRecurringEvent }) // For detectEventType
        .mockResolvedValueOnce({ data: mockRecurringEvent }); // For actual get
      mockCalendar.events.patch.mockResolvedValue({ data: mockRecurringEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        response: 'accepted' as const,
        modificationScope: 'thisEventOnly' as const,
        originalStartTime: '2025-01-15T10:00:00Z'
      };

      const result = await handler.runTool(args, mockAccounts);

      // Verify the instance ID was used (formatted with underscore and timestamp)
      expect(mockCalendar.events.patch).toHaveBeenCalled();

      const patchCall = mockCalendar.events.patch.mock.calls[0][0];
      expect(patchCall.eventId).toContain('recurring123_');
      expect(patchCall.eventId).toContain('20250115T100000Z');

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.message).toContain('this instance only');
    });

    it('should respond to all instances of recurring event', async () => {
      const mockRecurringEvent = {
        id: 'recurring123',
        summary: 'Weekly Standup',
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockRecurringEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockRecurringEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        response: 'declined' as const,
        modificationScope: 'all' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      // Verify the base event ID was used
      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'recurring123'
        })
      );

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.message).toContain('all instances');
    });

    it('should throw error when originalStartTime missing for thisEventOnly', async () => {
      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        response: 'accepted' as const,
        modificationScope: 'thisEventOnly' as const
        // Missing originalStartTime
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'originalStartTime is required'
      );
    });

    it('should throw error when using thisEventOnly on non-recurring event', async () => {
      const mockSingleEvent = {
        id: 'single123',
        summary: 'One-time Meeting',
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
        // No recurrence property
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockSingleEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'single123',
        response: 'accepted' as const,
        modificationScope: 'thisEventOnly' as const,
        originalStartTime: '2025-01-15T10:00:00Z'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'can only be used with recurring events'
      );
    });

    it('should use base event ID when no modificationScope specified', async () => {
      const mockRecurringEvent = {
        id: 'recurring123',
        summary: 'Weekly Standup',
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockRecurringEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockRecurringEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        response: 'tentative' as const
        // No modificationScope - should default to 'all' behavior
      };

      await handler.runTool(args, mockAccounts);

      // Verify the base event ID was used (not instance-specific)
      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'recurring123'
        })
      );
    });

    it('should extract base event ID when modificationScope is all and instance ID is provided', async () => {
      const mockRecurringEvent = {
        id: 'recurring123',
        summary: 'Weekly Standup',
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
        attendees: [
          { email: 'self@example.com', self: true, responseStatus: 'needsAction' }
        ]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockRecurringEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockRecurringEvent });

      const args = {
        calendarId: 'primary',
        // Pass an instance ID (baseId_timestamp format)
        eventId: 'recurring123_20250115T100000Z',
        response: 'declined' as const,
        modificationScope: 'all' as const
      };

      await handler.runTool(args, mockAccounts);

      // Should extract base ID and use it for the patch call
      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'recurring123' // Base ID extracted from instance ID
        })
      );
    });
  });
});
