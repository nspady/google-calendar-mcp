import { calendar_v3 } from "googleapis";

export class EventSimilarityChecker {
  private readonly DEFAULT_SIMILARITY_THRESHOLD = 0.7;

  /**
   * Check if two events are potentially duplicates based on similarity
   * Uses simplified rules-based approach instead of complex weighted calculations
   */
  checkSimilarity(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    // Check if one is all-day and the other is timed
    const event1IsAllDay = this.isAllDayEvent(event1);
    const event2IsAllDay = this.isAllDayEvent(event2);
    
    if (event1IsAllDay !== event2IsAllDay) {
      // Different event types - not duplicates
      return 0.2; // Low similarity
    }
    
    const titleMatch = this.titlesMatch(event1.summary, event2.summary);
    const timeOverlap = this.eventsOverlap(event1, event2);
    const sameDay = this.eventsOnSameDay(event1, event2);
    
    // Simple rules-based scoring
    if (titleMatch.exact && timeOverlap) {
      return 0.95; // Almost certainly a duplicate
    }
    
    if (titleMatch.similar && timeOverlap) {
      return 0.7; // Potential duplicate
    }
    
    if (titleMatch.exact && sameDay) {
      return 0.6; // Same title on same day but different times
    }
    
    if (titleMatch.exact && !sameDay) {
      return 0.4; // Same title but different day - likely recurring event
    }
    
    if (titleMatch.similar) {
      return 0.3; // Similar titles only
    }
    
    return 0.1; // No significant similarity
  }

  /**
   * Check if an event is an all-day event
   */
  private isAllDayEvent(event: calendar_v3.Schema$Event): boolean {
    return !event.start?.dateTime && !!event.start?.date;
  }

  /**
   * Check if two titles match (exact or similar)
   * Simplified string matching without Levenshtein distance
   */
  private titlesMatch(title1?: string | null, title2?: string | null): { exact: boolean; similar: boolean } {
    if (!title1 || !title2) {
      return { exact: false, similar: false };
    }
    
    const t1 = title1.toLowerCase().trim();
    const t2 = title2.toLowerCase().trim();
    
    // Exact match
    if (t1 === t2) {
      return { exact: true, similar: true };
    }
    
    // Check if one contains the other (for variations like "Meeting" vs "Team Meeting")
    if (t1.includes(t2) || t2.includes(t1)) {
      return { exact: false, similar: true };
    }
    
    // Check for common significant words (more than 3 characters)
    const words1 = t1.split(/\s+/).filter(w => w.length > 3);
    const words2 = t2.split(/\s+/).filter(w => w.length > 3);
    
    if (words1.length > 0 && words2.length > 0) {
      const commonWords = words1.filter(w => words2.includes(w));
      const similarity = commonWords.length / Math.min(words1.length, words2.length);
      
      return { exact: false, similar: similarity >= 0.5 };
    }
    
    return { exact: false, similar: false };
  }

  /**
   * Check if two events are on the same day
   */
  private eventsOnSameDay(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): boolean {
    const time1 = this.getEventTime(event1);
    const time2 = this.getEventTime(event2);
    
    if (!time1 || !time2) return false;
    
    // Compare dates only (ignore time)
    const date1 = new Date(time1.start);
    const date2 = new Date(time2.start);
    
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  /**
   * Extract event time information
   * 
   * Note: This method handles both:
   * - Events being created (may have timezone-naive datetimes with separate timeZone field)
   * - Events from Google Calendar (have timezone-aware datetimes)
   * 
   * The MCP trusts Google Calendar to return only relevant events in the queried time range.
   * Any timezone conversions are handled by the Google Calendar API, not by this service.
   */
  private getEventTime(event: calendar_v3.Schema$Event): { start: Date; end: Date } | null {
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    
    if (!startTime || !endTime) return null;
    
    // Parse the datetime strings as-is
    // Google Calendar API ensures we only get events in the requested time range
    return {
      start: new Date(startTime),
      end: new Date(endTime)
    };
  }

  /**
   * Check if two events overlap in time
   * Consolidated overlap logic used throughout the service
   */
  eventsOverlap(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): boolean {
    const time1 = this.getEventTime(event1);
    const time2 = this.getEventTime(event2);
    
    if (!time1 || !time2) return false;
    
    return time1.start < time2.end && time2.start < time1.end;
  }

  /**
   * Calculate overlap duration in milliseconds
   * Used by ConflictAnalyzer for detailed overlap analysis
   */
  calculateOverlapDuration(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    const time1 = this.getEventTime(event1);
    const time2 = this.getEventTime(event2);
    
    if (!time1 || !time2) return 0;
    
    const overlapStart = Math.max(time1.start.getTime(), time2.start.getTime());
    const overlapEnd = Math.min(time1.end.getTime(), time2.end.getTime());
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * Determine if events are likely duplicates
   */
  isDuplicate(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event, threshold?: number): boolean {
    const similarity = this.checkSimilarity(event1, event2);
    return similarity >= (threshold || this.DEFAULT_SIMILARITY_THRESHOLD);
  }
}