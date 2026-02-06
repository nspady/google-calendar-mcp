/**
 * Type definitions for day view and multi-day view
 */

/**
 * Day View Event interface matching DayViewEvent from types
 */
export interface DayViewEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  colorId?: string;
  /** Resolved background color (hex, e.g., "#7986cb") - from event colorId or calendar default */
  backgroundColor?: string;
  calendarId: string;
  /** Calendar display name (user's summaryOverride or calendar's summary) */
  calendarName?: string;
  accountId?: string;
  attendeeCount?: number;
  selfResponseStatus?: string;
  hasConferenceLink?: boolean;
  eventType?: string;
  isRecurring?: boolean;
}

/**
 * Day Context interface matching DayContext from types
 */
export interface DayContext {
  date: string;
  timezone: string;
  events: DayViewEvent[];
  focusEventId: string;
  timeRange: {
    startHour: number;
    endHour: number;
  };
  dayLink: string;
}

/**
 * Multi-Day View Event interface matching MultiDayViewEvent from types
 */
export interface MultiDayViewEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  backgroundColor?: string;
  foregroundColor?: string;
  calendarId: string;
  calendarName?: string;
  accountId?: string;
  attendeeCount?: number;
  selfResponseStatus?: string;
  hasConferenceLink?: boolean;
  eventType?: string;
  isRecurring?: boolean;
}

/**
 * Multi-Day Context interface matching MultiDayContext from types
 */
export interface MultiDayContext {
  dates: string[];
  timezone: string;
  eventsByDate: Record<string, MultiDayViewEvent[]>;
  totalEventCount: number;
  focusEventId?: string;
  timeRange?: { start: string; end: string };
  query?: string;
  calendarLink: string;
}

/**
 * Calendar summary for collapsed day view
 */
export interface CalendarSummary {
  calendarId: string;
  calendarName: string;
  backgroundColor: string;
  count: number;
}

/**
 * Available time slot for scheduling mode
 */
export interface AvailableSlot {
  startMinutes: number;
  endMinutes: number;
  duration: number;
}

/**
 * Scheduling mode configuration
 */
export interface SchedulingMode {
  enabled: boolean;
  durationMinutes: number;
}

/**
 * Calendar filter item for legend toggle
 */
export interface CalendarFilter {
  calendarId: string;
  accountId?: string;
  displayName: string;
  backgroundColor: string;
  eventCount: number;
  visible: boolean;
}

/**
 * Overlap positioning info for stacking events side-by-side
 */
export interface OverlapPosition {
  columnIndex: number;
  totalColumns: number;
}
