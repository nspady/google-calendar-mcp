import { calendar_v3 } from "googleapis";

export interface ConflictInfo {
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

export interface DuplicateInfo {
  event: {
    id: string;
    title: string;
    url?: string;
    similarity: number;
  };
  fullEvent?: calendar_v3.Schema$Event;
  calendarId?: string;
  suggestion: string;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: ConflictInfo[];
  duplicates: DuplicateInfo[];
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