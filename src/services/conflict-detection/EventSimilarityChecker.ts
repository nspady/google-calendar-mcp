import { calendar_v3 } from "googleapis";

export class EventSimilarityChecker {
  private readonly DEFAULT_SIMILARITY_THRESHOLD = 0.7;

  /**
   * Check if two events are potentially duplicates based on similarity
   */
  checkSimilarity(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    // Check if one is all-day and the other is timed
    const event1IsAllDay = this.isAllDayEvent(event1);
    const event2IsAllDay = this.isAllDayEvent(event2);
    
    if (event1IsAllDay !== event2IsAllDay) {
      // One is all-day and the other is timed - these serve different purposes
      // Reduce similarity significantly even if titles match
      const titleSimilarity = this.calculateStringSimilarity(
        event1.summary || '',
        event2.summary || ''
      );
      
      // Cap similarity at 0.3 for all-day vs timed events
      // This prevents them from being flagged as duplicates
      return Math.min(titleSimilarity * 0.3, 0.3);
    }
    
    // Both are same type (both all-day or both timed)
    const titleSimilarity = this.calculateStringSimilarity(
      event1.summary || '',
      event2.summary || ''
    );
    
    const locationSimilarity = this.calculateStringSimilarity(
      event1.location || '',
      event2.location || ''
    );
    
    const timeSimilarity = this.calculateTimeSimilarity(event1, event2);
    
    // Weighted average: title is most important, then time, then location
    const weightedSimilarity = (
      titleSimilarity * 0.5 +
      timeSimilarity * 0.35 +
      locationSimilarity * 0.15
    );
    
    return weightedSimilarity;
  }

  /**
   * Check if an event is an all-day event
   */
  private isAllDayEvent(event: calendar_v3.Schema$Event): boolean {
    return !event.start?.dateTime && !!event.start?.date;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 && !str2) return 1;
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate time similarity between events
   */
  private calculateTimeSimilarity(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    const time1 = this.getEventTime(event1);
    const time2 = this.getEventTime(event2);
    
    if (!time1 || !time2) return 0;
    
    // Check if events start at the same time
    if (time1.start.getTime() === time2.start.getTime()) {
      return 1;
    }
    
    // Check if events overlap
    const hasOverlap = this.eventsOverlap(time1, time2);
    if (hasOverlap) {
      // Calculate overlap percentage
      const overlapDuration = this.calculateOverlapDuration(time1, time2);
      const event1Duration = time1.end.getTime() - time1.start.getTime();
      const event2Duration = time2.end.getTime() - time2.start.getTime();
      const avgDuration = (event1Duration + event2Duration) / 2;
      
      return Math.min(overlapDuration / avgDuration, 1);
    }
    
    // Events don't overlap, check how close they are
    const timeDiff = Math.abs(time1.start.getTime() - time2.start.getTime());
    const hourInMs = 60 * 60 * 1000;
    
    // If within 1 hour, give partial similarity
    if (timeDiff < hourInMs) {
      return 0.5 * (1 - timeDiff / hourInMs);
    }
    
    return 0;
  }

  /**
   * Extract event time information
   */
  private getEventTime(event: calendar_v3.Schema$Event): { start: Date; end: Date } | null {
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    
    if (!startTime || !endTime) return null;
    
    return {
      start: new Date(startTime),
      end: new Date(endTime)
    };
  }

  /**
   * Check if two events overlap
   */
  private eventsOverlap(time1: { start: Date; end: Date }, time2: { start: Date; end: Date }): boolean {
    return time1.start < time2.end && time2.start < time1.end;
  }

  /**
   * Calculate overlap duration in milliseconds
   */
  private calculateOverlapDuration(time1: { start: Date; end: Date }, time2: { start: Date; end: Date }): number {
    const overlapStart = Math.max(time1.start.getTime(), time2.start.getTime());
    const overlapEnd = Math.min(time1.end.getTime(), time2.end.getTime());
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * Levenshtein distance implementation
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Determine if events are likely duplicates
   */
  isDuplicate(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event, threshold?: number): boolean {
    const similarity = this.checkSimilarity(event1, event2);
    return similarity >= (threshold || this.DEFAULT_SIMILARITY_THRESHOLD);
  }
}