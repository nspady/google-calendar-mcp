/**
 * Context extraction functions for tool results
 */

import type { DayContext, MultiDayContext } from './types.js';

/**
 * Extract day context from tool result
 */
export function extractDayContext(params: { content?: Array<{ type: string; text?: string }> }): DayContext | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.dayContext) {
          return parsed.dayContext as DayContext;
        }
      } catch {
        // Not JSON or doesn't have dayContext, continue
      }
    }
  }

  return null;
}

/**
 * Detect whether a tool result is from create-event or update-event.
 * These responses have a singular `event` field + `dayContext` (vs `events` plural for list-events).
 */
export function isCreateUpdateResponse(params: { content?: Array<{ type: string; text?: string }> }): {
  date: string; timezone: string; focusEventId: string;
} | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.event && parsed.dayContext && !parsed.events) {
          const dc = parsed.dayContext;
          return { date: dc.date, timezone: dc.timezone, focusEventId: dc.focusEventId };
        }
      } catch {
        // Not JSON, continue
      }
    }
  }

  return null;
}

/**
 * Extract multi-day context from tool result
 */
export function extractMultiDayContext(params: { content?: Array<{ type: string; text?: string }> }): MultiDayContext | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.multiDayContext) {
          return parsed.multiDayContext as MultiDayContext;
        }
      } catch {
        // Not JSON or doesn't have multiDayContext, continue
      }
    }
  }

  return null;
}
