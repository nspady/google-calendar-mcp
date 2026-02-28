import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConflictCheckResult } from "../services/conflict-detection/types.js";
import {
  ConflictInfo,
  DuplicateInfo,
} from "../types/structured-responses.js";

/**
 * Creates a structured JSON response for MCP tools
 *
 * Note: We use compact JSON (no pretty-printing) because MCP clients
 * are expected to parse and display the JSON themselves. Pretty-printing
 * with escaped newlines (\n) creates poor display in clients that show
 * the raw text.
 */
export function createStructuredResponse<T>(data: T): CallToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data)
    }]
  };
}

/**
 * Converts conflict check results to structured format
 */
export function convertConflictsToStructured(
  conflicts: ConflictCheckResult
): { conflicts?: ConflictInfo[]; duplicates?: DuplicateInfo[] } {
  const result: { conflicts?: ConflictInfo[]; duplicates?: DuplicateInfo[] } = {};
  
  if (conflicts.duplicates.length > 0) {
    result.duplicates = conflicts.duplicates.map(dup => {
      // Get start and end from fullEvent if available
      let start = '';
      let end = '';
      if (dup.fullEvent) {
        start = dup.fullEvent.start?.dateTime || dup.fullEvent.start?.date || '';
        end = dup.fullEvent.end?.dateTime || dup.fullEvent.end?.date || '';
      }
      
      return {
        event: {
          id: dup.event.id || '',
          title: dup.event.title,
          start,
          end,
          url: dup.event.url,
          similarity: dup.event.similarity
        },
        calendarId: dup.calendarId || '',
        suggestion: dup.suggestion
      };
    });
  }
  
  if (conflicts.conflicts.length > 0) {
    result.conflicts = conflicts.conflicts.map(conflict => {
      // Get start and end from either the event object or fullEvent
      let start = conflict.event.start || '';
      let end = conflict.event.end || '';
      if (!start && conflict.fullEvent) {
        start = conflict.fullEvent.start?.dateTime || conflict.fullEvent.start?.date || '';
      }
      if (!end && conflict.fullEvent) {
        end = conflict.fullEvent.end?.dateTime || conflict.fullEvent.end?.date || '';
      }
      
      return {
        event: {
          id: conflict.event.id || '',
          title: conflict.event.title,
          start,
          end,
          url: conflict.event.url,
          similarity: conflict.similarity
        },
        calendar: conflict.calendar,
        overlap: conflict.overlap ? {
          duration: conflict.overlap.duration,
          percentage: `${conflict.overlap.percentage}%`
        } : undefined
      };
    });
  }
  
  return result;
}

/**
 * Creates a warning message for conflicts/duplicates
 */
export function createWarningsArray(conflicts?: ConflictCheckResult): string[] | undefined {
  if (!conflicts || !conflicts.hasConflicts) {
    return undefined;
  }
  
  const warnings: string[] = [];
  
  if (conflicts.duplicates.length > 0) {
    warnings.push(`Found ${conflicts.duplicates.length} potential duplicate(s)`);
  }
  
  if (conflicts.conflicts.length > 0) {
    warnings.push(`Found ${conflicts.conflicts.length} scheduling conflict(s)`);
  }
  
  return warnings.length > 0 ? warnings : undefined;
}