/**
 * Type definitions for day view
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
