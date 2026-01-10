import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
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

// Mock the event ID validator
vi.mock('../../../utils/event-id-validator.js', () => ({
  validateEventId: vi.fn((eventId: string) => {
    if (eventId && eventId.length < 5 || eventId.length > 1024) {
      throw new Error(`Invalid event ID: length must be between 5 and 1024 characters`);
    }
    if (eventId && !/^[a-zA-Z0-9-]+$/.test(eventId)) {
      throw new Error(`Invalid event ID: can only contain letters, numbers, and hyphens`);
    }
  })
}));

// Mock datetime utilities
vi.mock('../../../utils/datetime.js', () => ({
  hasTimezoneInDatetime: vi.fn((datetime: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)
  ),
  convertToRFC3339: vi.fn((datetime: string, timezone: string) => {
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

describe('CreateEventHandler', () => {
  let handler: CreateEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

    handler = new CreateEventHandler();
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

  describe('Basic Event Creation', () => {
    it('should create an event without custom ID', async () => {
      const mockCreatedEvent = {
        id: 'generated-id-123',
        summary: 'Test Event',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        htmlLink: 'https://calendar.google.com/event?eid=abc123'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Test Event',
          start: { dateTime: '2025-01-15T10:00:00', timeZone: 'America/Los_Angeles' },
          end: { dateTime: '2025-01-15T11:00:00', timeZone: 'America/Los_Angeles' }
        })
      });

      // Should not include id field when no custom ID provided
      expect(mockCalendar.events.insert.mock.calls[0][0].requestBody.id).toBeUndefined();

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBe('generated-id-123');
      expect(response.event.summary).toBe('Test Event');
    });

    it('should create event with all basic optional fields', async () => {
      const mockCreatedEvent = {
        id: 'full-event',
        summary: 'Full Event',
        description: 'Event description',
        location: 'Conference Room A',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        attendees: [{ email: 'test@example.com' }],
        colorId: '5',
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 30 }] }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'full-event',
        summary: 'Full Event',
        description: 'Event description',
        location: 'Conference Room A',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        attendees: [{ email: 'test@example.com' }],
        colorId: '5',
        reminders: {
          useDefault: false,
          overrides: [{ method: 'email' as const, minutes: 30 }]
        }
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          id: 'full-event',
          summary: 'Full Event',
          description: 'Event description',
          location: 'Conference Room A',
          attendees: [{ email: 'test@example.com' }],
          colorId: '5',
          reminders: {
            useDefault: false,
            overrides: [{ method: 'email', minutes: 30 }]
          }
        })
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();
    });
  });

  describe('Custom Event IDs', () => {
    it('should create an event with custom ID', async () => {
      const mockCreatedEvent = {
        id: 'customevent2025',
        summary: 'Test Event',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        htmlLink: 'https://calendar.google.com/event?eid=abc123'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'customevent2025',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          id: 'customevent2025',
          summary: 'Test Event',
          start: { dateTime: '2025-01-15T10:00:00', timeZone: 'America/Los_Angeles' },
          end: { dateTime: '2025-01-15T11:00:00', timeZone: 'America/Los_Angeles' }
        })
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();
    });

    it('should validate event ID before making API call', async () => {
      const args = {
        calendarId: 'primary',
        eventId: 'abc', // Too short (< 5 chars)
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Invalid event ID: length must be between 5 and 1024 characters'
      );

      // Should not call the API if validation fails
      expect(mockCalendar.events.insert).not.toHaveBeenCalled();
    });

    it('should handle invalid custom event ID', async () => {
      const args = {
        calendarId: 'primary',
        eventId: 'bad id', // Contains space
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Invalid event ID: can only contain letters, numbers, and hyphens'
      );

      expect(mockCalendar.events.insert).not.toHaveBeenCalled();
    });

    it('should handle event ID conflict (409 error)', async () => {
      const conflictError = new Error('Conflict');
      (conflictError as any).code = 409;
      mockCalendar.events.insert.mockRejectedValue(conflictError);

      const args = {
        calendarId: 'primary',
        eventId: 'existing-event',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        "Event ID 'existing-event' already exists. Please use a different ID."
      );
    });

    it('should handle event ID conflict with response status', async () => {
      const conflictError = new Error('Conflict');
      (conflictError as any).response = { status: 409 };
      mockCalendar.events.insert.mockRejectedValue(conflictError);

      const args = {
        calendarId: 'primary',
        eventId: 'existing-event',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        "Event ID 'existing-event' already exists. Please use a different ID."
      );
    });
  });

  describe('Guest Management Properties', () => {
    it('should create event with transparency setting', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Focus Time',
        transparency: 'transparent'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Focus Time',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        transparency: 'transparent' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            transparency: 'transparent'
          })
        })
      );
    });

    it('should create event with visibility settings', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Private Meeting',
        visibility: 'private'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Private Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        visibility: 'private' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            visibility: 'private'
          })
        })
      );
    });

    it('should create event with guest permissions', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Team Meeting'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Team Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        guestsCanInviteOthers: false,
        guestsCanModify: true,
        guestsCanSeeOtherGuests: false,
        anyoneCanAddSelf: true
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            guestsCanInviteOthers: false,
            guestsCanModify: true,
            guestsCanSeeOtherGuests: false,
            anyoneCanAddSelf: true
          })
        })
      );
    });

    it('should send update notifications when specified', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Meeting'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        sendUpdates: 'externalOnly' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sendUpdates: 'externalOnly'
        })
      );
    });
  });

  describe('Conference Data', () => {
    it('should create event with conference data', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Video Call',
        conferenceData: {
          entryPoints: [{ uri: 'https://meet.google.com/abc-defg-hij' }]
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Video Call',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        conferenceData: {
          createRequest: {
            requestId: 'unique-request-123',
            conferenceSolutionKey: {
              type: 'hangoutsMeet' as const
            }
          }
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            conferenceData: {
              createRequest: {
                requestId: 'unique-request-123',
                conferenceSolutionKey: {
                  type: 'hangoutsMeet'
                }
              }
            }
          }),
          conferenceDataVersion: 1
        })
      );
    });
  });

  describe('Extended Properties', () => {
    it('should create event with extended properties', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Custom Event'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Custom Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        extendedProperties: {
          private: {
            'appId': '12345',
            'customField': 'value1'
          },
          shared: {
            'projectId': 'proj-789',
            'category': 'meeting'
          }
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            extendedProperties: {
              private: {
                'appId': '12345',
                'customField': 'value1'
              },
              shared: {
                'projectId': 'proj-789',
                'category': 'meeting'
              }
            }
          })
        })
      );
    });
  });

  describe('Attachments', () => {
    it('should create event with attachments', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Meeting with Docs'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Meeting with Docs',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        attachments: [
          {
            fileUrl: 'https://docs.google.com/document/d/123',
            title: 'Meeting Agenda',
            mimeType: 'application/vnd.google-apps.document'
          },
          {
            fileUrl: 'https://drive.google.com/file/d/456',
            title: 'Presentation',
            mimeType: 'application/vnd.google-apps.presentation',
            fileId: '456'
          }
        ]
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            attachments: [
              {
                fileUrl: 'https://docs.google.com/document/d/123',
                title: 'Meeting Agenda',
                mimeType: 'application/vnd.google-apps.document'
              },
              {
                fileUrl: 'https://drive.google.com/file/d/456',
                title: 'Presentation',
                mimeType: 'application/vnd.google-apps.presentation',
                fileId: '456'
              }
            ]
          }),
          supportsAttachments: true
        })
      );
    });
  });

  describe('Enhanced Attendees', () => {
    it('should create event with detailed attendee information', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Team Sync'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Team Sync',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        attendees: [
          {
            email: 'alice@example.com',
            displayName: 'Alice Smith',
            optional: false,
            responseStatus: 'accepted' as const
          },
          {
            email: 'bob@example.com',
            displayName: 'Bob Jones',
            optional: true,
            responseStatus: 'needsAction' as const,
            comment: 'May join late',
            additionalGuests: 2
          }
        ]
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            attendees: [
              {
                email: 'alice@example.com',
                displayName: 'Alice Smith',
                optional: false,
                responseStatus: 'accepted'
              },
              {
                email: 'bob@example.com',
                displayName: 'Bob Jones',
                optional: true,
                responseStatus: 'needsAction',
                comment: 'May join late',
                additionalGuests: 2
              }
            ]
          })
        })
      );
    });
  });

  describe('Source Property', () => {
    it('should create event with source information', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Follow-up Meeting'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Follow-up Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        source: {
          url: 'https://example.com/meetings/123',
          title: 'Original Meeting Request'
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            source: {
              url: 'https://example.com/meetings/123',
              title: 'Original Meeting Request'
            }
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors other than 409', async () => {
      const apiError = new Error('API Error');
      (apiError as any).code = 500;
      mockCalendar.events.insert.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      // Mock handleGoogleApiError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Handled API Error');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Handled API Error');
    });

    it('should handle missing response data', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Failed to create event, no data returned'
      );
    });
  });

  describe('Combined Properties', () => {
    it('should create event with multiple enhanced properties', async () => {
      const mockCreatedEvent = {
        id: 'event123',
        summary: 'Complex Event'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'customcomplexevent',
        summary: 'Complex Event',
        description: 'An event with all features',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: 'Conference Room A',
        transparency: 'opaque' as const,
        visibility: 'public' as const,
        guestsCanInviteOthers: true,
        guestsCanModify: false,
        conferenceData: {
          createRequest: {
            requestId: 'conf-123',
            conferenceSolutionKey: {
              type: 'hangoutsMeet' as const
            }
          }
        },
        attendees: [
          {
            email: 'team@example.com',
            displayName: 'Team',
            optional: false
          }
        ],
        extendedProperties: {
          private: {
            'trackingId': '789'
          }
        },
        source: {
          url: 'https://example.com/source',
          title: 'Source System'
        },
        sendUpdates: 'all' as const
      };

      await handler.runTool(args, mockAccounts);

      const callArgs = mockCalendar.events.insert.mock.calls[0][0];
      
      expect(callArgs.requestBody).toMatchObject({
        id: 'customcomplexevent',
        summary: 'Complex Event',
        description: 'An event with all features',
        location: 'Conference Room A',
        transparency: 'opaque',
        visibility: 'public',
        guestsCanInviteOthers: true,
        guestsCanModify: false
      });
      
      expect(callArgs.conferenceDataVersion).toBe(1);
      expect(callArgs.sendUpdates).toBe('all');
    });
  });

  describe('Focus Time Events', () => {
    it('should create a focus time event with eventType', async () => {
      const mockCreatedEvent = {
        id: 'focus-time-123',
        summary: 'Focus Time',
        eventType: 'focusTime',
        transparency: 'opaque',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T12:00:00Z' }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Focus Time',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T12:00:00',
        eventType: 'focusTime' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            eventType: 'focusTime',
            transparency: 'opaque' // Auto-set for focusTime
          })
        })
      );
    });

    it('should auto-set transparency to opaque for focusTime events', async () => {
      const mockCreatedEvent = {
        id: 'focus-time-123',
        summary: 'Deep Work',
        eventType: 'focusTime',
        transparency: 'opaque'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Deep Work',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T16:00:00',
        eventType: 'focusTime' as const
        // Note: no transparency specified - should auto-set to opaque
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            transparency: 'opaque'
          })
        })
      );
    });

    it('should respect explicit transparency for focusTime events', async () => {
      const mockCreatedEvent = {
        id: 'focus-time-123',
        summary: 'Optional Focus',
        eventType: 'focusTime',
        transparency: 'transparent'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Optional Focus',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T16:00:00',
        eventType: 'focusTime' as const,
        transparency: 'transparent' as const // Explicitly set to transparent
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            transparency: 'transparent'
          })
        })
      );
    });

    it('should create focus time event with focusTimeProperties', async () => {
      const mockCreatedEvent = {
        id: 'focus-time-123',
        summary: 'Focus Time',
        eventType: 'focusTime',
        focusTimeProperties: {
          autoDeclineMode: 'declineAllConflictingInvitations',
          chatStatus: 'doNotDisturb',
          declineMessage: 'I am in focus time'
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Focus Time',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T12:00:00',
        eventType: 'focusTime' as const,
        focusTimeProperties: {
          autoDeclineMode: 'declineAllConflictingInvitations' as const,
          chatStatus: 'doNotDisturb' as const,
          declineMessage: 'I am in focus time'
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            eventType: 'focusTime',
            focusTimeProperties: {
              autoDeclineMode: 'declineAllConflictingInvitations',
              chatStatus: 'doNotDisturb',
              declineMessage: 'I am in focus time'
            }
          })
        })
      );
    });
  });

  describe('Out of Office Events', () => {
    it('should create an out of office event with eventType', async () => {
      const mockCreatedEvent = {
        id: 'ooo-123',
        summary: 'Out of office',
        eventType: 'outOfOffice',
        transparency: 'opaque',
        start: { dateTime: '2025-01-15T09:00:00Z' },
        end: { dateTime: '2025-01-15T17:00:00Z' }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Out of office',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'outOfOffice' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            eventType: 'outOfOffice',
            transparency: 'opaque', // Auto-set for outOfOffice
            outOfOfficeProperties: {
              autoDeclineMode: 'declineAllConflictingInvitations'
            }
          })
        })
      );
    });

    it('should create out of office event with outOfOfficeProperties', async () => {
      const mockCreatedEvent = {
        id: 'ooo-123',
        summary: 'Vacation',
        eventType: 'outOfOffice',
        outOfOfficeProperties: {
          autoDeclineMode: 'declineOnlyNewConflictingInvitations',
          declineMessage: 'I am on vacation'
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Vacation',
        start: '2025-01-15T09:00:00',
        end: '2025-01-20T17:00:00',
        eventType: 'outOfOffice' as const,
        outOfOfficeProperties: {
          autoDeclineMode: 'declineOnlyNewConflictingInvitations' as const,
          declineMessage: 'I am on vacation'
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            eventType: 'outOfOffice',
            outOfOfficeProperties: {
              autoDeclineMode: 'declineOnlyNewConflictingInvitations',
              declineMessage: 'I am on vacation'
            }
          })
        })
      );
    });

    it('should reject out of office events on non-primary calendar', async () => {
      // Override the mock to return a non-primary calendar
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
        client: mockOAuth2Client,
        accountId: 'test',
        calendarId: 'secondary-calendar',
        wasAutoSelected: true
      });

      const args = {
        calendarId: 'secondary-calendar',
        summary: 'Out of office',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'outOfOffice' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Out of Office events can only be created on the primary calendar'
      );
    });
  });

  describe('Working Location Events', () => {
    it('should create a working location event for home office', async () => {
      const mockCreatedEvent = {
        id: 'wl-123',
        summary: 'Working from home',
        eventType: 'workingLocation',
        transparency: 'transparent',
        visibility: 'public',
        start: { dateTime: '2025-01-15T09:00:00Z' },
        end: { dateTime: '2025-01-15T17:00:00Z' }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const,
        workingLocationProperties: {
          type: 'homeOffice' as const
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from home', // Auto-generated
            eventType: 'workingLocation',
            transparency: 'transparent', // Auto-set for workingLocation
            visibility: 'public', // Auto-set for workingLocation
            workingLocationProperties: {
              type: 'homeOffice',
              homeOffice: {}
            }
          })
        })
      );
    });

    it('should create a working location event for office location', async () => {
      const mockCreatedEvent = {
        id: 'wl-123',
        summary: 'Working from HQ',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const,
        workingLocationProperties: {
          type: 'officeLocation' as const,
          officeLocation: {
            label: 'HQ',
            buildingId: 'building-1',
            floorId: '3'
          }
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from HQ', // Auto-generated from label
            eventType: 'workingLocation',
            workingLocationProperties: {
              type: 'officeLocation',
              officeLocation: {
                label: 'HQ',
                buildingId: 'building-1',
                floorId: '3'
              }
            }
          })
        })
      );
    });

    it('should create a working location event for custom location', async () => {
      const mockCreatedEvent = {
        id: 'wl-123',
        summary: 'Working from Coffee Shop',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const,
        workingLocationProperties: {
          type: 'customLocation' as const,
          customLocation: {
            label: 'Coffee Shop'
          }
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from Coffee Shop', // Auto-generated from label
            eventType: 'workingLocation',
            workingLocationProperties: {
              type: 'customLocation',
              customLocation: {
                label: 'Coffee Shop'
              }
            }
          })
        })
      );
    });

    it('should use custom summary if provided for working location', async () => {
      const mockCreatedEvent = {
        id: 'wl-123',
        summary: 'Remote Day',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Remote Day', // Custom summary
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const,
        workingLocationProperties: {
          type: 'homeOffice' as const
        }
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Remote Day' // Uses provided summary
          })
        })
      );
    });

    it('should reject working location events on non-primary calendar', async () => {
      // Override the mock to return a non-primary calendar
      vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
        client: mockOAuth2Client,
        accountId: 'test',
        calendarId: 'secondary-calendar',
        wasAutoSelected: true
      });

      const args = {
        calendarId: 'secondary-calendar',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const,
        workingLocationProperties: {
          type: 'homeOffice' as const
        }
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'Working Location events can only be created on the primary calendar'
      );
    });

    it('should require workingLocationProperties when eventType is workingLocation', async () => {
      const args = {
        calendarId: 'primary',
        summary: 'Working',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        eventType: 'workingLocation' as const
        // Missing workingLocationProperties
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'workingLocationProperties is required when eventType is "workingLocation"'
      );
    });
  });
});