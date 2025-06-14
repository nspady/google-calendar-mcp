import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';

// Enhanced UpdateEventHandler class that will be implemented
class EnhancedUpdateEventHandler {
  private calendar: calendar_v3.Calendar;

  constructor(calendar: calendar_v3.Calendar) {
    this.calendar = calendar;
  }

  async runTool(args: any, oauth2Client: OAuth2Client): Promise<any> {
    // This would use the enhanced schema for validation
    const event = await this.updateEventWithScope(args);
    return {
      content: [{
        type: "text",
        text: `Event updated: ${event.summary} (${event.id})`,
      }],
    };
  }

  async updateEventWithScope(args: any): Promise<calendar_v3.Schema$Event> {
    const eventType = await this.detectEventType(args.eventId, args.calendarId);
    
    // Validate scope usage
    if (args.modificationScope !== 'all' && eventType !== 'recurring') {
      throw new Error('Scope other than "all" only applies to recurring events');
    }
    
    switch (args.modificationScope || 'all') {
      case 'single':
        return this.updateSingleInstance(args);
      case 'all':
        return this.updateAllInstances(args);
      case 'future':
        return this.updateFutureInstances(args);
      default:
        throw new Error(`Invalid modification scope: ${args.modificationScope}`);
    }
  }

  private async detectEventType(eventId: string, calendarId: string): Promise<'recurring' | 'single'> {
    const response = await this.calendar.events.get({
      calendarId,
      eventId
    });

    const event = response.data;
    return event.recurrence && event.recurrence.length > 0 ? 'recurring' : 'single';
  }

  async updateSingleInstance(args: any): Promise<calendar_v3.Schema$Event> {
    // Format instance ID: eventId_basicTimeFormat (convert to UTC first)
    const utcDate = new Date(args.originalStartTime);
    const basicTimeFormat = utcDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const instanceId = `${args.eventId}_${basicTimeFormat}`;
    
    const response = await this.calendar.events.patch({
      calendarId: args.calendarId,
      eventId: instanceId,
      requestBody: this.buildUpdateRequestBody(args)
    });

    if (!response.data) throw new Error('Failed to update event instance');
    return response.data;
  }

  async updateAllInstances(args: any): Promise<calendar_v3.Schema$Event> {
    const response = await this.calendar.events.patch({
      calendarId: args.calendarId,
      eventId: args.eventId,
      requestBody: this.buildUpdateRequestBody(args)
    });

    if (!response.data) throw new Error('Failed to update event');
    return response.data;
  }

  async updateFutureInstances(args: any): Promise<calendar_v3.Schema$Event> {
    // 1. Get original event
    const originalResponse = await this.calendar.events.get({
      calendarId: args.calendarId,
      eventId: args.eventId
    });
    const originalEvent = originalResponse.data;

    if (!originalEvent.recurrence) {
      throw new Error('Event does not have recurrence rules');
    }

    // 2. Calculate UNTIL date (one day before future start date)
    const futureDate = new Date(args.futureStartDate);
    const untilDate = new Date(futureDate.getTime() - 86400000); // -1 day
    const untilString = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    // 3. Update original event with UNTIL clause
    const updatedRRule = originalEvent.recurrence[0]
      .replace(/;UNTIL=\d{8}T\d{6}Z/g, '')
      .replace(/;COUNT=\d+/g, '') + `;UNTIL=${untilString}`;

    await this.calendar.events.patch({
      calendarId: args.calendarId,
      eventId: args.eventId,
      requestBody: { recurrence: [updatedRRule] }
    });

    // 4. Create new recurring event starting from future date
    const newEvent = {
      ...originalEvent,
      ...this.buildUpdateRequestBody(args),
      start: { 
        dateTime: args.futureStartDate, 
        timeZone: args.timeZone 
      },
      end: { 
        dateTime: this.calculateEndTime(args.futureStartDate, originalEvent), 
        timeZone: args.timeZone 
      }
    };

    // Clean fields that shouldn't be duplicated
    delete newEvent.id;
    delete newEvent.etag;
    delete newEvent.iCalUID;
    delete newEvent.created;
    delete newEvent.updated;
    delete newEvent.htmlLink;
    delete newEvent.hangoutLink;

    const response = await this.calendar.events.insert({
      calendarId: args.calendarId,
      requestBody: newEvent
    });

    if (!response.data) throw new Error('Failed to create new recurring event');
    return response.data;
  }

  private calculateEndTime(newStartTime: string, originalEvent: calendar_v3.Schema$Event): string {
    const newStart = new Date(newStartTime);
    const originalStart = new Date(originalEvent.start!.dateTime!);
    const originalEnd = new Date(originalEvent.end!.dateTime!);
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    return new Date(newStart.getTime() + duration).toISOString();
  }

  private buildUpdateRequestBody(args: any): calendar_v3.Schema$Event {
    const requestBody: calendar_v3.Schema$Event = {};

    if (args.summary !== undefined && args.summary !== null) requestBody.summary = args.summary;
    if (args.description !== undefined && args.description !== null) requestBody.description = args.description;
    if (args.location !== undefined && args.location !== null) requestBody.location = args.location;
    if (args.colorId !== undefined && args.colorId !== null) requestBody.colorId = args.colorId;
    if (args.attendees !== undefined && args.attendees !== null) requestBody.attendees = args.attendees;
    if (args.reminders !== undefined && args.reminders !== null) requestBody.reminders = args.reminders;
    if (args.recurrence !== undefined && args.recurrence !== null) requestBody.recurrence = args.recurrence;

    // Handle time changes
    let timeChanged = false;
    if (args.start !== undefined && args.start !== null) {
      requestBody.start = { dateTime: args.start, timeZone: args.timeZone };
      timeChanged = true;
    }
    if (args.end !== undefined && args.end !== null) {
      requestBody.end = { dateTime: args.end, timeZone: args.timeZone };
      timeChanged = true;
    }

    // Only add timezone objects if there were actual time changes, OR if neither start/end provided but timezone is given
    if (timeChanged || (!args.start && !args.end && args.timeZone)) {
      if (!requestBody.start) requestBody.start = {};
      if (!requestBody.end) requestBody.end = {};
      if (!requestBody.start.timeZone) requestBody.start.timeZone = args.timeZone;
      if (!requestBody.end.timeZone) requestBody.end.timeZone = args.timeZone;
    }

    return requestBody;
  }
}

// Custom error class for recurring event errors
class RecurringEventError extends Error {
  public code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RecurringEventError';
    this.code = code;
  }
}

const ERRORS = {
  INVALID_SCOPE: 'INVALID_MODIFICATION_SCOPE',
  MISSING_ORIGINAL_TIME: 'MISSING_ORIGINAL_START_TIME',
  MISSING_FUTURE_DATE: 'MISSING_FUTURE_START_DATE',
  PAST_FUTURE_DATE: 'FUTURE_DATE_IN_PAST',
  NON_RECURRING_SCOPE: 'SCOPE_NOT_APPLICABLE_TO_SINGLE_EVENT'
};

describe('Enhanced UpdateEventHandler', () => {
  let handler: EnhancedUpdateEventHandler;
  let mockCalendar: any;
  let mockOAuth2Client: OAuth2Client;

  beforeEach(() => {
    mockCalendar = {
      events: {
        get: vi.fn(),
        patch: vi.fn(),
        insert: vi.fn()
      }
    };
    handler = new EnhancedUpdateEventHandler(mockCalendar);
    mockOAuth2Client = {} as OAuth2Client;
  });

  describe('updateEventWithScope', () => {
    it('should detect event type and route to appropriate method', async () => {
      const recurringEvent = {
        data: {
          id: 'recurring123',
          summary: 'Weekly Meeting',
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO']
        }
      };
      mockCalendar.events.get.mockResolvedValue(recurringEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: recurringEvent.data });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'all',
        summary: 'Updated Meeting'
      };

      await handler.updateEventWithScope(args);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123'
      });
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123',
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting'
        })
      });
    });

    it('should throw error when using non-"all" scope on single events', async () => {
      const singleEvent = {
        data: {
          id: 'single123',
          summary: 'One-time Meeting'
          // no recurrence
        }
      };
      mockCalendar.events.get.mockResolvedValue(singleEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'single123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'single',
        originalStartTime: '2024-06-15T10:00:00-07:00'
      };

      await expect(handler.updateEventWithScope(args))
        .rejects.toThrow('Scope other than "all" only applies to recurring events');
    });

    it('should default to "all" scope when not specified', async () => {
      const recurringEvent = {
        data: {
          id: 'recurring123',
          recurrence: ['RRULE:FREQ=WEEKLY']
        }
      };
      mockCalendar.events.get.mockResolvedValue(recurringEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: recurringEvent.data });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'UTC',
        summary: 'Updated Meeting'
        // no modificationScope specified
      };

      await handler.updateEventWithScope(args);

      // Should call updateAllInstances (patch with master event ID)
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123',
        requestBody: expect.any(Object)
      });
    });
  });

  describe('updateSingleInstance', () => {
    it('should format instance ID correctly and patch specific instance', async () => {
      const mockInstanceEvent = {
        data: {
          id: 'recurring123_20240615T170000Z',
          summary: 'Updated Instance'
        }
      };
      mockCalendar.events.patch.mockResolvedValue(mockInstanceEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'single',
        originalStartTime: '2024-06-15T10:00:00-07:00',
        summary: 'Updated Instance'
      };

      const result = await handler.updateSingleInstance(args);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123_20240615T170000Z',
        requestBody: expect.objectContaining({
          summary: 'Updated Instance'
        })
      });
      expect(result.summary).toBe('Updated Instance');
    });

    it('should handle different timezone formats in originalStartTime', async () => {
      const testCases = [
        {
          originalStartTime: '2024-06-15T10:00:00Z',
          expectedInstanceId: 'event123_20240615T100000Z'
        },
        {
          originalStartTime: '2024-06-15T10:00:00+05:30',
          expectedInstanceId: 'event123_20240615T043000Z'
        },
        {
          originalStartTime: '2024-06-15T10:00:00.000-08:00',
          expectedInstanceId: 'event123_20240615T180000Z'
        }
      ];

      for (const testCase of testCases) {
        mockCalendar.events.patch.mockClear();
        mockCalendar.events.patch.mockResolvedValue({ data: { id: testCase.expectedInstanceId } });

        const args = {
          calendarId: 'primary',
          eventId: 'event123',
          timeZone: 'UTC',
          originalStartTime: testCase.originalStartTime,
          summary: 'Test'
        };

        await handler.updateSingleInstance(args);

        expect(mockCalendar.events.patch).toHaveBeenCalledWith({
          calendarId: 'primary',
          eventId: testCase.expectedInstanceId,
          requestBody: expect.any(Object)
        });
      }
    });

    it('should throw error if patch fails', async () => {
      mockCalendar.events.patch.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        originalStartTime: '2024-06-15T10:00:00Z',
        timeZone: 'UTC'
      };

      await expect(handler.updateSingleInstance(args))
        .rejects.toThrow('Failed to update event instance');
    });
  });

  describe('updateAllInstances', () => {
    it('should patch master event with all modifications', async () => {
      const mockUpdatedEvent = {
        data: {
          id: 'recurring123',
          summary: 'Updated Weekly Meeting',
          location: 'New Conference Room'
        }
      };
      mockCalendar.events.patch.mockResolvedValue(mockUpdatedEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'all',
        summary: 'Updated Weekly Meeting',
        location: 'New Conference Room',
        colorId: '9'
      };

      const result = await handler.updateAllInstances(args);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123',
        requestBody: expect.objectContaining({
          summary: 'Updated Weekly Meeting',
          location: 'New Conference Room',
          colorId: '9'
        })
      });
      expect(result.summary).toBe('Updated Weekly Meeting');
    });

    it('should handle timezone changes for recurring events', async () => {
      const mockEvent = { data: { id: 'recurring123' } };
      mockCalendar.events.patch.mockResolvedValue(mockEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'Europe/London',
        start: '2024-06-15T09:00:00+01:00',
        end: '2024-06-15T10:00:00+01:00'
      };

      await handler.updateAllInstances(args);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123',
        requestBody: expect.objectContaining({
          start: {
            dateTime: '2024-06-15T09:00:00+01:00',
            timeZone: 'Europe/London'
          },
          end: {
            dateTime: '2024-06-15T10:00:00+01:00',
            timeZone: 'Europe/London'
          }
        })
      });
    });
  });

  describe('updateFutureInstances', () => {
    it('should split recurring series correctly', async () => {
      const originalEvent = {
        data: {
          id: 'recurring123',
          summary: 'Weekly Meeting',
          start: { dateTime: '2024-06-01T10:00:00-07:00' },
          end: { dateTime: '2024-06-01T11:00:00-07:00' },
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=20'],
          attendees: [{ email: 'user@example.com' }]
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(originalEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      
      const newEvent = {
        data: {
          id: 'new_recurring456',
          summary: 'Updated Future Meeting'
        }
      };
      mockCalendar.events.insert.mockResolvedValue(newEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'future',
        futureStartDate: '2024-06-15T10:00:00-07:00',
        summary: 'Updated Future Meeting',
        location: 'New Location'
      };

      const result = await handler.updateFutureInstances(args);

      // Should update original event with UNTIL clause
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring123',
        requestBody: {
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240614T170000Z']
        }
      });

      // Should create new recurring event
      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Updated Future Meeting',
          location: 'New Location',
          start: {
            dateTime: '2024-06-15T10:00:00-07:00',
            timeZone: 'America/Los_Angeles'
          },
          end: {
            dateTime: expect.any(String),
            timeZone: 'America/Los_Angeles'
          },
          attendees: [{ email: 'user@example.com' }]
        })
      });

      // Should not include system fields
      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.id).toBeUndefined();
      expect(insertCall.requestBody.etag).toBeUndefined();
      expect(insertCall.requestBody.iCalUID).toBeUndefined();

      expect(result.summary).toBe('Updated Future Meeting');
    });

    it('should calculate end time correctly based on original duration', async () => {
      const originalEvent = {
        data: {
          id: 'recurring123',
          start: { dateTime: '2024-06-01T10:00:00-07:00' },
          end: { dateTime: '2024-06-01T12:30:00-07:00' }, // 2.5 hour duration
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO']
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(originalEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        timeZone: 'America/Los_Angeles',
        futureStartDate: '2024-06-15T14:00:00-07:00'
      };

      await handler.updateFutureInstances(args);

      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      const endDateTime = new Date(insertCall.requestBody.end.dateTime);
      const startDateTime = new Date(insertCall.requestBody.start.dateTime);
      const duration = endDateTime.getTime() - startDateTime.getTime();
      
      // Should maintain 2.5 hour duration (9000000 ms)
      expect(duration).toBe(2.5 * 60 * 60 * 1000);
    });

    it('should handle events without recurrence', async () => {
      const singleEvent = {
        data: {
          id: 'single123',
          summary: 'One-time Meeting'
          // no recurrence
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(singleEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'single123',
        futureStartDate: '2024-06-15T10:00:00-07:00',
        timeZone: 'UTC'
      };

      await expect(handler.updateFutureInstances(args))
        .rejects.toThrow('Event does not have recurrence rules');
    });

    it('should handle existing UNTIL and COUNT clauses correctly', async () => {
      const testCases = [
        {
          original: 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240531T170000Z',
          expected: 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240614T170000Z'
        },
        {
          original: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10',
          expected: 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240614T170000Z'
        },
        {
          original: 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=15;BYHOUR=10',
          expected: 'RRULE:FREQ=DAILY;INTERVAL=2;BYHOUR=10;UNTIL=20240614T170000Z'
        }
      ];

      for (const testCase of testCases) {
        const originalEvent = {
          data: {
            id: 'test',
            start: { dateTime: '2024-06-01T10:00:00-07:00' },
            end: { dateTime: '2024-06-01T11:00:00-07:00' },
            recurrence: [testCase.original]
          }
        };

        mockCalendar.events.get.mockResolvedValue(originalEvent);
        mockCalendar.events.patch.mockClear();
        mockCalendar.events.patch.mockResolvedValue({ data: {} });
        mockCalendar.events.insert.mockResolvedValue({ data: {} });

        const args = {
          calendarId: 'primary',
          eventId: 'test',
          futureStartDate: '2024-06-15T10:00:00-07:00',
          timeZone: 'America/Los_Angeles'
        };

        await handler.updateFutureInstances(args);

        expect(mockCalendar.events.patch).toHaveBeenCalledWith({
          calendarId: 'primary',
          eventId: 'test',
          requestBody: {
            recurrence: [testCase.expected]
          }
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle Google API errors gracefully', async () => {
      mockCalendar.events.get.mockRejectedValue(new Error('Event not found'));

      const args = {
        calendarId: 'primary',
        eventId: 'nonexistent',
        timeZone: 'UTC'
      };

      await expect(handler.updateEventWithScope(args))
        .rejects.toThrow('Event not found');
    });

    it('should handle patch failures for single instances', async () => {
      mockCalendar.events.patch.mockRejectedValue(new Error('Instance not found'));

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        originalStartTime: '2024-06-15T10:00:00Z',
        timeZone: 'UTC'
      };

      await expect(handler.updateSingleInstance(args))
        .rejects.toThrow('Instance not found');
    });

    it('should handle insert failures for future instances', async () => {
      const originalEvent = {
        data: {
          id: 'recurring123',
          start: { dateTime: '2024-06-01T10:00:00Z' },
          end: { dateTime: '2024-06-01T11:00:00Z' },
          recurrence: ['RRULE:FREQ=WEEKLY']
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(originalEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'recurring123',
        futureStartDate: '2024-06-15T10:00:00Z',
        timeZone: 'UTC'
      };

      await expect(handler.updateFutureInstances(args))
        .rejects.toThrow('Failed to create new recurring event');
    });
  });

  describe('Integration with Tool Framework', () => {
    it('should return proper response format from runTool', async () => {
      const mockEvent = {
        data: {
          id: 'event123',
          summary: 'Updated Meeting',
          recurrence: ['RRULE:FREQ=WEEKLY']
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(mockEvent);
      mockCalendar.events.patch.mockResolvedValue(mockEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'UTC',
        summary: 'Updated Meeting'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(result).toEqual({
        content: [{
          type: "text",
          text: "Event updated: Updated Meeting (event123)"
        }]
      });
    });
  });

  describe('Edge Cases and Additional Scenarios', () => {
    it('should handle events with complex recurrence patterns', async () => {
      const complexRecurringEvent = {
        data: {
          id: 'complex123',
          summary: 'Complex Meeting',
          start: { dateTime: '2024-06-01T10:00:00Z' },
          end: { dateTime: '2024-06-01T11:00:00Z' },
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;BYHOUR=10;BYMINUTE=0']
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(complexRecurringEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'new_complex456' } });

      const args = {
        calendarId: 'primary',
        eventId: 'complex123',
        timeZone: 'UTC',
        modificationScope: 'future',
        futureStartDate: '2024-06-15T10:00:00Z',
        summary: 'Updated Complex Meeting'
      };

      const result = await handler.updateFutureInstances(args);

      // Should handle complex recurrence rules correctly
      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'complex123',
        requestBody: {
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;BYHOUR=10;BYMINUTE=0;UNTIL=20240614T100000Z']
        }
      });
    });

    it('should handle timezone changes across DST boundaries', async () => {
      const mockEvent = { data: { id: 'dst123' } };
      mockCalendar.events.patch.mockResolvedValue(mockEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'dst123',
        timeZone: 'America/New_York',
        modificationScope: 'all',
        start: '2024-03-10T07:00:00-05:00', // DST transition date
        end: '2024-03-10T08:00:00-05:00'
      };

      await handler.updateAllInstances(args);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'dst123',
        requestBody: expect.objectContaining({
          start: {
            dateTime: '2024-03-10T07:00:00-05:00',
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: '2024-03-10T08:00:00-05:00',
            timeZone: 'America/New_York'
          }
        })
      });
    });

    it('should handle very long recurrence series', async () => {
      const longRecurringEvent = {
        data: {
          id: 'long123',
          start: { dateTime: '2024-01-01T10:00:00Z' },
          end: { dateTime: '2024-01-01T11:00:00Z' },
          recurrence: ['RRULE:FREQ=DAILY;COUNT=365'] // Daily for a year
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(longRecurringEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'new_long456' } });

      const args = {
        calendarId: 'primary',
        eventId: 'long123',
        timeZone: 'UTC',
        modificationScope: 'future',
        futureStartDate: '2024-06-01T10:00:00Z'
      };

      await handler.updateFutureInstances(args);

      expect(mockCalendar.events.patch).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'long123',
        requestBody: {
          recurrence: ['RRULE:FREQ=DAILY;UNTIL=20240531T100000Z']
        }
      });
    });

    it('should handle events with multiple recurrence rules', async () => {
      const multiRuleEvent = {
        data: {
          id: 'multi123',
          start: { dateTime: '2024-06-01T10:00:00Z' },
          end: { dateTime: '2024-06-01T11:00:00Z' },
          recurrence: [
            'RRULE:FREQ=WEEKLY;BYDAY=MO',
            'EXDATE:20240610T100000Z' // Exception date
          ]
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(multiRuleEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'new_multi456' } });

      const args = {
        calendarId: 'primary',
        eventId: 'multi123',
        timeZone: 'UTC',
        modificationScope: 'future',
        futureStartDate: '2024-06-15T10:00:00Z'
      };

      await handler.updateFutureInstances(args);

      // Should preserve exception dates in new event
      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.recurrence).toContain('EXDATE:20240610T100000Z');
    });

    it('should handle instance ID formatting with milliseconds and various timezones', async () => {
      const testCases = [
        {
          originalStartTime: '2024-06-15T10:00:00.123-07:00',
          expectedInstanceId: 'event123_20240615T170000Z'
        },
        {
          originalStartTime: '2024-12-31T23:59:59.999+14:00',
          expectedInstanceId: 'event123_20241231T095959Z'
        },
        {
          originalStartTime: '2024-06-15T00:00:00.000-12:00',
          expectedInstanceId: 'event123_20240615T120000Z'
        }
      ];

      for (const testCase of testCases) {
        mockCalendar.events.patch.mockClear();
        mockCalendar.events.patch.mockResolvedValue({ data: { id: testCase.expectedInstanceId } });

        const args = {
          calendarId: 'primary',
          eventId: 'event123',
          timeZone: 'UTC',
          originalStartTime: testCase.originalStartTime,
          summary: 'Test'
        };

        await handler.updateSingleInstance(args);

        expect(mockCalendar.events.patch).toHaveBeenCalledWith({
          calendarId: 'primary',
          eventId: testCase.expectedInstanceId,
          requestBody: expect.any(Object)
        });
      }
    });

    it('should handle empty or minimal event data gracefully', async () => {
      const minimalEvent = {
        data: {
          id: 'minimal123',
          start: { dateTime: '2024-06-01T10:00:00Z' },
          end: { dateTime: '2024-06-01T11:00:00Z' },
          recurrence: ['RRULE:FREQ=WEEKLY']
          // No summary, description, attendees, etc.
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(minimalEvent);
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'new_minimal456' } });

      const args = {
        calendarId: 'primary',
        eventId: 'minimal123',
        timeZone: 'UTC',
        modificationScope: 'future',
        futureStartDate: '2024-06-15T10:00:00Z',
        summary: 'Added Summary'
      };

      const result = await handler.updateFutureInstances(args);

      const insertCall = mockCalendar.events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.summary).toBe('Added Summary');
      expect(insertCall.requestBody.id).toBeUndefined();
    });
  });

  describe('Validation and Error Edge Cases', () => {
    it('should handle malformed recurrence rules gracefully', async () => {
      const malformedEvent = {
        data: {
          id: 'malformed123',
          start: { dateTime: '2024-06-01T10:00:00Z' },
          end: { dateTime: '2024-06-01T11:00:00Z' },
          recurrence: ['INVALID_RRULE_FORMAT']
        }
      };
      
      mockCalendar.events.get.mockResolvedValue(malformedEvent);

      const args = {
        calendarId: 'primary',
        eventId: 'malformed123',
        timeZone: 'UTC',
        modificationScope: 'future',
        futureStartDate: '2024-06-15T10:00:00Z'
      };

      // Should still attempt to process, letting Google Calendar API handle validation
      mockCalendar.events.patch.mockResolvedValue({ data: {} });
      mockCalendar.events.insert.mockResolvedValue({ data: { id: 'new123' } });

      await handler.updateFutureInstances(args);

      expect(mockCalendar.events.patch).toHaveBeenCalled();
    });

    it('should handle network timeouts and retries', async () => {
      mockCalendar.events.get.mockRejectedValueOnce(new Error('Network timeout'))
                           .mockResolvedValue({
                             data: {
                               id: 'retry123',
                               recurrence: ['RRULE:FREQ=WEEKLY']
                             }
                           });

      const args = {
        calendarId: 'primary',
        eventId: 'retry123',
        timeZone: 'UTC'
      };

      // First call should fail, but we're testing that the error propagates correctly
      await expect(handler.updateEventWithScope(args))
        .rejects.toThrow('Network timeout');
    });

    it('should validate scope restrictions on single events', async () => {
      const singleEvent = {
        data: {
          id: 'single123',
          summary: 'One-time Meeting'
          // no recurrence
        }
      };
      mockCalendar.events.get.mockResolvedValue(singleEvent);

      const invalidScopes = ['single', 'future'];
      
      for (const scope of invalidScopes) {
        const args = {
          calendarId: 'primary',
          eventId: 'single123',
          timeZone: 'UTC',
          modificationScope: scope,
          originalStartTime: '2024-06-15T10:00:00Z',
          futureStartDate: '2024-06-20T10:00:00Z'
        };

        await expect(handler.updateEventWithScope(args))
          .rejects.toThrow('Scope other than "all" only applies to recurring events');
      }
    });
  });
}); 