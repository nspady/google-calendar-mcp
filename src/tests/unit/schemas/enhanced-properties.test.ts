import { describe, it, expect } from 'vitest';
import { ToolSchemas } from '../../../tools/registry.js';

describe('Enhanced Create-Event Properties', () => {
  const createEventSchema = ToolSchemas['create-event'];
  
  const baseEvent = {
    calendarId: 'primary',
    summary: 'Test Event',
    start: '2025-01-20T10:00:00',
    end: '2025-01-20T11:00:00'
  };

  describe('Guest Management Properties', () => {
    it('should accept transparency values', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        transparency: 'opaque'
      })).not.toThrow();
      
      expect(() => createEventSchema.parse({
        ...baseEvent,
        transparency: 'transparent'
      })).not.toThrow();
    });

    it('should reject invalid transparency values', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        transparency: 'invalid'
      })).toThrow();
    });

    it('should accept visibility values', () => {
      const validVisibilities = ['default', 'public', 'private', 'confidential'];
      validVisibilities.forEach(visibility => {
        expect(() => createEventSchema.parse({
          ...baseEvent,
          visibility
        })).not.toThrow();
      });
    });

    it('should accept guest permission booleans', () => {
      const event = {
        ...baseEvent,
        guestsCanInviteOthers: false,
        guestsCanModify: true,
        guestsCanSeeOtherGuests: false,
        anyoneCanAddSelf: true
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept sendUpdates values', () => {
      const validSendUpdates = ['all', 'externalOnly', 'none'];
      validSendUpdates.forEach(sendUpdates => {
        expect(() => createEventSchema.parse({
          ...baseEvent,
          sendUpdates
        })).not.toThrow();
      });
    });
  });

  describe('Conference Data', () => {
    it('should accept valid conference data', () => {
      const event = {
        ...baseEvent,
        conferenceData: {
          createRequest: {
            requestId: 'unique-123',
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept all conference solution types', () => {
      const types = ['hangoutsMeet', 'eventHangout', 'eventNamedHangout', 'addOn'];
      types.forEach(type => {
        const event = {
          ...baseEvent,
          conferenceData: {
            createRequest: {
              requestId: `req-${type}`,
              conferenceSolutionKey: { type }
            }
          }
        };
        expect(() => createEventSchema.parse(event)).not.toThrow();
      });
    });

    it('should reject conference data without required fields', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        conferenceData: {
          createRequest: {
            requestId: 'test'
            // Missing conferenceSolutionKey
          }
        }
      })).toThrow();
    });
  });

  describe('Extended Properties', () => {
    it('should accept extended properties', () => {
      const event = {
        ...baseEvent,
        extendedProperties: {
          private: {
            key1: 'value1',
            key2: 'value2'
          },
          shared: {
            sharedKey: 'sharedValue'
          }
        }
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept only private properties', () => {
      const event = {
        ...baseEvent,
        extendedProperties: {
          private: { app: 'myapp' }
        }
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept only shared properties', () => {
      const event = {
        ...baseEvent,
        extendedProperties: {
          shared: { category: 'meeting' }
        }
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept empty extended properties object', () => {
      const event = {
        ...baseEvent,
        extendedProperties: {}
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });
  });

  describe('Attachments', () => {
    it('should accept attachments array', () => {
      const event = {
        ...baseEvent,
        attachments: [
          {
            fileUrl: 'https://example.com/file.pdf',
            title: 'Document',
            mimeType: 'application/pdf',
            iconLink: 'https://example.com/icon.png',
            fileId: 'file123'
          }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept minimal attachment (only fileUrl)', () => {
      const event = {
        ...baseEvent,
        attachments: [
          { fileUrl: 'https://example.com/file.pdf' }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept multiple attachments', () => {
      const event = {
        ...baseEvent,
        attachments: [
          { fileUrl: 'https://example.com/file1.pdf' },
          { fileUrl: 'https://example.com/file2.doc', title: 'Doc' },
          { fileUrl: 'https://example.com/file3.xls', mimeType: 'application/excel' }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should reject attachments without fileUrl', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        attachments: [
          { title: 'Document' } // Missing fileUrl
        ]
      })).toThrow();
    });
  });

  describe('Enhanced Attendees', () => {
    it('should accept attendees with all optional fields', () => {
      const event = {
        ...baseEvent,
        attendees: [
          {
            email: 'test@example.com',
            displayName: 'Test User',
            optional: true,
            responseStatus: 'accepted',
            comment: 'Looking forward to it',
            additionalGuests: 2
          }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should accept all response status values', () => {
      const statuses = ['needsAction', 'declined', 'tentative', 'accepted'];
      statuses.forEach(responseStatus => {
        const event = {
          ...baseEvent,
          attendees: [
            { email: 'test@example.com', responseStatus }
          ]
        };
        expect(() => createEventSchema.parse(event)).not.toThrow();
      });
    });

    it('should accept attendees with only email', () => {
      const event = {
        ...baseEvent,
        attendees: [
          { email: 'minimal@example.com' }
        ]
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should reject attendees without email', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        attendees: [
          { displayName: 'No Email User' }
        ]
      })).toThrow();
    });

    it('should reject negative additional guests', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        attendees: [
          { email: 'test@example.com', additionalGuests: -1 }
        ]
      })).toThrow();
    });
  });

  describe('Source Property', () => {
    it('should accept source with url and title', () => {
      const event = {
        ...baseEvent,
        source: {
          url: 'https://example.com/event/123',
          title: 'External Event System'
        }
      };
      expect(() => createEventSchema.parse(event)).not.toThrow();
    });

    it('should reject source without url', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        source: { title: 'No URL' }
      })).toThrow();
    });

    it('should reject source without title', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        source: { url: 'https://example.com' }
      })).toThrow();
    });
  });

  describe('Combined Properties', () => {
    it('should accept event with all enhanced properties', () => {
      const complexEvent = {
        ...baseEvent,
        eventId: 'custom-id-123',
        description: 'Complex event with all features',
        location: 'Conference Room',
        transparency: 'opaque',
        visibility: 'public',
        guestsCanInviteOthers: true,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: true,
        anyoneCanAddSelf: false,
        sendUpdates: 'all',
        conferenceData: {
          createRequest: {
            requestId: 'conf-123',
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        extendedProperties: {
          private: { appId: '123' },
          shared: { category: 'meeting' }
        },
        attachments: [
          { fileUrl: 'https://example.com/agenda.pdf', title: 'Agenda' }
        ],
        attendees: [
          {
            email: 'alice@example.com',
            displayName: 'Alice',
            optional: false,
            responseStatus: 'accepted'
          },
          {
            email: 'bob@example.com',
            displayName: 'Bob',
            optional: true,
            responseStatus: 'tentative',
            additionalGuests: 1
          }
        ],
        source: {
          url: 'https://example.com/source',
          title: 'Source System'
        },
        colorId: '5',
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 15 }]
        }
      };
      
      expect(() => createEventSchema.parse(complexEvent)).not.toThrow();
    });

    it('should maintain backward compatibility with minimal event', () => {
      // Only required fields
      const minimalEvent = {
        calendarId: 'primary',
        summary: 'Simple Event',
        start: '2025-01-20T10:00:00',
        end: '2025-01-20T11:00:00'
      };
      
      expect(() => createEventSchema.parse(minimalEvent)).not.toThrow();
    });
  });


  describe('Event Labels', () => {
    it('should accept an eventLabelId', () => {
      expect(() => createEventSchema.parse({
        ...baseEvent,
        eventLabelId: '22222222-3333-4444-5555-666666666666'
      })).not.toThrow();
    });

    it('should reject an empty eventLabelId, which would only suppress colorId on create', () => {
      expect(() => createEventSchema.parse({ ...baseEvent, eventLabelId: '' })).toThrow();
    });

    it('should accept an empty eventLabelId on update to remove the label', () => {
      expect(() => ToolSchemas['update-event'].parse({
        calendarId: 'primary',
        eventId: 'event123',
        eventLabelId: ''
      })).not.toThrow();
    });
  });
});
