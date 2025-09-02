import { calendar_v3 } from 'googleapis';

export interface DateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

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

export interface ExtendedProperties {
  private?: Record<string, string>;
  shared?: Record<string, string>;
}

export interface Reminder {
  method: 'email' | 'popup';
  minutes: number;
}

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

export interface ListEventsResponse {
  events: StructuredEvent[];
  totalCount: number;
  calendars?: string[];
}

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

export interface GetEventResponse {
  event: StructuredEvent;
}

export interface CreateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  duplicates?: DuplicateInfo[];
  warnings?: string[];
}

export interface UpdateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  warnings?: string[];
}

export interface DeleteEventResponse {
  success: boolean;
  eventId: string;
  calendarId: string;
  message?: string;
}

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

export interface ListCalendarsResponse {
  calendars: CalendarInfo[];
  totalCount: number;
}

export interface ColorDefinition {
  background: string;
  foreground: string;
}

export interface ListColorsResponse {
  event: Record<string, ColorDefinition>;
  calendar: Record<string, ColorDefinition>;
}

export interface BusySlot {
  start: string;
  end: string;
}

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

export interface GetCurrentTimeResponse {
  currentTime: string;
  timezone: string;
  offset: string;
  isDST?: boolean;
}

export function convertGoogleEventToStructured(
  event: calendar_v3.Schema$Event,
  calendarId?: string
): StructuredEvent {
  return {
    id: event.id || '',
    summary: event.summary,
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
      email: event.creator.email ?? undefined,
      displayName: event.creator.displayName ?? undefined,
      self: event.creator.self ?? undefined,
    } : undefined,
    organizer: event.organizer ? {
      email: event.organizer.email ?? undefined,
      displayName: event.organizer.displayName ?? undefined,
      self: event.organizer.self ?? undefined,
    } : undefined,
    attendees: event.attendees?.map(a => ({
      email: a.email || '',
      displayName: a.displayName ?? undefined,
      responseStatus: a.responseStatus as any ?? undefined,
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
    transparency: event.transparency as any ?? undefined,
    visibility: event.visibility as any ?? undefined,
    iCalUID: event.iCalUID ?? undefined,
    sequence: event.sequence ?? undefined,
    reminders: event.reminders ? {
      useDefault: event.reminders.useDefault ?? undefined,
      overrides: event.reminders.overrides?.map(r => ({
        method: r.method as any ?? 'popup',
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
    eventType: event.eventType as any ?? undefined,
    conferenceData: event.conferenceData as ConferenceData ?? undefined,
    extendedProperties: event.extendedProperties as ExtendedProperties ?? undefined,
    hangoutLink: event.hangoutLink ?? undefined,
    anyoneCanAddSelf: event.anyoneCanAddSelf ?? undefined,
    guestsCanInviteOthers: event.guestsCanInviteOthers ?? undefined,
    guestsCanModify: event.guestsCanModify ?? undefined,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests ?? undefined,
    privateCopy: event.privateCopy ?? undefined,
    locked: event.locked ?? undefined,
    calendarId: calendarId ?? undefined,
  };
}