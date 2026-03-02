/**
 * Positioning and sizing functions for event display
 */

import type { DayViewEvent, OverlapPosition } from './types.js';
import { getMinutesSinceMidnight, getDateKeyInTimeZone } from './utilities.js';

/**
 * Calculate event position in time grid.
 * @param rowHeight - Pixel height per hour row (48 for day view)
 */
function calculatePosition(
  event: { start: string; end: string },
  startHour: number,
  endHour: number,
  rowHeight: number,
  timeZone?: string
): { top: string; height: string } {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const startMinutes = getMinutesSinceMidnight(event.start, timeZone);
  const rawDurationMinutes = (eventEnd.getTime() - eventStart.getTime()) / (1000 * 60);
  const durationMinutes = Number.isFinite(rawDurationMinutes) ? Math.max(0, Math.round(rawDurationMinutes)) : 0;
  const startHourFloat = startMinutes / 60;
  let endHourFloat = (startMinutes + durationMinutes) / 60;

  // If event spans into the next day, clamp visual end to midnight for this day view.
  if (getDateKeyInTimeZone(eventEnd, timeZone) !== getDateKeyInTimeZone(eventStart, timeZone)) {
    endHourFloat = 24;
  } else {
    endHourFloat = Math.min(endHourFloat, 24);
  }

  // Clamp to visible range
  const clampedStart = Math.max(startHourFloat, startHour);
  let clampedEnd = Math.min(endHourFloat, endHour);
  if (clampedEnd <= clampedStart) {
    clampedEnd = Math.min(endHour, clampedStart + 0.5);
  }

  const topOffset = (clampedStart - startHour) * rowHeight;
  const height = Math.max((clampedEnd - clampedStart) * rowHeight, 24); // min 24px

  return {
    top: `${topOffset}px`,
    height: `${height}px`
  };
}

const DAY_VIEW_ROW_HEIGHT = 48;     // matches CSS --row-height

/**
 * Calculate event position in time grid (standard day view)
 */
export function calculateEventPosition(
  event: DayViewEvent,
  startHour: number,
  endHour: number,
  timeZone?: string
): { top: string; height: string } {
  return calculatePosition(event, startHour, endHour, DAY_VIEW_ROW_HEIGHT, timeZone);
}

/**
 * Check if two events overlap in time (for time grid view)
 */
export function eventsOverlapInTime(eventA: DayViewEvent, eventB: DayViewEvent): boolean {
  if (eventA.isAllDay || eventB.isAllDay) return false;

  const startA = new Date(eventA.start).getTime();
  const endA = new Date(eventA.end).getTime();
  const startB = new Date(eventB.start).getTime();
  const endB = new Date(eventB.end).getTime();

  return startA < endB && startB < endA;
}

/**
 * Calculate overlap positions for events to display them side-by-side
 * Returns a Map of event ID to its column position info
 */
export function calculateOverlapColumns(events: DayViewEvent[]): Map<string, OverlapPosition> {
  const positions = new Map<string, OverlapPosition>();
  const timedEvents = events.filter(e => !e.isAllDay);

  if (timedEvents.length === 0) return positions;

  // Sort by start time, then by end time (shorter events first)
  const sortedEvents = [...timedEvents].sort((a, b) => {
    const startDiff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (startDiff !== 0) return startDiff;
    return new Date(a.end).getTime() - new Date(b.end).getTime();
  });

  // Find overlap groups (connected components of overlapping events)
  const overlapGroups: DayViewEvent[][] = [];
  const visited = new Set<string>();

  for (const event of sortedEvents) {
    if (visited.has(event.id)) continue;

    // BFS to find all events connected through overlaps
    const group: DayViewEvent[] = [];
    const queue = [event];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;

      visited.add(current.id);
      group.push(current);

      // Find all events that overlap with current
      for (const other of sortedEvents) {
        if (!visited.has(other.id) && eventsOverlapInTime(current, other)) {
          queue.push(other);
        }
      }
    }

    if (group.length > 0) {
      overlapGroups.push(group);
    }
  }

  // Assign columns within each overlap group
  for (const group of overlapGroups) {
    if (group.length === 1) {
      // Single event, no overlap - full width
      positions.set(group[0].id, { columnIndex: 0, totalColumns: 1 });
      continue;
    }

    // Sort group by start time for consistent column assignment
    group.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Track which columns are occupied at each point in time
    // Each column entry stores the end time of the event using that column
    const columns: number[] = [];

    for (const event of group) {
      const eventStart = new Date(event.start).getTime();

      // Find first available column (one where previous event has ended)
      let columnIndex = 0;
      while (columnIndex < columns.length && columns[columnIndex] > eventStart) {
        columnIndex++;
      }

      // Assign this event to the column
      const eventEnd = new Date(event.end).getTime();
      columns[columnIndex] = eventEnd;

      positions.set(event.id, { columnIndex, totalColumns: 0 }); // totalColumns set later
    }

    // Now calculate the max columns used for this group
    const maxColumns = columns.length;

    // Update all events in the group with the total column count
    for (const event of group) {
      const pos = positions.get(event.id)!;
      positions.set(event.id, { ...pos, totalColumns: maxColumns });
    }
  }

  return positions;
}
