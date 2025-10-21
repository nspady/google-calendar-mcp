import { calendar_v3 } from 'googleapis';
import { createTimeObject } from '../utils/datetime.js';

export class RecurringEventHelpers {
  private calendar: calendar_v3.Calendar;

  constructor(calendar: calendar_v3.Calendar) {
    this.calendar = calendar;
  }

  /**
   * Get the calendar instance
   */
  getCalendar(): calendar_v3.Calendar {
    return this.calendar;
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
  buildUpdateRequestBody(args: any, defaultTimeZone?: string): calendar_v3.Schema$Event {
    const requestBody: calendar_v3.Schema$Event = {};

    if (args.summary !== undefined && args.summary !== null) requestBody.summary = args.summary;
    if (args.description !== undefined && args.description !== null) requestBody.description = args.description;
    if (args.location !== undefined && args.location !== null) requestBody.location = args.location;
    if (args.colorId !== undefined && args.colorId !== null) requestBody.colorId = args.colorId;
    if (args.attendees !== undefined && args.attendees !== null) requestBody.attendees = args.attendees;
    if (args.reminders !== undefined && args.reminders !== null) requestBody.reminders = args.reminders;
    if (args.recurrence !== undefined && args.recurrence !== null) requestBody.recurrence = args.recurrence;
    if (args.conferenceData !== undefined && args.conferenceData !== null) requestBody.conferenceData = args.conferenceData;
    if (args.transparency !== undefined && args.transparency !== null) requestBody.transparency = args.transparency;
    if (args.visibility !== undefined && args.visibility !== null) requestBody.visibility = args.visibility;
    if (args.guestsCanInviteOthers !== undefined && args.guestsCanInviteOthers !== null) requestBody.guestsCanInviteOthers = args.guestsCanInviteOthers;
    if (args.guestsCanModify !== undefined && args.guestsCanModify !== null) requestBody.guestsCanModify = args.guestsCanModify;
    if (args.guestsCanSeeOtherGuests !== undefined && args.guestsCanSeeOtherGuests !== null) requestBody.guestsCanSeeOtherGuests = args.guestsCanSeeOtherGuests;
    if (args.anyoneCanAddSelf !== undefined && args.anyoneCanAddSelf !== null) requestBody.anyoneCanAddSelf = args.anyoneCanAddSelf;
    if (args.extendedProperties !== undefined && args.extendedProperties !== null) requestBody.extendedProperties = args.extendedProperties;
    if (args.attachments !== undefined && args.attachments !== null) requestBody.attachments = args.attachments;

    // Handle time changes - use createTimeObject to support both timed and all-day events
    const effectiveTimeZone = args.timeZone || defaultTimeZone;

    if (args.start !== undefined && args.start !== null) {
      const timeObj = createTimeObject(args.start, effectiveTimeZone);
      // When converting between formats, explicitly nullify the opposite field
      // This is required by Google Calendar API to successfully convert between timed and all-day events
      if (timeObj.date !== undefined) {
        // All-day event: set date and nullify dateTime
        requestBody.start = { date: timeObj.date, dateTime: null };
      } else {
        // Timed event: set dateTime/timeZone and nullify date
        requestBody.start = { dateTime: timeObj.dateTime, timeZone: timeObj.timeZone, date: null };
      }
    }
    if (args.end !== undefined && args.end !== null) {
      const timeObj = createTimeObject(args.end, effectiveTimeZone);
      // When converting between formats, explicitly nullify the opposite field
      if (timeObj.date !== undefined) {
        // All-day event: set date and nullify dateTime
        requestBody.end = { date: timeObj.date, dateTime: null };
      } else {
        // Timed event: set dateTime/timeZone and nullify date
        requestBody.end = { dateTime: timeObj.dateTime, timeZone: timeObj.timeZone, date: null };
      }
    }

    return requestBody;
  }
}

/**
 * Custom error class for recurring event errors
 */
export class RecurringEventError extends Error {
  public code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RecurringEventError';
    this.code = code;
  }
}

export const RECURRING_EVENT_ERRORS = {
  INVALID_SCOPE: 'INVALID_MODIFICATION_SCOPE',
  MISSING_ORIGINAL_TIME: 'MISSING_ORIGINAL_START_TIME',
  MISSING_FUTURE_DATE: 'MISSING_FUTURE_START_DATE',
  PAST_FUTURE_DATE: 'FUTURE_DATE_IN_PAST',
  NON_RECURRING_SCOPE: 'SCOPE_NOT_APPLICABLE_TO_SINGLE_EVENT'
}; 