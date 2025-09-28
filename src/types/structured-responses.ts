import { calendar_v3 } from 'googleapis';

/**
 * Represents a date/time value in Google Calendar API format
 */
export interface DateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

/**
 * Represents an event attendee with their response status and details
 */
export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  comment?: string;
  additionalGuests?: number;
}

/**
 * Conference/meeting information for an event (e.g., Google Meet, Zoom)
 */
export interface ConferenceData {
  conferenceId?: string;
  conferenceSolution?: {
    key?: { type?: string };
    name?: string;
    iconUri?: string;
  };
  entryPoints?: Array<{
    entryPointType?: string;
    uri?: string;
    label?: string;
    pin?: string;
    accessCode?: string;
    meetingCode?: string;
    passcode?: string;
    password?: string;
  }>;
  createRequest?: {
    requestId?: string;
    conferenceSolutionKey?: { type?: string };
    status?: { statusCode?: string };
  };
  parameters?: {
    addOnParameters?: {
      parameters?: Record<string, string>;
    };
  };
}

/**
 * Custom key-value pairs for storing additional event metadata
 */
export interface ExtendedProperties {
  private?: Record<string, string>;
  shared?: Record<string, string>;
}

/**
 * Event reminder configuration
 */
export interface Reminder {
  method: 'email' | 'popup';
  minutes: number;
}

/**
 * Complete structured representation of a Google Calendar event
 */
export interface StructuredEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: DateTime;
  end: DateTime;
  status?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  colorId?: string;
  creator?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  attendees?: Attendee[];
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: DateTime;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  iCalUID?: string;
  sequence?: number;
  reminders?: {
    useDefault?: boolean;
    overrides?: Reminder[];
  };
  source?: {
    url?: string;
    title?: string;
  };
  attachments?: Array<{
    fileUrl?: string;
    title?: string;
    mimeType?: string;
    iconLink?: string;
    fileId?: string;
  }>;
  eventType?: 'default' | 'outOfOffice' | 'focusTime' | 'workingLocation';
  conferenceData?: ConferenceData;
  extendedProperties?: ExtendedProperties;
  hangoutLink?: string;
  anyoneCanAddSelf?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  privateCopy?: boolean;
  locked?: boolean;
  calendarId?: string;
}

/**
 * Information about a scheduling conflict with another event
 */
export interface ConflictInfo {
  event: {
    id: string;
    title: string;
    start: string;
    end: string;
    url?: string;
    similarity?: number;
  };
  calendar: string;
  overlap?: {
    duration: string;
    percentage: string;
  };
  suggestion?: string;
}

/**
 * Information about a potential duplicate event
 */
export interface DuplicateInfo {
  event: {
    id: string;
    title: string;
    start: string;
    end: string;
    url?: string;
    similarity: number;
  };
  calendarId: string;
  suggestion: string;
}

/**
 * Response format for listing calendar events
 */
export interface ListEventsResponse {
  events: StructuredEvent[];
  totalCount: number;
  calendars?: string[];
}

/**
 * Response format for searching calendar events
 */
export interface SearchEventsResponse {
  events: StructuredEvent[];
  totalCount: number;
  query: string;
  calendarId: string;
  timeRange?: {
    start: string;
    end: string;
  };
}

/**
 * Response format for getting a single event by ID
 */
export interface GetEventResponse {
  event: StructuredEvent;
}

/**
 * Response format for creating a new event
 */
export interface CreateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  duplicates?: DuplicateInfo[];
  warnings?: string[];
}

/**
 * Response format for updating an existing event
 */
export interface UpdateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  warnings?: string[];
}

/**
 * Response format for deleting an event
 */
export interface DeleteEventResponse {
  success: boolean;
  eventId: string;
  calendarId: string;
  message?: string;
}

/**
 * Detailed information about a calendar
 */
export interface CalendarInfo {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  timeZone?: string;
  summaryOverride?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  hidden?: boolean;
  selected?: boolean;
  accessRole?: string;
  defaultReminders?: Reminder[];
  notificationSettings?: {
    notifications?: Array<{
      type?: string;
      method?: string;
    }>;
  };
  primary?: boolean;
  deleted?: boolean;
  conferenceProperties?: {
    allowedConferenceSolutionTypes?: string[];
  };
}

/**
 * Response format for listing available calendars
 */
export interface ListCalendarsResponse {
  calendars: CalendarInfo[];
  totalCount: number;
}

/**
 * Color scheme definition with background and foreground colors
 */
export interface ColorDefinition {
  background: string;
  foreground: string;
}

/**
 * Response format for available calendar and event colors
 */
export interface ListColorsResponse {
  event: Record<string, ColorDefinition>;
  calendar: Record<string, ColorDefinition>;
}

/**
 * Represents a busy time period in free/busy queries
 */
export interface BusySlot {
  start: string;
  end: string;
}

/**
 * Response format for free/busy time queries
 */
export interface FreeBusyResponse {
  timeMin: string;
  timeMax: string;
  calendars: Record<string, {
    busy: BusySlot[];
    errors?: Array<{
      domain?: string;
      reason?: string;
    }>;
  }>;
}

/**
 * Response format for getting the current time in a specific timezone
 */
export interface GetCurrentTimeResponse {
  currentTime: string;
  timezone: string;
  offset: string;
  isDST?: boolean;
}

/**
 * Converts a Google Calendar API event to our structured format
 * @param event - The Google Calendar API event object
 * @param calendarId - Optional calendar ID to include in the response
 * @returns Structured event representation
 */
export function convertGoogleEventToStructured(
  event: calendar_v3.Schema$Event,
  calendarId?: string
): StructuredEvent {
  return {
    id: event.id || '',
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: {
      dateTime: event.start?.dateTime,
      date: event.start?.date,
      timeZone: event.start?.timeZone,
    },
    end: {
      dateTime: event.end?.dateTime,
      date: event.end?.date,
      timeZone: event.end?.timeZone,
    },
    status: event.status,
    htmlLink: event.htmlLink,
    created: event.created,
    updated: event.updated,
    colorId: event.colorId,
    creator: event.creator ? {
      email: event.creator.email,
      displayName: event.creator.displayName,
      self: event.creator.self,
    } : undefined,
    organizer: event.organizer ? {
      email: event.organizer.email,
      displayName: event.organizer.displayName,
      self: event.organizer.self,
    } : undefined,
    attendees: event.attendees?.map(a => ({
      email: a.email || '',
      displayName: a.displayName,
      responseStatus: a.responseStatus as any,
      optional: a.optional,
      organizer: a.organizer,
      self: a.self,
      resource: a.resource,
      comment: a.comment,
      additionalGuests: a.additionalGuests,
    })),
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    originalStartTime: event.originalStartTime ? {
      dateTime: event.originalStartTime.dateTime,
      date: event.originalStartTime.date,
      timeZone: event.originalStartTime.timeZone,
    } : undefined,
    transparency: event.transparency as any,
    visibility: event.visibility as any,
    iCalUID: event.iCalUID,
    sequence: event.sequence,
    reminders: event.reminders ? {
      useDefault: event.reminders.useDefault,
      overrides: event.reminders.overrides?.map(r => ({
        method: (r.method as any) || 'popup',
        minutes: r.minutes || 0,
      })),
    } : undefined,
    source: event.source ? {
      url: event.source.url,
      title: event.source.title,
    } : undefined,
    attachments: event.attachments?.map(a => ({
      fileUrl: a.fileUrl,
      title: a.title,
      mimeType: a.mimeType,
      iconLink: a.iconLink,
      fileId: a.fileId,
    })),
    eventType: event.eventType as any,
    conferenceData: event.conferenceData as ConferenceData,
    extendedProperties: event.extendedProperties as ExtendedProperties,
    hangoutLink: event.hangoutLink,
    anyoneCanAddSelf: event.anyoneCanAddSelf,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanModify: event.guestsCanModify,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
    privateCopy: event.privateCopy,
    locked: event.locked,
    calendarId: calendarId,
  };
}