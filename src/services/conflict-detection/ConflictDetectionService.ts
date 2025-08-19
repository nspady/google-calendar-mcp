import { OAuth2Client } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import { 
  ConflictCheckResult, 
  ConflictInfo, 
  DuplicateInfo, 
  ConflictDetectionOptions 
} from "./types.js";
import { EventSimilarityChecker } from "./EventSimilarityChecker.js";
import { ConflictAnalyzer } from "./ConflictAnalyzer.js";
import { getEventUrl } from "../../handlers/utils.js";

export class ConflictDetectionService {
  private similarityChecker: EventSimilarityChecker;
  private conflictAnalyzer: ConflictAnalyzer;
  private eventCache: Map<string, { events: calendar_v3.Schema$Event[]; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
  
  constructor() {
    this.similarityChecker = new EventSimilarityChecker();
    this.conflictAnalyzer = new ConflictAnalyzer();
    this.eventCache = new Map();
  }

  /**
   * Check for conflicts and duplicates when creating or updating an event
   */
  async checkConflicts(
    oauth2Client: OAuth2Client,
    event: calendar_v3.Schema$Event,
    calendarId: string,
    options: ConflictDetectionOptions = {}
  ): Promise<ConflictCheckResult> {
    const {
      checkDuplicates = true,
      checkConflicts = true,
      calendarsToCheck = [calendarId],
      duplicateSimilarityThreshold = 0.7,
      includeDeclinedEvents = false
    } = options;

    const result: ConflictCheckResult = {
      hasConflicts: false,
      conflicts: [],
      duplicates: []
    };

    if (!event.start || !event.end) {
      return result;
    }

    // Get the time range for checking
    const timeMin = event.start.dateTime || event.start.date;
    const timeMax = event.end.dateTime || event.end.date;

    if (!timeMin || !timeMax) {
      return result;
    }

    // Check each calendar
    for (const checkCalendarId of calendarsToCheck) {
      try {
        // Get events in the same time range
        const events = await this.getEventsInTimeRange(
          oauth2Client,
          checkCalendarId,
          timeMin,
          timeMax
        );

        // Check for duplicates
        if (checkDuplicates) {
          const duplicates = this.findDuplicates(
            event,
            events,
            checkCalendarId,
            duplicateSimilarityThreshold
          );
          result.duplicates.push(...duplicates);
        }

        // Check for conflicts
        if (checkConflicts) {
          const conflicts = this.findConflicts(
            event,
            events,
            checkCalendarId,
            includeDeclinedEvents
          );
          result.conflicts.push(...conflicts);
        }
      } catch (error) {
        // If we can't access a calendar, skip it silently
        // Errors are expected for calendars without access permissions
      }
    }

    result.hasConflicts = result.conflicts.length > 0 || result.duplicates.length > 0;
    return result;
  }

  /**
   * Get events in a specific time range from a calendar with caching
   */
  private async getEventsInTimeRange(
    oauth2Client: OAuth2Client,
    calendarId: string,
    timeMin: string,
    timeMax: string
  ): Promise<calendar_v3.Schema$Event[]> {
    // Create cache key from calendar ID and time range
    const cacheKey = `${calendarId}:${timeMin}:${timeMax}`;
    
    // Check cache
    const cached = this.eventCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.events;
    }
    
    // Fetch from API
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    
    // Use exact time range without extension to avoid false positives
    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    });

    const events = response?.data?.items || [];
    
    // Update cache
    this.eventCache.set(cacheKey, {
      events,
      timestamp: Date.now()
    });
    
    // Clean old cache entries
    this.cleanCache();
    
    return events;
  }
  
  /**
   * Remove expired cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of this.eventCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.eventCache.delete(key);
      }
    }
  }

  /**
   * Find duplicate events based on similarity
   */
  private findDuplicates(
    newEvent: calendar_v3.Schema$Event,
    existingEvents: calendar_v3.Schema$Event[],
    calendarId: string,
    threshold: number
  ): DuplicateInfo[] {
    const duplicates: DuplicateInfo[] = [];

    for (const existingEvent of existingEvents) {
      // Skip if it's the same event (for updates)
      if (existingEvent.id === newEvent.id) continue;
      
      // Skip cancelled events
      if (existingEvent.status === 'cancelled') continue;

      const similarity = this.similarityChecker.checkSimilarity(newEvent, existingEvent);
      
      if (similarity >= threshold) {
        duplicates.push({
          event: {
            id: existingEvent.id!,
            title: existingEvent.summary || 'Untitled Event',
            url: getEventUrl(existingEvent, calendarId) || undefined,
            similarity: Math.round(similarity * 100) / 100
          },
          fullEvent: existingEvent,
          calendarId: calendarId,
          suggestion: similarity > 0.9 
            ? 'This appears to be a duplicate. Consider updating the existing event instead.'
            : 'This event is very similar to an existing one. Is this intentional?'
        });
      }
    }

    return duplicates;
  }

  /**
   * Find conflicting events based on time overlap
   */
  private findConflicts(
    newEvent: calendar_v3.Schema$Event,
    existingEvents: calendar_v3.Schema$Event[],
    calendarId: string,
    includeDeclinedEvents: boolean
  ): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    const overlappingEvents = this.conflictAnalyzer.findOverlappingEvents(existingEvents, newEvent);

    for (const conflictingEvent of overlappingEvents) {
      // Skip declined events if configured
      if (!includeDeclinedEvents && this.isEventDeclined(conflictingEvent)) {
        continue;
      }

      const overlap = this.conflictAnalyzer.analyzeOverlap(newEvent, conflictingEvent);
      
      if (overlap.hasOverlap) {
        conflicts.push({
          type: 'overlap',
          calendar: calendarId,
          event: {
            id: conflictingEvent.id!,
            title: conflictingEvent.summary || 'Untitled Event',
            url: getEventUrl(conflictingEvent, calendarId) || undefined,
            start: conflictingEvent.start?.dateTime || conflictingEvent.start?.date || undefined,
            end: conflictingEvent.end?.dateTime || conflictingEvent.end?.date || undefined
          },
          fullEvent: conflictingEvent,
          overlap: {
            duration: overlap.duration!,
            percentage: overlap.percentage!,
            startTime: overlap.startTime!,
            endTime: overlap.endTime!
          }
        });
      }
    }

    return conflicts;
  }

  /**
   * Check if the current user has declined an event
   */
  private isEventDeclined(event: calendar_v3.Schema$Event): boolean {
    // For now, we'll skip this check since we don't have easy access to the user's email
    // This could be enhanced later by passing the user email through the service
    return false;
  }

  /**
   * Check for conflicts using free/busy data (alternative method)
   */
  async checkConflictsWithFreeBusy(
    oauth2Client: OAuth2Client,
    event: calendar_v3.Schema$Event,
    calendarsToCheck: string[]
  ): Promise<ConflictInfo[]> {
    const conflicts: ConflictInfo[] = [];
    
    if (!event.start || !event.end) return conflicts;
    
    const timeMin = event.start.dateTime || event.start.date;
    const timeMax = event.end.dateTime || event.end.date;
    
    if (!timeMin || !timeMax) return conflicts;

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    
    try {
      const freeBusyResponse = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: calendarsToCheck.map(id => ({ id }))
        }
      });

      for (const [calendarId, calendarInfo] of Object.entries(freeBusyResponse.data.calendars || {})) {
        if (calendarInfo.busy && calendarInfo.busy.length > 0) {
          for (const busySlot of calendarInfo.busy) {
            if (this.conflictAnalyzer.checkBusyConflict(event, busySlot)) {
              conflicts.push({
                type: 'overlap',
                calendar: calendarId,
                event: {
                  id: 'busy-time',
                  title: 'Busy (details unavailable)',
                  start: busySlot.start || undefined,
                  end: busySlot.end || undefined
                }
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to check free/busy:', error);
    }

    return conflicts;
  }
}