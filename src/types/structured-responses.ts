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
    summary: event.summary ?? undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: {
      dateTime: event.start?.dateTime ?? undefined,
      date: event.start?.date ?? undefined,
      timeZone: event.start?.timeZone ?? undefined,
    },
    end: {
      dateTime: event.end?.dateTime ?? undefined,
      date: event.end?.date ?? undefined,
      timeZone: event.end?.timeZone ?? undefined,
    },
    status: event.status ?? undefined,
    htmlLink: event.htmlLink ?? undefined,
    created: event.created ?? undefined,
    updated: event.updated ?? undefined,
    colorId: event.colorId ?? undefined,
    creator: event.creator ? {
      email: event.creator.email ?? '',
      displayName: event.creator.displayName ?? undefined,
      self: event.creator.self ?? undefined,
    } : undefined,
    organizer: event.organizer ? {
      email: event.organizer.email ?? '',
      displayName: event.organizer.displayName ?? undefined,
      self: event.organizer.self ?? undefined,
    } : undefined,
    attendees: event.attendees?.map(a => ({
      email: a.email || '',
      displayName: a.displayName ?? undefined,
      responseStatus: a.responseStatus as any,
      optional: a.optional ?? undefined,
      organizer: a.organizer ?? undefined,
      self: a.self ?? undefined,
      resource: a.resource ?? undefined,
      comment: a.comment ?? undefined,
      additionalGuests: a.additionalGuests ?? undefined,
    })),
    recurrence: event.recurrence ?? undefined,
    recurringEventId: event.recurringEventId ?? undefined,
    originalStartTime: event.originalStartTime ? {
      dateTime: event.originalStartTime.dateTime ?? undefined,
      date: event.originalStartTime.date ?? undefined,
      timeZone: event.originalStartTime.timeZone ?? undefined,
    } : undefined,
    transparency: event.transparency as any,
    visibility: event.visibility as any,
    iCalUID: event.iCalUID ?? undefined,
    sequence: event.sequence ?? undefined,
    reminders: event.reminders ? {
      useDefault: event.reminders.useDefault ?? undefined,
      overrides: event.reminders.overrides?.map(r => ({
        method: (r.method as any) || 'popup',
        minutes: r.minutes || 0,
      })),
    } : undefined,
    source: event.source ? {
      url: event.source.url ?? undefined,
      title: event.source.title ?? undefined,
    } : undefined,
    attachments: event.attachments?.map(a => ({
      fileUrl: a.fileUrl ?? undefined,
      title: a.title ?? undefined,
      mimeType: a.mimeType ?? undefined,
      iconLink: a.iconLink ?? undefined,
      fileId: a.fileId ?? undefined,
    })),
    eventType: event.eventType as any,
    conferenceData: event.conferenceData as ConferenceData,
    extendedProperties: event.extendedProperties as ExtendedProperties,
    hangoutLink: event.hangoutLink ?? undefined,
    anyoneCanAddSelf: event.anyoneCanAddSelf ?? undefined,
    guestsCanInviteOthers: event.guestsCanInviteOthers ?? undefined,
    guestsCanModify: event.guestsCanModify ?? undefined,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests ?? undefined,
    privateCopy: event.privateCopy ?? undefined,
    locked: event.locked ?? undefined,
    calendarId: calendarId,
  };
}