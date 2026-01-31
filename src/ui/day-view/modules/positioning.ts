/**
 * Positioning and sizing functions for event display
 */

import type { DayViewEvent, MultiDayViewEvent } from './types.js';

/**
 * Calculate event position in time grid
 */
export function calculateEventPosition(
  event: DayViewEvent,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const ROW_HEIGHT = 48; // matches CSS --row-height

  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const startHourFloat = eventStart.getHours() + eventStart.getMinutes() / 60;
  const endHourFloat = eventEnd.getHours() + eventEnd.getMinutes() / 60;

  // Clamp to visible range
  const clampedStart = Math.max(startHourFloat, startHour);
  const clampedEnd = Math.min(endHourFloat, endHour);

  const topOffset = (clampedStart - startHour) * ROW_HEIGHT;
  const height = Math.max((clampedEnd - clampedStart) * ROW_HEIGHT, 24); // min 24px

  return {
    top: `${topOffset}px`,
    height: `${height}px`
  };
}

/**
 * Calculate event position for multi-day time grid (uses compact row height)
 */
export function calculateMultiDayEventPosition(
  event: MultiDayViewEvent,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const ROW_HEIGHT = 32; // Compact row height for multi-day expanded view

  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const startHourFloat = eventStart.getHours() + eventStart.getMinutes() / 60;
  const endHourFloat = eventEnd.getHours() + eventEnd.getMinutes() / 60;

  const clampedStart = Math.max(startHourFloat, startHour);
  const clampedEnd = Math.min(endHourFloat, endHour);

  const topOffset = (clampedStart - startHour) * ROW_HEIGHT;
  const height = Math.max((clampedEnd - clampedStart) * ROW_HEIGHT, 24);

  return {
    top: `${topOffset}px`,
    height: `${height}px`
  };
}

/**
 * Calculate time range for a day's events (for expanded time grid view)
 */
export function calculateDayTimeRange(events: MultiDayViewEvent[]): { startHour: number; endHour: number } {
  const timedEvents = events.filter(e => !e.isAllDay);

  if (timedEvents.length === 0) {
    return { startHour: 8, endHour: 18 }; // Default business hours
  }

  let minHour = 24;
  let maxHour = 0;

  for (const event of timedEvents) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    minHour = Math.min(minHour, start.getHours());
    maxHour = Math.max(maxHour, end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  }

  // Add padding and clamp
  return {
    startHour: Math.max(0, minHour - 1),
    endHour: Math.min(24, maxHour + 1)
  };
}

/**
 * Calculate event duration in minutes
 */
export function getEventDurationMinutes(event: MultiDayViewEvent): number {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Calculate proportional height for event based on duration
 * Min: 30 minutes = 44px (base height)
 * Max: 180 minutes (3 hours) = 120px
 * Scale linearly between those values
 */
export function calculateEventHeight(durationMinutes: number): { height: number; continues: boolean } {
  const MIN_DURATION = 30;  // 30 minutes
  const MAX_DURATION = 180; // 3 hours
  const MIN_HEIGHT = 44;    // pixels
  const MAX_HEIGHT = 120;   // pixels

  const continues = durationMinutes > MAX_DURATION;
  const clampedDuration = Math.min(Math.max(durationMinutes, MIN_DURATION), MAX_DURATION);

  // Linear interpolation
  const ratio = (clampedDuration - MIN_DURATION) / (MAX_DURATION - MIN_DURATION);
  const height = MIN_HEIGHT + ratio * (MAX_HEIGHT - MIN_HEIGHT);

  return { height: Math.round(height), continues };
}
