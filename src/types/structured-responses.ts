import { calendar_v3 } from 'googleapis';

/**
 * Extended event type to include calendar ID and account ID for tracking source.
 * Used by handlers that need to track which calendar/account an event came from.
 */
export interface ExtendedEvent extends calendar_v3.Schema$Event {
  calendarId: string;
  accountId?: string;
}

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
 * Focus Time event properties (Google Workspace feature)
 */
export interface FocusTimeProperties {
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  chatStatus?: 'available' | 'doNotDisturb';
  declineMessage?: string;
}

/**
 * Out of Office event properties (Google Workspace feature)
 */
export interface OutOfOfficeProperties {
  autoDeclineMode?: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';
  declineMessage?: string;
}

/**
 * Working Location event properties (Google Workspace feature)
 */
export interface WorkingLocationProperties {
  type?: 'homeOffice' | 'officeLocation' | 'customLocation';
  homeOffice?: Record<string, unknown>;
  officeLocation?: {
    label?: string;
    buildingId?: string;
    floorId?: string;
    floorSectionId?: string;
    deskId?: string;
  };
  customLocation?: {
    label?: string;
  };
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
  /** Day of week for the start date/time (e.g., "Monday", "Tuesday") */
  startDayOfWeek?: string;
  /** Day of week for the end date/time (e.g., "Monday", "Tuesday") */
  endDayOfWeek?: string;
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
  focusTimeProperties?: FocusTimeProperties;
  outOfOfficeProperties?: OutOfOfficeProperties;
  workingLocationProperties?: WorkingLocationProperties;
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
  accountId?: string;
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
  accounts?: string[];
  note?: string;
  warnings?: string[];
  partialFailures?: Array<{
    accountId: string;
    reason: string;
  }>;
}

/**
 * Response format for searching calendar events
 */
export interface SearchEventsResponse {
  events: StructuredEvent[];
  totalCount: number;
  query: string;
  calendarId?: string;
  calendars?: string[];
  accounts?: string[];
  timeRange?: {
    start: string;
    end: string;
  };
  warnings?: string[];
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
 * Response format for responding to an event invitation
 */
export interface RespondToEventResponse {
  event: StructuredEvent;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  sendUpdates: 'all' | 'externalOnly' | 'none';
  message: string;
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
  accountAccess?: Array<{
    accountId: string;
    accessRole: string;
    primary: boolean;
  }>;
}

/**
 * Response format for listing available calendars
 */
export interface ListCalendarsResponse {
  calendars: CalendarInfo[];
  totalCount: number;
  note?: string;
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
  /** Day of week for the current time (e.g., "Monday", "Tuesday") */
  dayOfWeek: string;
}

/**
 * Response format for adding a new account via OAuth
 */
export interface AddAccountResponse {
  status: 'awaiting_authentication' | 'already_authenticated' | 'error';
  account_id: string;
  auth_url?: string;
  callback_url?: string;
  instructions?: string;
  expires_in_minutes?: number;
  next_step?: string;
  message?: string;
  error?: string;
}

/**
 * Information about a single authenticated account
 */
export interface AccountInfo {
  account_id: string;
  status: 'active' | 'expired' | 'invalid' | 'error';
  email?: string;
  calendar_count?: number;
  primary_calendar?: {
    id: string;
    name: string;
    timezone: string;
  };
  token_expiry?: string;
  error?: string;
}

/**
 * Response format for account status queries
 */
export interface AccountStatusResponse {
  accounts: AccountInfo[];
  total_accounts: number;
  message?: string;
}

/**
 * Response format for removing an account
 */
export interface RemoveAccountResponse {
  success: boolean;
  account_id: string;
  message: string;
  remaining_accounts: string[];
}

/**
 * Derives the day of week from a date/time string.
 * Uses Intl.DateTimeFormat for reliable timezone-aware day-of-week calculation.
 * This prevents LLM hallucination of date-to-day mappings.
 *
 * Handles edge case where timeZone field is absent but dateTime contains an offset:
 * When dateTime is like "2026-01-19T23:00:00-08:00" without explicit timeZone,
 * we extract the local date directly from the ISO string to get the correct day.
 *
 * @param dateTimeOrDate - ISO 8601 dateTime string or YYYY-MM-DD date string
 * @param timeZone - Optional timezone for the calculation (defaults to UTC)
 * @returns Day of week name (e.g., "Monday", "Tuesday") or undefined if parsing fails
 */
function getDayOfWeek(dateTimeOrDate: string | undefined | null, timeZone?: string | null): string | undefined {
  if (!dateTimeOrDate) return undefined;

  try {
    // If no explicit timezone but the dateTime has an offset (e.g., -08:00, +05:30),
    // extract the local date directly from the ISO string to derive correct day-of-week.
    // This handles the edge case where Google returns dateTime with offset but no timeZone field.
    if (!timeZone && /[+-]\d{2}:\d{2}$/.test(dateTimeOrDate)) {
      const dateMatch = dateTimeOrDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        const [, year, month, day] = dateMatch;
        // Create a date at noon UTC for the extracted date to avoid any DST edge cases
        const localDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 12, 0, 0));
        if (!isNaN(localDate.getTime())) {
          return new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
          }).format(localDate);
        }
      }
    }

    const date = new Date(dateTimeOrDate);
    if (isNaN(date.getTime())) return undefined;

    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: timeZone || 'UTC'
    }).format(date);
  } catch {
    return undefined;
  }
}

/**
 * Converts a Google Calendar API event to our structured format
 * @param event - The Google Calendar API event object
 * @param calendarId - Optional calendar ID to include in the response
 * @param accountId - Optional account ID to include in the response (for multi-account queries)
 * @returns Structured event representation
 */
export function convertGoogleEventToStructured(
  event: calendar_v3.Schema$Event,
  calendarId?: string,
  accountId?: string
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
    startDayOfWeek: getDayOfWeek(
      event.start?.dateTime || event.start?.date,
      event.start?.timeZone
    ),
    endDayOfWeek: getDayOfWeek(
      event.end?.dateTime || event.end?.date,
      event.end?.timeZone
    ),
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
    focusTimeProperties: event.focusTimeProperties as FocusTimeProperties,
    outOfOfficeProperties: event.outOfOfficeProperties as OutOfOfficeProperties,
    workingLocationProperties: event.workingLocationProperties as WorkingLocationProperties,
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
    accountId: accountId,
  };
}
