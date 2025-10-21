import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateEventHandler } from '../../../handlers/core/UpdateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import type { UpdateEventInput } from '../../../tools/registry.js';
import type { RecurringEventHelpers } from '../../../handlers/core/RecurringEventHelpers.js';

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

// Import createTimeObject for proper datetime handling in mocks
import { createTimeObject } from '../../../handlers/utils/datetime.js';

// Mock RecurringEventHelpers
vi.mock('../../../handlers/core/RecurringEventHelpers.js', () => ({
  RecurringEventHelpers: vi.fn().mockImplementation((calendar) => ({
    detectEventType: vi.fn().mockResolvedValue('single'),
    getCalendar: vi.fn(() => calendar),
    buildUpdateRequestBody: vi.fn((args, defaultTimeZone) => {
      const body: any = {};
      if (args.summary !== undefined && args.summary !== null) body.summary = args.summary;
      if (args.description !== undefined && args.description !== null) body.description = args.description;
      if (args.location !== undefined && args.location !== null) body.location = args.location;
      const tz = args.timeZone || defaultTimeZone;

      // Use createTimeObject to handle both timed and all-day events
      if (args.start !== undefined && args.start !== null) {
        const timeObj = createTimeObject(args.start, tz);
        // When converting formats, explicitly nullify the opposite field
        if (timeObj.date !== undefined) {
          body.start = { date: timeObj.date, dateTime: null };
        } else {
          body.start = { dateTime: timeObj.dateTime, timeZone: timeObj.timeZone, date: null };
        }
      }
      if (args.end !== undefined && args.end !== null) {
        const timeObj = createTimeObject(args.end, tz);
        // When converting formats, explicitly nullify the opposite field
        if (timeObj.date !== undefined) {
          body.end = { date: timeObj.date, dateTime: null };
        } else {
          body.end = { dateTime: timeObj.dateTime, timeZone: timeObj.timeZone, date: null };
        }
      }

      if (args.attendees !== undefined && args.attendees !== null) body.attendees = args.attendees;
      if (args.colorId !== undefined && args.colorId !== null) body.colorId = args.colorId;
      if (args.reminders !== undefined && args.reminders !== null) body.reminders = args.reminders;
      if (args.conferenceData !== undefined && args.conferenceData !== null) body.conferenceData = args.conferenceData;
      if (args.transparency !== undefined && args.transparency !== null) body.transparency = args.transparency;
      if (args.visibility !== undefined && args.visibility !== null) body.visibility = args.visibility;
      if (args.guestsCanInviteOthers !== undefined) body.guestsCanInviteOthers = args.guestsCanInviteOthers;
      if (args.guestsCanModify !== undefined) body.guestsCanModify = args.guestsCanModify;
      if (args.guestsCanSeeOtherGuests !== undefined) body.guestsCanSeeOtherGuests = args.guestsCanSeeOtherGuests;
      if (args.anyoneCanAddSelf !== undefined) body.anyoneCanAddSelf = args.anyoneCanAddSelf;
      if (args.extendedProperties !== undefined && args.extendedProperties !== null) body.extendedProperties = args.extendedProperties;
      if (args.attachments !== undefined && args.attachments !== null) body.attachments = args.attachments;
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
        get: vi.fn(),
        insert: vi.fn()
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
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'America/Los_Angeles', date: null },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'America/Los_Angeles', date: null }
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

    it('should update guest permissions', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Team Meeting',
        guestsCanInviteOthers: false,
        guestsCanModify: true,
        guestsCanSeeOtherGuests: false
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        guestsCanInviteOthers: false,
        guestsCanModify: true,
        guestsCanSeeOtherGuests: false,
        anyoneCanAddSelf: true
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          guestsCanInviteOthers: false,
          guestsCanModify: true,
          guestsCanSeeOtherGuests: false,
          anyoneCanAddSelf: true
        })
      });

      const response = JSON.parse(result.content[0].text as string);
      expect(response).toHaveProperty('event');
      expect(response.event.id).toBe('event123');
      expect(response.event.guestsCanInviteOthers).toBe(false);
      expect(response.event.guestsCanModify).toBe(true);
      expect(response.event.guestsCanSeeOtherGuests).toBe(false);
    });

    it('should update event with conference data', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Video Meeting',
        conferenceData: {
          entryPoints: [{ uri: 'https://meet.google.com/abc-defg-hij' }]
        }
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        summary: 'Video Meeting',
        conferenceData: {
          createRequest: {
            requestId: 'unique-request-456',
            conferenceSolutionKey: {
              type: 'hangoutsMeet' as const
            }
          }
        }
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          summary: 'Video Meeting',
          conferenceData: {
            createRequest: {
              requestId: 'unique-request-456',
              conferenceSolutionKey: {
                type: 'hangoutsMeet'
              }
            }
          }
        }),
        conferenceDataVersion: 1
      });

      const response = JSON.parse(result.content[0].text as string);
      expect(response).toHaveProperty('event');
      expect(response.event.id).toBe('event123');
      expect(response.event.summary).toBe('Video Meeting');
      expect(response.event.conferenceData).toBeDefined();
      expect(response.event.conferenceData.entryPoints).toBeDefined();
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

  describe('Attachments and conference data handling', () => {
    it('should set supportsAttachments when clearing attachments', async () => {
      const mockUpdatedEvent = {
        id: 'event123',
        summary: 'Meeting'
      };

      mockCalendar.events.get.mockResolvedValue({ data: { recurrence: null } });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        attachments: []
      };

      await handler.runTool(args, mockOAuth2Client);

      const patchCall = mockCalendar.events.patch.mock.calls[0][0];
      expect(patchCall.requestBody.attachments).toEqual([]);
      expect(patchCall.supportsAttachments).toBe(true);
    });

    it('should set supportsAttachments when duplicating attachments for future instances', async () => {
      const originalEvent = {
        id: 'recurring123',
        recurrence: ['RRULE:FREQ=WEEKLY'],
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: originalEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'newEvent' } });

      const helpersStub = {
        getCalendar: () => mockCalendar,
        buildUpdateRequestBody: vi.fn().mockReturnValue({}),
        cleanEventForDuplication: vi.fn().mockReturnValue({
          attachments: [{ fileId: 'file1', fileUrl: 'https://drive.google.com/file1' }],
          recurrence: originalEvent.recurrence
        }),
        calculateEndTime: vi.fn().mockReturnValue('2025-02-01T11:00:00Z'),
        calculateUntilDate: vi.fn().mockReturnValue('20250131T100000Z'),
        updateRecurrenceWithUntil: vi.fn().mockReturnValue(['RRULE:FREQ=WEEKLY;UNTIL=20250131T100000Z'])
      } as unknown as RecurringEventHelpers;

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        futureStartDate: '2025-02-01T10:00:00-08:00',
        timeZone: 'America/Los_Angeles'
      } as UpdateEventInput;

      await (handler as any).updateFutureInstances(helpersStub, args, 'America/Los_Angeles');

      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      expect(insertCall.supportsAttachments).toBe(true);
      expect(insertCall.requestBody.attachments).toEqual([
        { fileId: 'file1', fileUrl: 'https://drive.google.com/file1' }
      ]);
    });

    it('should set conferenceDataVersion when duplicating conference data for future instances', async () => {
      const originalEvent = {
        id: 'recurring123',
        recurrence: ['RRULE:FREQ=WEEKLY'],
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
        conferenceData: {
          entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
          conferenceId: 'abc-defg-hij'
        }
      };

      mockCalendar.events.get.mockResolvedValue({ data: originalEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'newEvent' } });

      const helpersStub = {
        getCalendar: () => mockCalendar,
        buildUpdateRequestBody: vi.fn().mockReturnValue({}),
        cleanEventForDuplication: vi.fn().mockReturnValue({
          conferenceData: originalEvent.conferenceData,
          recurrence: originalEvent.recurrence
        }),
        calculateEndTime: vi.fn().mockReturnValue('2025-02-01T11:00:00Z'),
        calculateUntilDate: vi.fn().mockReturnValue('20250131T100000Z'),
        updateRecurrenceWithUntil: vi.fn().mockReturnValue(['RRULE:FREQ=WEEKLY;UNTIL=20250131T100000Z'])
      } as unknown as RecurringEventHelpers;

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        futureStartDate: '2025-02-01T10:00:00-08:00',
        timeZone: 'America/Los_Angeles'
      } as UpdateEventInput;

      await (handler as any).updateFutureInstances(helpersStub, args, 'America/Los_Angeles');

      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      expect(insertCall.conferenceDataVersion).toBe(1);
      expect(insertCall.requestBody.conferenceData).toEqual(originalEvent.conferenceData);
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
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'America/Los_Angeles', date: null },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'America/Los_Angeles', date: null }
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
          start: { dateTime: '2025-01-16T14:00:00', timeZone: 'UTC', date: null },
          end: { dateTime: '2025-01-16T15:00:00', timeZone: 'UTC', date: null }
        })
      });
    });
  });

  describe('All-day Event Conversion (Issue #118)', () => {
    it('should convert timed event to all-day event', async () => {
      const existingTimedEvent = {
        id: 'event123',
        summary: 'Timed Meeting',
        start: { dateTime: '2025-10-18T10:00:00-07:00' },
        end: { dateTime: '2025-10-18T11:00:00-07:00' }
      };

      const mockUpdatedAllDayEvent = {
        id: 'event123',
        summary: 'Timed Meeting',
        start: { date: '2025-10-18' },
        end: { date: '2025-10-19' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: existingTimedEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedAllDayEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        start: '2025-10-18',
        end: '2025-10-19'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      // Verify patch was called with correct all-day format
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        requestBody: expect.objectContaining({
          start: { date: '2025-10-18', dateTime: null },
          end: { date: '2025-10-19', dateTime: null }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.start.date).toBe('2025-10-18');
      expect(response.event.end.date).toBe('2025-10-19');
    });

    it('should convert all-day event to timed event', async () => {
      const existingAllDayEvent = {
        id: 'event456',
        summary: 'All Day Event',
        start: { date: '2025-10-18' },
        end: { date: '2025-10-19' }
      };

      const mockUpdatedTimedEvent = {
        id: 'event456',
        summary: 'All Day Event',
        start: { dateTime: '2025-10-18T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
        end: { dateTime: '2025-10-18T11:00:00-07:00', timeZone: 'America/Los_Angeles' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: existingAllDayEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedTimedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event456',
        start: '2025-10-18T10:00:00',
        end: '2025-10-18T11:00:00',
        timeZone: 'America/Los_Angeles'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      // Verify patch was called with correct timed format
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event456',
        requestBody: expect.objectContaining({
          start: { dateTime: '2025-10-18T10:00:00', timeZone: 'America/Los_Angeles', date: null },
          end: { dateTime: '2025-10-18T11:00:00', timeZone: 'America/Los_Angeles', date: null }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.start.dateTime).toBeDefined();
      expect(response.event.end.dateTime).toBeDefined();
    });

    it('should keep all-day event as all-day when updating', async () => {
      const existingAllDayEvent = {
        id: 'event789',
        summary: 'All Day Event',
        start: { date: '2025-10-18' },
        end: { date: '2025-10-19' }
      };

      const mockUpdatedAllDayEvent = {
        id: 'event789',
        summary: 'All Day Event',
        start: { date: '2025-10-20' },
        end: { date: '2025-10-21' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: existingAllDayEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedAllDayEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event789',
        start: '2025-10-20',
        end: '2025-10-21'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      // Verify patch was called with all-day format
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event789',
        requestBody: expect.objectContaining({
          start: { date: '2025-10-20', dateTime: null },
          end: { date: '2025-10-21', dateTime: null }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.start.date).toBe('2025-10-20');
      expect(response.event.end.date).toBe('2025-10-21');
    });

    it('should keep timed event as timed when updating', async () => {
      const existingTimedEvent = {
        id: 'event999',
        summary: 'Timed Meeting',
        start: { dateTime: '2025-10-18T10:00:00-07:00' },
        end: { dateTime: '2025-10-18T11:00:00-07:00' }
      };

      const mockUpdatedTimedEvent = {
        id: 'event999',
        summary: 'Timed Meeting',
        start: { dateTime: '2025-10-18T14:00:00-07:00', timeZone: 'America/Los_Angeles' },
        end: { dateTime: '2025-10-18T15:00:00-07:00', timeZone: 'America/Los_Angeles' }
      };

      mockCalendar.events.get.mockResolvedValue({ data: existingTimedEvent });
      mockCalendar.events.patch.mockResolvedValue({ data: mockUpdatedTimedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event999',
        start: '2025-10-18T14:00:00',
        end: '2025-10-18T15:00:00'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      // Verify patch was called with timed format
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event999',
        requestBody: expect.objectContaining({
          start: { dateTime: '2025-10-18T14:00:00', timeZone: 'America/Los_Angeles', date: null },
          end: { dateTime: '2025-10-18T15:00:00', timeZone: 'America/Los_Angeles', date: null }
        })
      });

      const response = JSON.parse((result.content[0] as any).text);
      expect(response.event).toBeDefined();
      expect(response.event.start.dateTime).toBeDefined();
      expect(response.event.end.dateTime).toBeDefined();
    });
  });
});
