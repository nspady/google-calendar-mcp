import { describe, it, expect } from 'vitest';
import { ConflictAnalyzer } from '../../../../services/conflict-detection/ConflictAnalyzer.js';
import { calendar_v3 } from 'googleapis';

describe('ConflictAnalyzer', () => {
  const analyzer = new ConflictAnalyzer();

  describe('analyzeOverlap', () => {
    it('should detect full overlap', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Meeting 1',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T11:00:00Z' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Meeting 2',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T11:00:00Z' }
      };

      const result = analyzer.analyzeOverlap(event1, event2);
      expect(result.hasOverlap).toBe(true);
      expect(result.percentage).toBe(100);
      expect(result.duration).toBe('1 hour');
    });

    it('should detect partial overlap', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Meeting 1',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T11:00:00Z' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Meeting 2',
        start: { dateTime: '2024-01-01T10:30:00Z' },
        end: { dateTime: '2024-01-01T11:30:00Z' }
      };

      const result = analyzer.analyzeOverlap(event1, event2);
      expect(result.hasOverlap).toBe(true);
      expect(result.percentage).toBe(50);
      expect(result.duration).toBe('30 minutes');
    });

    it('should detect no overlap', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Meeting 1',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T11:00:00Z' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Meeting 2',
        start: { dateTime: '2024-01-01T11:00:00Z' },
        end: { dateTime: '2024-01-01T12:00:00Z' }
      };

      const result = analyzer.analyzeOverlap(event1, event2);
      expect(result.hasOverlap).toBe(false);
    });

    it('should handle all-day events', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Conference Day 1',
        start: { date: '2024-01-01' },
        end: { date: '2024-01-02' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Workshop',
        start: { dateTime: '2024-01-01T14:00:00Z' },
        end: { dateTime: '2024-01-01T16:00:00Z' }
      };

      const result = analyzer.analyzeOverlap(event1, event2);
      expect(result.hasOverlap).toBe(true);
    });

    it('should format long durations correctly', () => {
      const event1: calendar_v3.Schema$Event = {
        summary: 'Multi-day event',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-03T14:00:00Z' }
      };
      const event2: calendar_v3.Schema$Event = {
        summary: 'Another multi-day event',
        start: { dateTime: '2024-01-02T08:00:00Z' },
        end: { dateTime: '2024-01-04T12:00:00Z' }
      };

      const result = analyzer.analyzeOverlap(event1, event2);
      expect(result.hasOverlap).toBe(true);
      expect(result.duration).toContain('day');
    });
  });

  describe('findOverlappingEvents', () => {
    it('should find all overlapping events', () => {
      const targetEvent: calendar_v3.Schema$Event = {
        id: 'target',
        summary: 'Target Event',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T12:00:00Z' }
      };

      const events: calendar_v3.Schema$Event[] = [
        {
          id: '1',
          summary: 'Before - No overlap',
          start: { dateTime: '2024-01-01T08:00:00Z' },
          end: { dateTime: '2024-01-01T09:00:00Z' }
        },
        {
          id: '2',
          summary: 'Partial overlap at start',
          start: { dateTime: '2024-01-01T09:30:00Z' },
          end: { dateTime: '2024-01-01T10:30:00Z' }
        },
        {
          id: '3',
          summary: 'Full overlap',
          start: { dateTime: '2024-01-01T10:00:00Z' },
          end: { dateTime: '2024-01-01T12:00:00Z' }
        },
        {
          id: '4',
          summary: 'Partial overlap at end',
          start: { dateTime: '2024-01-01T11:30:00Z' },
          end: { dateTime: '2024-01-01T13:00:00Z' }
        },
        {
          id: '5',
          summary: 'After - No overlap',
          start: { dateTime: '2024-01-01T13:00:00Z' },
          end: { dateTime: '2024-01-01T14:00:00Z' }
        },
        {
          id: 'target',
          summary: 'Same event (should be skipped)',
          start: { dateTime: '2024-01-01T10:00:00Z' },
          end: { dateTime: '2024-01-01T12:00:00Z' }
        },
        {
          id: '6',
          summary: 'Cancelled event',
          status: 'cancelled',
          start: { dateTime: '2024-01-01T10:30:00Z' },
          end: { dateTime: '2024-01-01T11:30:00Z' }
        }
      ];

      const overlapping = analyzer.findOverlappingEvents(events, targetEvent);
      expect(overlapping).toHaveLength(3);
      expect(overlapping.map(e => e.id)).toEqual(['2', '3', '4']);
    });

    it('should handle empty event list', () => {
      const targetEvent: calendar_v3.Schema$Event = {
        summary: 'Target Event',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T12:00:00Z' }
      };

      const overlapping = analyzer.findOverlappingEvents([], targetEvent);
      expect(overlapping).toHaveLength(0);
    });

    it('should handle events without time information', () => {
      const targetEvent: calendar_v3.Schema$Event = {
        summary: 'Target Event',
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T12:00:00Z' }
      };

      const events: calendar_v3.Schema$Event[] = [
        {
          id: '1',
          summary: 'Event without time'
        },
        {
          id: '2',
          summary: 'Valid event',
          start: { dateTime: '2024-01-01T11:00:00Z' },
          end: { dateTime: '2024-01-01T13:00:00Z' }
        }
      ];

      const overlapping = analyzer.findOverlappingEvents(events, targetEvent);
      expect(overlapping).toHaveLength(1);
      expect(overlapping[0].id).toBe('2');
    });
  });
});