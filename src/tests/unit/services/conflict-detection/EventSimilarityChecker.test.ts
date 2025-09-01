import { describe, it, expect } from 'vitest';
import { EventSimilarityChecker } from '../../../../services/conflict-detection/EventSimilarityChecker.js';
import { calendar_v3 } from 'googleapis';

describe('EventSimilarityChecker', () => {
  const checker = new EventSimilarityChecker();

  describe('checkSimilarity', () => {
    it('should return 0.95 for identical events', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        location: 'Conference Room A',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2 = { ...event1 };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBe(0.95); // Our simplified algorithm returns 0.95 for exact matches
    });

    it('should detect high similarity for events with same title and time', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        location: 'Conference Room A',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        location: 'Conference Room B', // Different location
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBeGreaterThan(0.8);
    });

    it('should detect moderate similarity for events with similar titles', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Team Meeting Discussion',
        start: { dateTime: '2024-01-01T14:00:00' }, // Different time
        end: { dateTime: '2024-01-01T15:00:00' }
      };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBe(0.3); // Similar titles only = 0.3 in our simplified algorithm
    });

    it('should detect low similarity for completely different events', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        location: 'Conference Room A',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Doctor Appointment',
        location: 'Medical Center',
        start: { dateTime: '2024-02-15T09:00:00' },
        end: { dateTime: '2024-02-15T09:30:00' }
      };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBeLessThan(0.3);
    });

    it('should handle events with missing fields', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Meeting',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        // No summary
        location: 'Room 101',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBeGreaterThan(0); // Time matches
      expect(similarity).toBeLessThan(0.5); // But no title match
    });

    it('should handle all-day events', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Conference',
        start: { date: '2024-01-01' },
        end: { date: '2024-01-02' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Conference',
        start: { date: '2024-01-01' },
        end: { date: '2024-01-02' }
      };

      const similarity = checker.checkSimilarity(event1, event2);
      expect(similarity).toBe(0.95); // Exact title + overlapping = 0.95
    });
  });

  describe('all-day vs timed events', () => {
    it('should not treat all-day event as duplicate of timed event with same title', () => {
      const allDayEvent: calendar_v3.Schema$Event = {
        summary: 'Conference',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' }
      };
      const timedEvent: calendar_v3.Schema$Event = {
        summary: 'Conference',
        start: { dateTime: '2024-01-15T09:00:00' },
        end: { dateTime: '2024-01-15T17:00:00' }
      };

      const similarity = checker.checkSimilarity(allDayEvent, timedEvent);
      expect(similarity).toBeLessThanOrEqual(0.3);
      expect(checker.isDuplicate(allDayEvent, timedEvent)).toBe(false);
    });

    it('should not treat timed event as duplicate of all-day event', () => {
      const timedEvent: calendar_v3.Schema$Event = {
        summary: 'Team Offsite',
        location: 'Mountain View',
        start: { dateTime: '2024-01-15T10:00:00' },
        end: { dateTime: '2024-01-15T15:00:00' }
      };
      const allDayEvent: calendar_v3.Schema$Event = {
        summary: 'Team Offsite',
        location: 'Mountain View',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' }
      };

      const similarity = checker.checkSimilarity(timedEvent, allDayEvent);
      expect(similarity).toBeLessThanOrEqual(0.3);
      expect(checker.isDuplicate(timedEvent, allDayEvent, 0.7)).toBe(false);
    });

    it('should still detect duplicates between two all-day events', () => {
      const allDay1: calendar_v3.Schema$Event = {
        summary: 'Company Holiday',
        start: { date: '2024-07-04' },
        end: { date: '2024-07-05' }
      };
      const allDay2: calendar_v3.Schema$Event = {
        summary: 'Company Holiday',
        start: { date: '2024-07-04' },
        end: { date: '2024-07-05' }
      };

      const similarity = checker.checkSimilarity(allDay1, allDay2);
      expect(similarity).toBe(0.95); // Exact title + overlapping = 0.95
      expect(checker.isDuplicate(allDay1, allDay2)).toBe(true);
    });

    it('should still detect duplicates between two timed events', () => {
      const timed1: calendar_v3.Schema$Event = {
        summary: 'Sprint Planning',
        start: { dateTime: '2024-01-15T10:00:00' },
        end: { dateTime: '2024-01-15T12:00:00' }
      };
      const timed2: calendar_v3.Schema$Event = {
        summary: 'Sprint Planning',
        start: { dateTime: '2024-01-15T10:00:00' },
        end: { dateTime: '2024-01-15T12:00:00' }
      };

      const similarity = checker.checkSimilarity(timed1, timed2);
      expect(similarity).toBe(0.95); // Exact title + overlapping = 0.95
      expect(checker.isDuplicate(timed1, timed2)).toBe(true);
    });

    it('should handle common patterns like OOO/vacation', () => {
      const allDayOOO: calendar_v3.Schema$Event = {
        summary: 'John OOO',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' }
      };
      const timedMeeting: calendar_v3.Schema$Event = {
        summary: 'Meeting with John',
        start: { dateTime: '2024-01-15T14:00:00' },
        end: { dateTime: '2024-01-15T15:00:00' }
      };

      const similarity = checker.checkSimilarity(allDayOOO, timedMeeting);
      expect(similarity).toBeLessThan(0.3);
      expect(checker.isDuplicate(allDayOOO, timedMeeting)).toBe(false);
    });
  });

  describe('isDuplicate', () => {
    it('should identify duplicates above threshold', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };

      expect(checker.isDuplicate(event1, event2)).toBe(true); // 0.95 >= 0.7 default threshold
      expect(checker.isDuplicate(event1, event2, 0.9)).toBe(true); // 0.95 >= 0.9
      expect(checker.isDuplicate(event1, event2, 0.96)).toBe(false); // 0.95 < 0.96
    });

    it('should not identify non-duplicates as duplicates', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Team Meeting',
        start: { dateTime: '2024-01-01T10:00:00' },
        end: { dateTime: '2024-01-01T11:00:00' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Different Meeting',
        start: { dateTime: '2024-01-02T14:00:00' },
        end: { dateTime: '2024-01-02T15:00:00' }
      };

      expect(checker.isDuplicate(event1, event2)).toBe(false);
      expect(checker.isDuplicate(event1, event2, 0.5)).toBe(false);
    });
  });
});