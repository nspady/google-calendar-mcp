/**
 * Context extraction functions for tool results
 */

import type { DayContext, MultiDayContext } from './types.js';

type ToolResultParams = { content?: Array<{ type: string; text?: string }> };

/**
 * Parse the first JSON text block from a tool result that satisfies the predicate.
 */
function findInToolResult<T>(params: ToolResultParams, extract: (parsed: any) => T | null): T | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const result = extract(JSON.parse(block.text));
        if (result !== null) return result;
      } catch {
        // Not JSON, continue
      }
    }
  }

  return null;
}

/**
 * Extract day context from tool result
 */
export function extractDayContext(params: ToolResultParams): DayContext | null {
  return findInToolResult(params, parsed => parsed.dayContext as DayContext ?? null);
}

/**
 * Detect whether a tool result is from create-event or update-event.
 * These responses have a singular `event` field + `dayContext` (vs `events` plural for list-events).
 */
export function isCreateUpdateResponse(params: ToolResultParams): {
  date: string; timezone: string; focusEventId: string;
} | null {
  return findInToolResult(params, parsed => {
    if (parsed.event && parsed.dayContext && !parsed.events) {
      const dc = parsed.dayContext;
      return { date: dc.date, timezone: dc.timezone, focusEventId: dc.focusEventId };
    }
    return null;
  });
}

/**
 * Extract multi-day context from tool result
 */
export function extractMultiDayContext(params: ToolResultParams): MultiDayContext | null {
  return findInToolResult(params, parsed => parsed.multiDayContext as MultiDayContext ?? null);
}
