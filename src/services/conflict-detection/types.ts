import { calendar_v3 } from "googleapis";

/**
 * Internal conflict info used by the conflict detection service.
 * Contains additional internal fields not exposed in public API responses.
 */
export interface InternalConflictInfo {
  type: 'overlap' | 'duplicate';
  calendar: string;
  event: {
    id: string;
    title: string;
    url?: string;
    start?: string;
    end?: string;
  };
  fullEvent?: calendar_v3.Schema$Event;
  overlap?: {
    duration: string;
    percentage: number;
    startTime: string;
    endTime: string;
  };
  similarity?: number;
}

/**
 * Internal duplicate info used by the conflict detection service.
 * Contains additional internal fields not exposed in public API responses.
 */
export interface InternalDuplicateInfo {
  event: {
    id: string;
    title: string;
    start?: string;
    end?: string;
    url?: string;
    similarity: number;
  };
  fullEvent?: calendar_v3.Schema$Event;
  calendarId?: string;
  suggestion: string;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: InternalConflictInfo[];
  duplicates: InternalDuplicateInfo[];
}

export interface EventTimeRange {
  start: Date;
  end: Date;
  isAllDay: boolean;
}

export interface ConflictDetectionOptions {
  checkDuplicates?: boolean;
  checkConflicts?: boolean;
  calendarsToCheck?: string[];
  duplicateSimilarityThreshold?: number;
  includeDeclinedEvents?: boolean;
}