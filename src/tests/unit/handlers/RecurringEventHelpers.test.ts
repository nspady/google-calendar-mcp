import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calendar_v3 } from 'googleapis';

// Helper functions that will be implemented
export class RecurringEventHelpers {
  private calendar: calendar_v3.Calendar;

  constructor(calendar: calendar_v3.Calendar) {
    this.calendar = calendar;
  }

  /**
   * Detects if an event is recurring or single
   */
  async detectEventType(eventId: string, calendarId: string): Promise<'recurring' | 'single'> {
    const response = await this.calendar.events.get({
      calendarId,
      eventId
    });

    const event = response.data;
    return event.recurrence && event.recurrence.length > 0 ? 'recurring' : 'single';
  }

  /**
   * Formats an instance ID for single instance updates
   */
  formatInstanceId(eventId: string, originalStartTime: string): string {
    // Convert to UTC first, then format to basic format: YYYYMMDDTHHMMSSZ
    const utcDate = new Date(originalStartTime);
    const basicTimeFormat = utcDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    return `${eventId}_${basicTimeFormat}`;
  }

  /**
   * Calculates the UNTIL date for future instance updates
   */
  calculateUntilDate(futureStartDate: string): string {
    const futureDate = new Date(futureStartDate);
    const untilDate = new Date(futureDate.getTime() - 86400000); // -1 day
    return untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /**
   * Calculates end time based on original duration
   */
  calculateEndTime(newStartTime: string, originalEvent: calendar_v3.Schema$Event): string {
    const newStart = new Date(newStartTime);
    const originalStart = new Date(originalEvent.start!.dateTime!);
    const originalEnd = new Date(originalEvent.end!.dateTime!);
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    return new Date(newStart.getTime() + duration).toISOString();
  }

  /**
   * Updates recurrence rule with UNTIL clause
   */
  updateRecurrenceWithUntil(recurrence: string[], untilDate: string): string[] {
    if (!recurrence || recurrence.length === 0) {
      throw new Error('No recurrence rule found');
    }

    const updatedRecurrence: string[] = [];
    let foundRRule = false;

    for (const rule of recurrence) {
      if (rule.startsWith('RRULE:')) {
        foundRRule = true;
        const updatedRule = rule
          .replace(/;UNTIL=\d{8}T\d{6}Z/g, '') // Remove existing UNTIL
          .replace(/;COUNT=\d+/g, '') // Remove COUNT if present
          + `;UNTIL=${untilDate}`;
        updatedRecurrence.push(updatedRule);
      } else {
        // Preserve EXDATE, RDATE, and other rules as-is
        updatedRecurrence.push(rule);
      }
    }

    if (!foundRRule) {
      throw new Error('No RRULE found in recurrence rules');
    }

    return updatedRecurrence;
  }

  /**
   * Cleans event fields for new event creation
   */
  cleanEventForDuplication(event: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
    const cleanedEvent = { ...event };
    
    // Remove fields that shouldn't be duplicated
    delete cleanedEvent.id;
    delete cleanedEvent.etag;
    delete cleanedEvent.iCalUID;
    delete cleanedEvent.created;
    delete cleanedEvent.updated;
    delete cleanedEvent.htmlLink;
    delete cleanedEvent.hangoutLink;
    
    return cleanedEvent;
  }

  /**
   * Builds request body for event updates
   */
  buildUpdateRequestBody(args: any): calendar_v3.Schema$Event {
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

describe('RecurringEventHelpers', () => {
  let helpers: RecurringEventHelpers;
  let mockCalendar: any;

  beforeEach(() => {
    mockCalendar = {
      events: {
        get: vi.fn(),
        patch: vi.fn(),
        insert: vi.fn()
      }
    };
    helpers = new RecurringEventHelpers(mockCalendar);
  });

  describe('detectEventType', () => {
    it('should detect recurring events', async () => {
      const mockEvent = {
        data: {
          id: 'event123',
          summary: 'Weekly Meeting',
          recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO']
        }
      };
      mockCalendar.events.get.mockResolvedValue(mockEvent);

      const result = await helpers.detectEventType('event123', 'primary');
      expect(result).toBe('recurring');
      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123'
      });
    });

    it('should detect single events', async () => {
      const mockEvent = {
        data: {
          id: 'event123',
          summary: 'One-time Meeting',
          // no recurrence property
        }
      };
      mockCalendar.events.get.mockResolvedValue(mockEvent);

      const result = await helpers.detectEventType('event123', 'primary');
      expect(result).toBe('single');
    });

    it('should detect single events with empty recurrence array', async () => {
      const mockEvent = {
        data: {
          id: 'event123',
          summary: 'One-time Meeting',
          recurrence: []
        }
      };
      mockCalendar.events.get.mockResolvedValue(mockEvent);

      const result = await helpers.detectEventType('event123', 'primary');
      expect(result).toBe('single');
    });

    it('should handle API errors', async () => {
      mockCalendar.events.get.mockRejectedValue(new Error('Event not found'));

      await expect(helpers.detectEventType('invalid123', 'primary'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('formatInstanceId', () => {
    const testCases = [
      {
        eventId: 'event123',
        originalStartTime: '2024-06-15T10:00:00-07:00',
        expected: 'event123_20240615T170000Z'
      },
      {
        eventId: 'meeting456',
        originalStartTime: '2024-12-31T23:59:59Z',
        expected: 'meeting456_20241231T235959Z'
      },
      {
        eventId: 'recurring_event',
        originalStartTime: '2024-06-15T14:30:00+05:30',
        expected: 'recurring_event_20240615T090000Z'
      }
    ];

    testCases.forEach(({ eventId, originalStartTime, expected }) => {
      it(`should format instance ID correctly for ${originalStartTime}`, () => {
        const result = helpers.formatInstanceId(eventId, originalStartTime);
        expect(result).toBe(expected);
      });
    });

    it('should handle datetime with milliseconds', () => {
      const result = helpers.formatInstanceId('event123', '2024-06-15T10:00:00.000Z');
      expect(result).toBe('event123_20240615T100000Z');
    });
  });

  describe('calculateUntilDate', () => {
    it('should calculate UNTIL date one day before future start date', () => {
      const futureStartDate = '2024-06-20T10:00:00-07:00';
      const result = helpers.calculateUntilDate(futureStartDate);
      
      // Should be June 19th, 2024 at 10:00:00 in basic format
      expect(result).toBe('20240619T170000Z');
    });

    it('should handle timezone conversions correctly', () => {
      const futureStartDate = '2024-06-20T00:00:00Z';
      const result = helpers.calculateUntilDate(futureStartDate);
      
      // Should be June 19th, 2024 at 00:00:00 in basic format
      expect(result).toBe('20240619T000000Z');
    });

    it('should handle different timezones', () => {
      const futureStartDate = '2024-06-20T10:00:00+05:30';
      const result = helpers.calculateUntilDate(futureStartDate);
      
      // Should be June 19th, 2024 at 04:30:00 UTC in basic format
      expect(result).toBe('20240619T043000Z');
    });
  });

  describe('calculateEndTime', () => {
    it('should calculate end time based on original duration', () => {
      const originalEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T10:00:00-07:00' },
        end: { dateTime: '2024-06-15T11:00:00-07:00' }
      };
      const newStartTime = '2024-06-15T14:00:00-07:00';

      const result = helpers.calculateEndTime(newStartTime, originalEvent);
      
      // Should preserve the 1 hour duration from original event
      expect(result).toBe('2024-06-15T22:00:00.000Z');
    });

    it('should handle different durations', () => {
      const originalEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T10:00:00Z' },
        end: { dateTime: '2024-06-15T12:30:00Z' } // 2.5 hour duration
      };
      const newStartTime = '2024-06-16T09:00:00Z';

      const result = helpers.calculateEndTime(newStartTime, originalEvent);
      
      // Should be 2.5 hours later
      expect(result).toBe('2024-06-16T11:30:00.000Z');
    });

    it('should handle cross-timezone calculations', () => {
      const originalEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T10:00:00-07:00' },
        end: { dateTime: '2024-06-15T11:00:00-07:00' }
      };
      const newStartTime = '2024-06-15T10:00:00+05:30';

      const result = helpers.calculateEndTime(newStartTime, originalEvent);
      
      // Should maintain 1 hour duration
      expect(result).toBe('2024-06-15T05:30:00.000Z');
    });
  });

  describe('updateRecurrenceWithUntil', () => {
    it('should add UNTIL clause to simple recurrence rule', () => {
      const recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=MO'];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240630T170000Z']);
    });

    it('should replace existing UNTIL clause', () => {
      const recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240531T170000Z'];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240630T170000Z']);
    });

    it('should replace COUNT with UNTIL', () => {
      const recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10'];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240630T170000Z']);
    });

    it('should handle complex recurrence rules', () => {
      const recurrence = ['RRULE:FREQ=DAILY;INTERVAL=2;BYHOUR=10;BYMINUTE=0;COUNT=20'];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual(['RRULE:FREQ=DAILY;INTERVAL=2;BYHOUR=10;BYMINUTE=0;UNTIL=20240630T170000Z']);
    });

    it('should throw error for empty recurrence', () => {
      expect(() => helpers.updateRecurrenceWithUntil([], '20240630T170000Z'))
        .toThrow('No recurrence rule found');
      
      expect(() => helpers.updateRecurrenceWithUntil(undefined as any, '20240630T170000Z'))
        .toThrow('No recurrence rule found');
    });

    it('should handle recurrence with EXDATE rules', () => {
      const recurrence = [
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'EXDATE:20240610T100000Z',
        'EXDATE:20240612T100000Z'
      ];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual([
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20240630T170000Z',
        'EXDATE:20240610T100000Z',
        'EXDATE:20240612T100000Z'
      ]);
    });

    it('should handle EXDATE rules appearing before RRULE', () => {
      const recurrence = [
        'EXDATE:20240610T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'EXDATE:20240612T100000Z'
      ];
      const untilDate = '20240630T170000Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      expect(result).toEqual([
        'EXDATE:20240610T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240630T170000Z',
        'EXDATE:20240612T100000Z'
      ]);
    });

    it('should throw error when no RRULE found', () => {
      const recurrence = [
        'EXDATE:20240610T100000Z',
        'EXDATE:20240612T100000Z'
      ];
      const untilDate = '20240630T170000Z';

      expect(() => helpers.updateRecurrenceWithUntil(recurrence, untilDate))
        .toThrow('No RRULE found in recurrence rules');
    });

    it('should handle complex recurrence with multiple EXDATE rules as reported in user issue', () => {
      // This test case reproduces the exact scenario from the user's error
      const recurrence = [
        'EXDATE;TZID=America/Los_Angeles:20250702T130500',
        'EXDATE;TZID=America/Los_Angeles:20250704T130500',
        'EXDATE;TZID=America/Los_Angeles:20250707T130500',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'EXDATE;TZID=America/Los_Angeles:20250709T130500',
        'EXDATE;TZID=America/Los_Angeles:20250711T130500'
      ];
      const untilDate = '20251102T210500Z';

      const result = helpers.updateRecurrenceWithUntil(recurrence, untilDate);
      
      // Should preserve all EXDATE rules and only modify the RRULE
      expect(result).toEqual([
        'EXDATE;TZID=America/Los_Angeles:20250702T130500',
        'EXDATE;TZID=America/Los_Angeles:20250704T130500',
        'EXDATE;TZID=America/Los_Angeles:20250707T130500',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20251102T210500Z',
        'EXDATE;TZID=America/Los_Angeles:20250709T130500',
        'EXDATE;TZID=America/Los_Angeles:20250711T130500'
      ]);
    });
  });

  describe('cleanEventForDuplication', () => {
    it('should remove system-generated fields', () => {
      const originalEvent: calendar_v3.Schema$Event = {
        id: 'event123',
        etag: '"abc123"',
        iCalUID: 'uid123@google.com',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        htmlLink: 'https://calendar.google.com/event?eid=...',
        hangoutLink: 'https://meet.google.com/...',
        summary: 'Meeting',
        description: 'Meeting description',
        location: 'Conference Room',
        start: { dateTime: '2024-06-15T10:00:00Z' },
        end: { dateTime: '2024-06-15T11:00:00Z' }
      };

      const result = helpers.cleanEventForDuplication(originalEvent);

      // Should remove system fields
      expect(result.id).toBeUndefined();
      expect(result.etag).toBeUndefined();
      expect(result.iCalUID).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.updated).toBeUndefined();
      expect(result.htmlLink).toBeUndefined();
      expect(result.hangoutLink).toBeUndefined();

      // Should preserve user fields
      expect(result.summary).toBe('Meeting');
      expect(result.description).toBe('Meeting description');
      expect(result.location).toBe('Conference Room');
      expect(result.start).toEqual({ dateTime: '2024-06-15T10:00:00Z' });
      expect(result.end).toEqual({ dateTime: '2024-06-15T11:00:00Z' });
    });

    it('should not modify original event object', () => {
      const originalEvent: calendar_v3.Schema$Event = {
        id: 'event123',
        summary: 'Meeting'
      };

      const result = helpers.cleanEventForDuplication(originalEvent);

      // Original should be unchanged
      expect(originalEvent.id).toBe('event123');
      // Result should be cleaned
      expect(result.id).toBeUndefined();
      expect(result.summary).toBe('Meeting');
    });
  });

  describe('buildUpdateRequestBody', () => {
    it('should build request body with provided fields', () => {
      const args = {
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Location',
        colorId: '9',
        timeZone: 'America/Los_Angeles'
      };

      const result = helpers.buildUpdateRequestBody(args);

      expect(result).toEqual({
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Location',
        colorId: '9',
        start: { timeZone: 'America/Los_Angeles' },
        end: { timeZone: 'America/Los_Angeles' }
      });
    });

    it('should handle time changes correctly', () => {
      const args = {
        start: '2024-06-15T10:00:00-07:00',
        end: '2024-06-15T11:00:00-07:00',
        timeZone: 'America/Los_Angeles',
        summary: 'Meeting'
      };

      const result = helpers.buildUpdateRequestBody(args);

      expect(result).toEqual({
        summary: 'Meeting',
        start: { 
          dateTime: '2024-06-15T10:00:00-07:00',
          timeZone: 'America/Los_Angeles'
        },
        end: { 
          dateTime: '2024-06-15T11:00:00-07:00',
          timeZone: 'America/Los_Angeles'
        }
      });
    });

    it('should handle partial time changes', () => {
      const args = {
        start: '2024-06-15T10:00:00-07:00',
        // no end provided
        timeZone: 'America/Los_Angeles',
        summary: 'Meeting'
      };

      const result = helpers.buildUpdateRequestBody(args);

      expect(result.start).toEqual({
        dateTime: '2024-06-15T10:00:00-07:00',
        timeZone: 'America/Los_Angeles'
      });
      expect(result.end).toEqual({
        timeZone: 'America/Los_Angeles'
      });
    });

    it('should handle attendees and reminders', () => {
      const args = {
        attendees: [
          { email: 'user1@example.com' },
          { email: 'user2@example.com' }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 1440 },
            { method: 'popup', minutes: 10 }
          ]
        },
        timeZone: 'UTC'
      };

      const result = helpers.buildUpdateRequestBody(args);

      expect(result.attendees).toEqual(args.attendees);
      expect(result.reminders).toEqual(args.reminders);
    });

    it('should not include undefined fields', () => {
      const args = {
        summary: 'Meeting',
        description: undefined,
        location: null,
        timeZone: 'UTC'
      };

      const result = helpers.buildUpdateRequestBody(args);

      expect(result.summary).toBe('Meeting');
      expect('description' in result).toBe(false);
      expect('location' in result).toBe(false);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle leap year dates correctly in formatInstanceId', () => {
      const leapYearCases = [
        {
          eventId: 'leap123',
          originalStartTime: '2024-02-29T10:00:00Z', // Leap year
          expected: 'leap123_20240229T100000Z'
        },
        {
          eventId: 'leap456',
          originalStartTime: '2024-02-29T23:59:59-12:00', // Edge timezone
          expected: 'leap456_20240301T115959Z'
        }
      ];

      leapYearCases.forEach(({ eventId, originalStartTime, expected }) => {
        const result = helpers.formatInstanceId(eventId, originalStartTime);
        expect(result).toBe(expected);
      });
    });

    it('should handle extreme timezone offsets in formatInstanceId', () => {
      const extremeTimezoneCases = [
        {
          eventId: 'extreme1',
          originalStartTime: '2024-06-15T10:00:00+14:00', // UTC+14 (Kiribati)
          expected: 'extreme1_20240614T200000Z'
        },
        {
          eventId: 'extreme2',
          originalStartTime: '2024-06-15T10:00:00-12:00', // UTC-12 (Baker Island)
          expected: 'extreme2_20240615T220000Z'
        }
      ];

      extremeTimezoneCases.forEach(({ eventId, originalStartTime, expected }) => {
        const result = helpers.formatInstanceId(eventId, originalStartTime);
        expect(result).toBe(expected);
      });
    });

    it('should handle calculateUntilDate with edge dates', () => {
      const edgeCases = [
        {
          futureStartDate: '2024-01-01T00:00:00Z', // New Year
          expected: '20231231T000000Z'
        },
        {
          futureStartDate: '2024-12-31T23:59:59Z', // End of year
          expected: '20241230T235959Z'
        },
        {
          futureStartDate: '2024-03-01T00:00:00Z', // Day after leap day
          expected: '20240229T000000Z'
        }
      ];

      edgeCases.forEach(({ futureStartDate, expected }) => {
        const result = helpers.calculateUntilDate(futureStartDate);
        expect(result).toBe(expected);
      });
    });

    it('should handle calculateEndTime with very short and very long durations', () => {
      // Very short duration (1 minute)
      const shortDurationEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T10:00:00Z' },
        end: { dateTime: '2024-06-15T10:01:00Z' }
      };
      const shortResult = helpers.calculateEndTime('2024-06-16T15:30:00Z', shortDurationEvent);
      expect(shortResult).toBe('2024-06-16T15:31:00.000Z');

      // Very long duration (8 hours)
      const longDurationEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T09:00:00Z' },
        end: { dateTime: '2024-06-15T17:00:00Z' }
      };
      const longResult = helpers.calculateEndTime('2024-06-16T10:00:00Z', longDurationEvent);
      expect(longResult).toBe('2024-06-16T18:00:00.000Z');

      // Multi-day duration
      const multiDayEvent: calendar_v3.Schema$Event = {
        start: { dateTime: '2024-06-15T10:00:00Z' },
        end: { dateTime: '2024-06-17T10:00:00Z' } // 48 hours
      };
      const multiDayResult = helpers.calculateEndTime('2024-06-20T10:00:00Z', multiDayEvent);
      expect(multiDayResult).toBe('2024-06-22T10:00:00.000Z');
    });

    it('should handle updateRecurrenceWithUntil with various RRULE formats', () => {
      const complexRRuleCases = [
        {
          original: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=30'],
          untilDate: '20241215T103000Z',
          expected: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=30;UNTIL=20241215T103000Z']
        },
        {
          original: ['RRULE:FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15;COUNT=5'],
          untilDate: '20291215T103000Z',
          expected: ['RRULE:FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15;UNTIL=20291215T103000Z']
        },
        {
          original: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;UNTIL=20241201T100000Z'],
          untilDate: '20241115T100000Z',
          expected: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;UNTIL=20241115T100000Z']
        }
      ];

      complexRRuleCases.forEach(({ original, untilDate, expected }) => {
        const result = helpers.updateRecurrenceWithUntil(original, untilDate);
        expect(result).toEqual(expected);
      });
    });

    it('should handle cleanEventForDuplication with all possible system fields', () => {
      const eventWithAllSystemFields: calendar_v3.Schema$Event = {
        id: 'event123',
        etag: '"abc123"',
        iCalUID: 'uid123@google.com',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        htmlLink: 'https://calendar.google.com/event?eid=...',
        hangoutLink: 'https://meet.google.com/...',
        conferenceData: { entryPoints: [] },
        creator: { email: 'creator@example.com' },
        organizer: { email: 'organizer@example.com' },
        sequence: 1,
        status: 'confirmed',
        transparency: 'opaque',
        visibility: 'default',
        // User fields that should be preserved
        summary: 'Meeting',
        description: 'Meeting description',
        location: 'Conference Room',
        start: { dateTime: '2024-06-15T10:00:00Z' },
        end: { dateTime: '2024-06-15T11:00:00Z' },
        attendees: [{ email: 'attendee@example.com' }],
        recurrence: ['RRULE:FREQ=WEEKLY']
      };

      const result = helpers.cleanEventForDuplication(eventWithAllSystemFields);

      // Should remove all system fields
      expect(result.id).toBeUndefined();
      expect(result.etag).toBeUndefined();
      expect(result.iCalUID).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.updated).toBeUndefined();
      expect(result.htmlLink).toBeUndefined();
      expect(result.hangoutLink).toBeUndefined();

      // Should preserve user fields
      expect(result.summary).toBe('Meeting');
      expect(result.description).toBe('Meeting description');
      expect(result.location).toBe('Conference Room');
      expect(result.attendees).toEqual([{ email: 'attendee@example.com' }]);
      expect(result.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
    });

    it('should handle buildUpdateRequestBody with complex nested objects', () => {
      const complexArgs = {
        summary: 'Complex Meeting',
        attendees: [
          { 
            email: 'user1@example.com',
            displayName: 'User One',
            responseStatus: 'accepted'
          },
          { 
            email: 'user2@example.com',
            displayName: 'User Two',
            responseStatus: 'tentative'
          }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 1440 },
            { method: 'popup', minutes: 10 },
            { method: 'sms', minutes: 60 }
          ]
        },
        recurrence: [
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE:20240610T100000Z'
        ],
        timeZone: 'America/Los_Angeles'
      };

      const result = helpers.buildUpdateRequestBody(complexArgs);

      expect(result.attendees).toEqual(complexArgs.attendees);
      expect(result.reminders).toEqual(complexArgs.reminders);
      expect(result.recurrence).toEqual(complexArgs.recurrence);
      expect(result.start).toEqual({ timeZone: 'America/Los_Angeles' });
      expect(result.end).toEqual({ timeZone: 'America/Los_Angeles' });
    });

    it('should handle buildUpdateRequestBody with mixed null, undefined, and valid values', () => {
      const mixedArgs = {
        summary: 'Valid Summary',
        description: null,
        location: undefined,
        colorId: '',
        attendees: [],
        reminders: null,
        start: '2024-06-15T10:00:00Z',
        end: null,
        timeZone: 'UTC'
      };

      const result = helpers.buildUpdateRequestBody(mixedArgs);

      expect(result.summary).toBe('Valid Summary');
      expect('description' in result).toBe(false);
      expect('location' in result).toBe(false);
      expect(result.colorId).toBe(''); // Empty string should be included
      expect(result.attendees).toEqual([]); // Empty array should be included
      expect('reminders' in result).toBe(false);
      expect(result.start).toEqual({ 
        dateTime: '2024-06-15T10:00:00Z',
        timeZone: 'UTC'
      });
      expect(result.end).toEqual({ timeZone: 'UTC' });
    });
  });
}); 