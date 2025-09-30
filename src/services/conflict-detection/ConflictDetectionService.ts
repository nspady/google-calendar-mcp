import { OAuth2Client } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import {
  ConflictCheckResult,
  InternalConflictInfo,
  InternalDuplicateInfo,
  ConflictDetectionOptions
} from "./types.js";
import { EventSimilarityChecker } from "./EventSimilarityChecker.js";
import { ConflictAnalyzer } from "./ConflictAnalyzer.js";
import { CONFLICT_DETECTION_CONFIG } from "./config.js";
import { getEventUrl } from "../../handlers/utils.js";
import { convertToRFC3339 } from "../../handlers/utils/datetime.js";

/**
 * Service for detecting event conflicts and duplicates.
 * 
 * IMPORTANT: This service relies on Google Calendar's list API to find existing events.
 * Due to eventual consistency in Google Calendar, recently created events may not
 * immediately appear in list queries. This is a known limitation of the Google Calendar API
 * and affects duplicate detection for events created in quick succession.
 * 
 * In real-world usage, this is rarely an issue as there's natural time between event creation.
 */
export class ConflictDetectionService {
  private similarityChecker: EventSimilarityChecker;
  private conflictAnalyzer: ConflictAnalyzer;
  
  constructor() {
    this.similarityChecker = new EventSimilarityChecker();
    this.conflictAnalyzer = new ConflictAnalyzer();
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
      duplicateSimilarityThreshold = CONFLICT_DETECTION_CONFIG.DEFAULT_DUPLICATE_THRESHOLD,
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
    let timeMin = event.start.dateTime || event.start.date;
    let timeMax = event.end.dateTime || event.end.date;

    if (!timeMin || !timeMax) {
      return result;
    }

    // Extract timezone if present (prefer start time's timezone)
    const timezone = event.start.timeZone || event.end.timeZone;
    
    
    // The Google Calendar API requires RFC3339 format for timeMin/timeMax
    // If we have timezone-naive datetimes with a timezone field, convert them to proper RFC3339
    // Check for minus but exclude the date separator (e.g., 2025-09-05)
    const needsConversion = timezone && timeMin && 
      !timeMin.includes('Z') && 
      !timeMin.includes('+') && 
      !timeMin.substring(10).includes('-'); // Only check for minus after the date part
      
    if (needsConversion) {
      timeMin = convertToRFC3339(timeMin, timezone);
      timeMax = convertToRFC3339(timeMax, timezone);
    }
    
    
    // Use the exact time range provided for searching
    // This ensures duplicate detection only flags events that actually overlap
    const searchTimeMin = timeMin;
    const searchTimeMax = timeMax;

    // Check each calendar
    for (const checkCalendarId of calendarsToCheck) {
      try {
        // Get events in the search time range, passing timezone for proper interpretation
        const events = await this.getEventsInTimeRange(
          oauth2Client,
          checkCalendarId,
          searchTimeMin,
          searchTimeMax,
          timezone || undefined
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
   * Get events in a specific time range from a calendar
   */
  private async getEventsInTimeRange(
    oauth2Client: OAuth2Client,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    timeZone?: string
  ): Promise<calendar_v3.Schema$Event[]> {
    // Fetch from API
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    
    // Build list parameters
    const listParams: any = {
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    };
    
    // The Google Calendar API accepts both:
    // 1. Timezone-aware datetimes (with Z or offset)
    // 2. Timezone-naive datetimes with a timeZone parameter
    // We pass the timeZone parameter when available for consistency
    if (timeZone) {
      listParams.timeZone = timeZone;
    }
    
    
    // Use exact time range without extension to avoid false positives
    const response = await calendar.events.list(listParams);

    const events = response?.data?.items || [];
    
    return events;
  }

  /**
   * Find duplicate events based on similarity
   */
  private findDuplicates(
    newEvent: calendar_v3.Schema$Event,
    existingEvents: calendar_v3.Schema$Event[],
    calendarId: string,
    threshold: number
  ): InternalDuplicateInfo[] {
    const duplicates: InternalDuplicateInfo[] = [];


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
          suggestion: similarity >= CONFLICT_DETECTION_CONFIG.DUPLICATE_THRESHOLDS.BLOCKING
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
  ): InternalConflictInfo[] {
    const conflicts: InternalConflictInfo[] = [];
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
  private isEventDeclined(_event: calendar_v3.Schema$Event): boolean {
    // For now, we'll skip this check since we don't have easy access to the user's email
    // This could be enhanced later by passing the user email through the service
    return false;
  }

  /**
   * Check for conflicts using free/busy data (alternative method)
   */
  async checkConflictsWithFreeBusy(
    oauth2Client: OAuth2Client,
    eventToCheck: calendar_v3.Schema$Event,
    calendarsToCheck: string[]
  ): Promise<InternalConflictInfo[]> {
    const conflicts: InternalConflictInfo[] = [];
    
    if (!eventToCheck.start || !eventToCheck.end) return conflicts;
    
    const timeMin = eventToCheck.start.dateTime || eventToCheck.start.date;
    const timeMax = eventToCheck.end.dateTime || eventToCheck.end.date;
    
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
            if (this.conflictAnalyzer.checkBusyConflict(eventToCheck, busySlot)) {
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