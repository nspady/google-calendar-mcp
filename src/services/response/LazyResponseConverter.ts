import { calendar_v3 } from 'googleapis';
import { StructuredEvent, StructuredAttendee } from '../../types/structured-responses.js';

/**
 * Lazy response converter that only converts requested fields
 * Reduces processing overhead for large result sets
 */
export class LazyResponseConverter {
  private static readonly ALWAYS_INCLUDED_FIELDS = [
    'id', 'summary', 'start', 'end', 'status', 'htmlLink'
  ];
  
  /**
   * Convert Google event to structured format with lazy field loading
   * Only converts fields that are actually accessed
   */
  static createLazyEvent(
    googleEvent: calendar_v3.Schema$Event,
    calendarId: string,
    requestedFields?: string[]
  ): StructuredEvent {
    // Determine which fields to include
    const fieldsToInclude = new Set([
      ...this.ALWAYS_INCLUDED_FIELDS,
      ...(requestedFields || [])
    ]);
    
    // Use Proxy to lazily load fields
    return new Proxy({} as StructuredEvent, {
      get: (target, prop: string) => {
        // Return cached value if already converted
        if (prop in target) {
          return target[prop as keyof StructuredEvent];
        }
        
        // Only convert if field was requested or is always included
        if (!fieldsToInclude.has(prop) && !this.ALWAYS_INCLUDED_FIELDS.includes(prop)) {
          return undefined;
        }
        
        // Lazy convert the requested field
        const value = this.convertField(googleEvent, prop, calendarId);
        
        // Cache the converted value
        if (value !== undefined) {
          (target as any)[prop] = value;
        }
        
        return value;
      },
      
      has: (target, prop: string) => {
        return fieldsToInclude.has(prop) || prop in target;
      },
      
      ownKeys: () => {
        return Array.from(fieldsToInclude);
      },
      
      getOwnPropertyDescriptor: (target, prop: string) => {
        if (fieldsToInclude.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
            value: (target as any)[prop]
          };
        }
        return undefined;
      }
    });
  }
  
  /**
   * Convert a specific field from Google format to structured format
   */
  private static convertField(
    event: calendar_v3.Schema$Event,
    field: string,
    calendarId: string
  ): any {
    switch (field) {
      case 'id':
        return event.id || '';
        
      case 'summary':
        return event.summary || '';
        
      case 'description':
        return event.description;
        
      case 'start':
        return event.start ? {
          dateTime: event.start.dateTime,
          date: event.start.date,
          timeZone: event.start.timeZone
        } : undefined;
        
      case 'end':
        return event.end ? {
          dateTime: event.end.dateTime,
          date: event.end.date,
          timeZone: event.end.timeZone
        } : undefined;
        
      case 'location':
        return event.location;
        
      case 'attendees':
        return event.attendees ? this.convertAttendees(event.attendees) : undefined;
        
      case 'organizer':
        return event.organizer ? {
          email: event.organizer.email,
          displayName: event.organizer.displayName,
          self: event.organizer.self
        } : undefined;
        
      case 'creator':
        return event.creator ? {
          email: event.creator.email,
          displayName: event.creator.displayName,
          self: event.creator.self
        } : undefined;
        
      case 'status':
        return event.status || 'confirmed';
        
      case 'htmlLink':
        return event.htmlLink;
        
      case 'created':
        return event.created;
        
      case 'updated':
        return event.updated;
        
      case 'colorId':
        return event.colorId;
        
      case 'transparency':
        return event.transparency;
        
      case 'visibility':
        return event.visibility;
        
      case 'recurrence':
        return event.recurrence;
        
      case 'recurringEventId':
        return event.recurringEventId;
        
      case 'originalStartTime':
        return event.originalStartTime ? {
          dateTime: event.originalStartTime.dateTime,
          date: event.originalStartTime.date,
          timeZone: event.originalStartTime.timeZone
        } : undefined;
        
      case 'reminders':
        return event.reminders ? {
          useDefault: event.reminders.useDefault,
          overrides: event.reminders.overrides?.map(r => ({
            method: r.method || 'popup',
            minutes: r.minutes || 0
          }))
        } : undefined;
        
      case 'conferenceData':
        return event.conferenceData ? this.convertConferenceData(event.conferenceData) : undefined;
        
      case 'attachments':
        return event.attachments;
        
      case 'extendedProperties':
        return event.extendedProperties;
        
      case 'calendarId':
        return calendarId;
        
      case 'eventType':
        return event.eventType || 'default';
        
      case 'guestsCanInviteOthers':
        return event.guestsCanInviteOthers;
        
      case 'guestsCanModify':
        return event.guestsCanModify;
        
      case 'guestsCanSeeOtherGuests':
        return event.guestsCanSeeOtherGuests;
        
      case 'anyoneCanAddSelf':
        return event.anyoneCanAddSelf;
        
      case 'privateCopy':
        return event.privateCopy;
        
      case 'locked':
        return event.locked;
        
      case 'source':
        return event.source;
        
      case 'iCalUID':
        return event.iCalUID;
        
      case 'sequence':
        return event.sequence;
        
      case 'hangoutLink':
        return event.hangoutLink;
        
      default:
        return undefined;
    }
  }
  
  /**
   * Convert attendees array
   */
  private static convertAttendees(attendees: calendar_v3.Schema$EventAttendee[]): StructuredAttendee[] {
    return attendees.map(a => ({
      email: a.email || '',
      displayName: a.displayName,
      organizer: a.organizer,
      self: a.self,
      resource: a.resource,
      optional: a.optional,
      responseStatus: a.responseStatus || 'needsAction',
      comment: a.comment,
      additionalGuests: a.additionalGuests
    }));
  }
  
  /**
   * Convert conference data
   */
  private static convertConferenceData(conferenceData: calendar_v3.Schema$ConferenceData) {
    return {
      createRequest: conferenceData.createRequest,
      entryPoints: conferenceData.entryPoints?.map(ep => ({
        entryPointType: ep.entryPointType,
        uri: ep.uri,
        label: ep.label,
        pin: ep.pin,
        accessCode: ep.accessCode,
        meetingCode: ep.meetingCode,
        passcode: ep.passcode,
        password: ep.password
      })),
      conferenceSolution: conferenceData.conferenceSolution ? {
        key: conferenceData.conferenceSolution.key,
        name: conferenceData.conferenceSolution.name,
        iconUri: conferenceData.conferenceSolution.iconUri
      } : undefined,
      conferenceId: conferenceData.conferenceId,
      signature: conferenceData.signature,
      notes: conferenceData.notes
    };
  }
  
  /**
   * Convert events in batches for better performance
   */
  static convertBatch(
    events: calendar_v3.Schema$Event[],
    calendarId: string,
    requestedFields?: string[]
  ): StructuredEvent[] {
    // Use lazy conversion for each event
    return events.map(event => 
      this.createLazyEvent(event, calendarId, requestedFields)
    );
  }
  
  /**
   * Optimize field list by removing redundant fields
   */
  static optimizeFieldList(fields?: string[]): string[] | undefined {
    if (!fields || fields.length === 0) {
      return undefined;
    }
    
    // Remove duplicates and always-included fields
    const uniqueFields = new Set(fields);
    this.ALWAYS_INCLUDED_FIELDS.forEach(f => uniqueFields.delete(f));
    
    return uniqueFields.size > 0 ? Array.from(uniqueFields) : undefined;
  }
}