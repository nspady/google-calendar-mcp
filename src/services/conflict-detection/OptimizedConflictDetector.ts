import { OAuth2Client } from "google-auth-library";
import { calendar_v3 } from "googleapis";
import { ConflictCheckResult, ConflictInfo, DuplicateInfo } from "./types.js";
import { ParallelExecutor } from "../performance/ParallelExecutor.js";
import crypto from 'crypto';

interface CachedConflictResult {
  result: ConflictCheckResult;
  timestamp: number;
  hash: string;
}

interface EventFingerprint {
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
}

/**
 * Optimized conflict detection with parallel processing,
 * fingerprinting, and intelligent caching
 */
export class OptimizedConflictDetector {
  private parallelExecutor: ParallelExecutor;
  private recentChecks = new Map<string, CachedConflictResult>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 100;
  
  // Bloom filter for fast negative lookups
  private eventFingerprints = new Set<string>();
  private fingerprintTTL = 10 * 60 * 1000; // 10 minutes
  private lastFingerprintClean = Date.now();
  
  constructor() {
    this.parallelExecutor = new ParallelExecutor({
      maxConcurrency: 3,
      timeout: 10000,
      retryAttempts: 2
    });
  }
  
  /**
   * Generate a fingerprint hash for an event
   */
  private generateFingerprint(event: EventFingerprint): string {
    const normalized = {
      title: event.title.toLowerCase().trim(),
      startTime: event.startTime,
      endTime: event.endTime,
      location: (event.location || '').toLowerCase().trim()
    };
    
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(normalized));
    return hash.digest('hex');
  }
  
  /**
   * Quick check if an event might be a duplicate using fingerprints
   */
  private quickDuplicateCheck(event: calendar_v3.Schema$Event): boolean {
    if (!event.summary || !event.start || !event.end) {
      return false;
    }
    
    const fingerprint = this.generateFingerprint({
      title: event.summary || '',
      startTime: event.start.dateTime || event.start.date || '',
      endTime: event.end.dateTime || event.end.date || '',
      location: event.location || undefined
    });
    
    return this.eventFingerprints.has(fingerprint);
  }
  
  /**
   * Check for conflicts with optimizations
   */
  async checkConflictsOptimized(
    oauth2Client: OAuth2Client,
    event: calendar_v3.Schema$Event,
    calendarId: string,
    calendarsToCheck: string[] = [calendarId],
    options: {
      duplicateThreshold?: number;
      skipCache?: boolean;
    } = {}
  ): Promise<ConflictCheckResult> {
    // Clean old fingerprints periodically
    this.cleanOldFingerprints();
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(event, calendarsToCheck);
    
    // Check cache unless explicitly skipped
    if (!options.skipCache) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    // Quick duplicate check using fingerprints
    if (this.quickDuplicateCheck(event)) {
      // Perform detailed check only if fingerprint matches
      const detailedResult = await this.performDetailedCheck(
        oauth2Client,
        event,
        calendarsToCheck,
        options.duplicateThreshold
      );
      
      this.cacheResult(cacheKey, detailedResult);
      return detailedResult;
    }
    
    const result = await this.runFullConflictCheck(
      oauth2Client,
      event,
      calendarsToCheck,
      options.duplicateThreshold || 0.7
    );
    
    // Cache the result
    this.cacheResult(cacheKey, result);
    
    return result;
  }
  
  /**
   * Process events to find conflicts and duplicates
   */
  private async processEventsForConflicts(
    targetEvent: calendar_v3.Schema$Event,
    calendarResults: Array<{ calendarId: string; events: calendar_v3.Schema$Event[] }>,
    duplicateThreshold: number
  ): Promise<ConflictCheckResult> {
    const conflicts: ConflictInfo[] = [];
    const duplicates: DuplicateInfo[] = [];
    const processedIds = new Set<string>();
    
    // Process each calendar's events
    for (const { calendarId, events } of calendarResults) {
      for (const existingEvent of events) {
        // Skip if already processed (for deduplication)
        if (existingEvent.id && processedIds.has(existingEvent.id)) {
          continue;
        }
        processedIds.add(existingEvent.id || '');
        
        // Skip declined events
        if (existingEvent.status === 'cancelled') {
          continue;
        }
        
        // Check for time conflicts
        const overlap = this.calculateOverlap(targetEvent, existingEvent);
        if (overlap > 0) {
          conflicts.push({
            type: 'overlap' as const,
            calendar: calendarId,
            event: {
              id: existingEvent.id || '',
              title: existingEvent.summary || 'Untitled',
              start: existingEvent.start?.dateTime || existingEvent.start?.date || undefined,
              end: existingEvent.end?.dateTime || existingEvent.end?.date || undefined,
              url: existingEvent.htmlLink || undefined
            },
            overlap: {
              duration: `${Math.round(overlap / 60000)} minutes`,
              percentage: this.calculateOverlapPercentage(targetEvent, existingEvent, overlap),
              startTime: existingEvent.start?.dateTime || existingEvent.start?.date || '',
              endTime: existingEvent.end?.dateTime || existingEvent.end?.date || ''
            }
          } as ConflictInfo);
        }
        
        // Check for duplicates using similarity
        const similarity = this.calculateSimilarity(targetEvent, existingEvent);
        if (similarity >= duplicateThreshold) {
          duplicates.push({
            event: {
              id: existingEvent.id || '',
              title: existingEvent.summary || 'Untitled',
              url: existingEvent.htmlLink || undefined,
              similarity
            },
            calendarId,
            suggestion: similarity >= 0.95
              ? 'This appears to be an exact duplicate'
              : 'This event is very similar'
          } as DuplicateInfo);
        }
      }
    }
    
    return {
      hasConflicts: conflicts.length > 0 || duplicates.length > 0,
      conflicts,
      duplicates
    };
  }
  
  /**
   * Calculate overlap between two events in milliseconds
   */
  private calculateOverlap(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    const start1 = new Date(event1.start?.dateTime || event1.start?.date || '').getTime();
    const end1 = new Date(event1.end?.dateTime || event1.end?.date || '').getTime();
    const start2 = new Date(event2.start?.dateTime || event2.start?.date || '').getTime();
    const end2 = new Date(event2.end?.dateTime || event2.end?.date || '').getTime();
    
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    
    return Math.max(0, overlapEnd - overlapStart);
  }
  
  /**
   * Calculate overlap percentage
   */
  private calculateOverlapPercentage(
    event1: calendar_v3.Schema$Event,
    _event2: calendar_v3.Schema$Event,
    overlapMs: number
  ): number {
    const duration1 = new Date(event1.end?.dateTime || event1.end?.date || '').getTime() -
                      new Date(event1.start?.dateTime || event1.start?.date || '').getTime();
    
    const percentage = Math.round((overlapMs / duration1) * 100);
    return percentage;
  }
  
  /**
   * Calculate similarity between two events
   */
  private calculateSimilarity(event1: calendar_v3.Schema$Event, event2: calendar_v3.Schema$Event): number {
    let score = 0;
    let weights = 0;
    
    // Title similarity (40% weight)
    if (event1.summary && event2.summary) {
      const titleSim = this.stringSimilarity(event1.summary, event2.summary);
      score += titleSim * 0.4;
      weights += 0.4;
    }
    
    // Time overlap (30% weight)
    const overlap = this.calculateOverlap(event1, event2);
    if (overlap > 0) {
      const duration = new Date(event1.end?.dateTime || event1.end?.date || '').getTime() -
                       new Date(event1.start?.dateTime || event1.start?.date || '').getTime();
      score += (overlap / duration) * 0.3;
      weights += 0.3;
    }
    
    // Location similarity (20% weight)
    if (event1.location && event2.location) {
      const locSim = this.stringSimilarity(event1.location, event2.location);
      score += locSim * 0.2;
      weights += 0.2;
    }
    
    // Description similarity (10% weight)
    if (event1.description && event2.description) {
      const descSim = this.stringSimilarity(
        event1.description.substring(0, 200),
        event2.description.substring(0, 200)
      );
      score += descSim * 0.1;
      weights += 0.1;
    }
    
    return weights > 0 ? score / weights : 0;
  }
  
  /**
   * Calculate string similarity using Levenshtein distance
   */
  private stringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;
    
    const maxLen = Math.max(s1.length, s2.length);
    const distance = this.levenshteinDistance(s1, s2);
    
    return 1 - (distance / maxLen);
  }
  
  /**
   * Calculate Levenshtein distance between two strings
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
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }
  
  /**
   * Generate cache key for conflict check
   */
  private generateCacheKey(event: calendar_v3.Schema$Event, calendars: string[]): string {
    const eventKey = {
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location
    };
    
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(eventKey));
    hash.update(calendars.sort().join(','));
    return hash.digest('hex');
  }
  
  /**
   * Get cached result if available and not expired
   */
  private getCachedResult(key: string): ConflictCheckResult | null {
    const cached = this.recentChecks.get(key);
    
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.recentChecks.delete(key);
      return null;
    }
    
    return cached.result;
  }
  
  /**
   * Cache a conflict check result
   */
  private cacheResult(key: string, result: ConflictCheckResult): void {
    // Enforce max cache size
    if (this.recentChecks.size >= this.maxCacheSize) {
      const oldestKey = this.recentChecks.keys().next().value;
      if (oldestKey) {
        this.recentChecks.delete(oldestKey);
      }
    }
    
    this.recentChecks.set(key, {
      result,
      timestamp: Date.now(),
      hash: key
    });
  }
  
  /**
   * Update fingerprints with newly fetched events
   */
  private updateFingerprints(calendarResults: Array<{ calendarId: string; events: calendar_v3.Schema$Event[] }>): void {
    for (const { events } of calendarResults) {
      for (const event of events) {
        if (event.summary && event.start && event.end) {
          const fingerprint = this.generateFingerprint({
            title: event.summary,
            startTime: event.start.dateTime || event.start.date || '',
            endTime: event.end.dateTime || event.end.date || '',
            location: event.location || undefined
          });
          this.eventFingerprints.add(fingerprint);
        }
      }
    }
  }
  
  /**
   * Clean old fingerprints to prevent memory bloat
   */
  private cleanOldFingerprints(): void {
    if (Date.now() - this.lastFingerprintClean > this.fingerprintTTL) {
      // In production, you'd track fingerprint timestamps
      // For now, just clear if too large
      if (this.eventFingerprints.size > 1000) {
        this.eventFingerprints.clear();
      }
      this.lastFingerprintClean = Date.now();
    }
  }

  /**
   * Run the full conflict detection flow
   */
  private async runFullConflictCheck(
    oauth2Client: OAuth2Client,
    event: calendar_v3.Schema$Event,
    calendarsToCheck: string[],
    duplicateThreshold: number
  ): Promise<ConflictCheckResult> {
    const timeMin = event.start?.dateTime || event.start?.date;
    const timeMax = event.end?.dateTime || event.end?.date;

    if (!timeMin || !timeMax) {
      return { hasConflicts: false, conflicts: [], duplicates: [] };
    }

    const fetchResult = await this.parallelExecutor.fetchEventsFromCalendars(
      oauth2Client,
      calendarsToCheck,
      {
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime'
      }
    );

    const result = await this.processEventsForConflicts(
      event,
      fetchResult.successful,
      duplicateThreshold
    );

    this.updateFingerprints(fetchResult.successful);

    return result;
  }

  /**
   * Perform detailed conflict check
   */
  private async performDetailedCheck(
    oauth2Client: OAuth2Client,
    event: calendar_v3.Schema$Event,
    calendarsToCheck: string[],
    duplicateThreshold?: number
  ): Promise<ConflictCheckResult> {
    return this.runFullConflictCheck(
      oauth2Client,
      event,
      calendarsToCheck,
      duplicateThreshold ?? 0.7
    );
  }
}
