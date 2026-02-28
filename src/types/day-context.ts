import { StructuredEvent } from './structured-responses.js';
import { BaseViewEvent, toBaseViewEvent } from './view-event.js';

/**
 * Simplified event for day view display.
 * Extends BaseViewEvent with day-view-specific color fields.
 */
export interface DayViewEvent extends BaseViewEvent {
  colorId?: string;
}

/**
 * Context data passed to the day view UI
 */
export interface DayContext {
  /** The date being displayed (YYYY-MM-DD) */
  date: string;
  /** Timezone for display */
  timezone: string;
  /** All events for the day */
  events: DayViewEvent[];
  /** ID of the newly created/updated event */
  focusEventId: string;
  /** Calculated time range to display */
  timeRange: {
    /** Start hour (0-23) */
    startHour: number;
    /** End hour (0-23) */
    endHour: number;
  };
  /** Link to open the day in Google Calendar */
  dayLink: string;
}

/**
 * Converts a StructuredEvent to DayViewEvent
 */
export function toDayViewEvent(event: StructuredEvent): DayViewEvent {
  return {
    ...toBaseViewEvent(event),
    colorId: event.colorId,
  };
}
