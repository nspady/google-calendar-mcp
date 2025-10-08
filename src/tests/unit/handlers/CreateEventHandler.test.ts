import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';

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
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({ 
    dateTime: datetime,
    timeZone: timezone 
  }))
}));

describe('CreateEventHandler', () => {
  let handler: CreateEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new CreateEventHandler();
    mockOAuth2Client = new OAuth2Client();
    
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

      const result = await handler.runTool(args, mockOAuth2Client);

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

      const result = await handler.runTool(args, mockOAuth2Client);

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

      const result = await handler.runTool(args, mockOAuth2Client);

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

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
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

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
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

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
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

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await handler.runTool(args, mockOAuth2Client);

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

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow('Handled API Error');
    });

    it('should handle missing response data', async () => {
      mockCalendar.events.insert.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00'
      };

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
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

      await handler.runTool(args, mockOAuth2Client);

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
});