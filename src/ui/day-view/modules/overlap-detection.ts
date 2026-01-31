/**
 * Overlap detection functions for event display
 */

import type { MultiDayViewEvent } from './types.js';

/**
 * Check if two events overlap in time
 */
export function eventsOverlap(eventA: MultiDayViewEvent, eventB: MultiDayViewEvent): { overlaps: boolean; overlapMinutes: number } {
  if (eventA.isAllDay || eventB.isAllDay) return { overlaps: false, overlapMinutes: 0 };

  const startA = new Date(eventA.start).getTime();
  const endA = new Date(eventA.end).getTime();
  const startB = new Date(eventB.start).getTime();
  const endB = new Date(eventB.end).getTime();

  const overlaps = startA < endB && startB < endA;
  if (!overlaps) return { overlaps: false, overlapMinutes: 0 };

  // Calculate overlap duration
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlapMinutes = Math.round((overlapEnd - overlapStart) / (1000 * 60));

  return { overlaps: true, overlapMinutes };
}
