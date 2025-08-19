import { calendar_v3 } from "googleapis";
import { EventTimeRange } from "./types.js";
import { EventSimilarityChecker } from "./EventSimilarityChecker.js";

export class ConflictAnalyzer {
  private similarityChecker: EventSimilarityChecker;
  
  constructor() {
    this.similarityChecker = new EventSimilarityChecker();
  }
  /**
   * Analyze overlap between two events
   * Uses consolidated overlap logic from EventSimilarityChecker
   */
  analyzeOverlap(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): {
    hasOverlap: boolean;
    duration?: string;
    percentage?: number;
    startTime?: string;
    endTime?: string;
  } {
    // Use consolidated overlap check
    const hasOverlap = this.similarityChecker.eventsOverlap(event1, event2);
    
    if (!hasOverlap) {
      return { hasOverlap: false };
    }
    
    // Get time ranges for detailed analysis
    const time1 = this.getEventTimeRange(event1);
    const time2 = this.getEventTimeRange(event2);
    
    if (!time1 || !time2) {
      return { hasOverlap: false };
    }
    
    // Calculate overlap details
    const overlapDuration = this.similarityChecker.calculateOverlapDuration(event1, event2);
    const overlapStart = new Date(Math.max(time1.start.getTime(), time2.start.getTime()));
    const overlapEnd = new Date(Math.min(time1.end.getTime(), time2.end.getTime()));
    
    // Calculate percentage of overlap relative to the first event
    const event1Duration = time1.end.getTime() - time1.start.getTime();
    const overlapPercentage = Math.round((overlapDuration / event1Duration) * 100);
    
    return {
      hasOverlap: true,
      duration: this.formatDuration(overlapDuration),
      percentage: overlapPercentage,
      startTime: overlapStart.toISOString(),
      endTime: overlapEnd.toISOString()
    };
  }

  /**
   * Get event time range
   */
  private getEventTimeRange(event: calendar_v3.Schema$Event): EventTimeRange | null {
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    
    if (!startTime || !endTime) return null;
    
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    // Check if it's an all-day event
    const isAllDay = !event.start?.dateTime && !!event.start?.date;
    
    return { start, end, isAllDay };
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const minutes = Math.floor(milliseconds / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      const remainingHours = hours % 24;
      return remainingHours > 0 
        ? `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${remainingHours > 1 ? 's' : ''}`
        : `${days} day${days > 1 ? 's' : ''}`;
    }
    
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0
        ? `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`
        : `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  /**
   * Check if an event conflicts with a busy time slot
   */
  checkBusyConflict(event: calendar_v3.Schema$Event, busySlot: { start?: string | null; end?: string | null }): boolean {
    // Handle null values from Google's API
    const start = busySlot.start ?? undefined;
    const end = busySlot.end ?? undefined;
    
    if (!start || !end) return false;
    
    // Convert busy slot to event format for consistency
    const busyEvent: calendar_v3.Schema$Event = {
      start: { dateTime: start },
      end: { dateTime: end }
    };
    
    return this.similarityChecker.eventsOverlap(event, busyEvent);
  }

  /**
   * Filter events that overlap with a given time range
   */
  findOverlappingEvents(
    events: calendar_v3.Schema$Event[],
    targetEvent: calendar_v3.Schema$Event
  ): calendar_v3.Schema$Event[] {
    return events.filter(event => {
      // Skip the same event
      if (event.id === targetEvent.id) return false;
      
      // Skip cancelled events
      if (event.status === 'cancelled') return false;
      
      // Use consolidated overlap check
      return this.similarityChecker.eventsOverlap(targetEvent, event);
    });
  }
}