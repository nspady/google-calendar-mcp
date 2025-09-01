import { describe, it, expect } from 'vitest';
import { formatConflictWarnings } from '../../../handlers/utils.js';
import { ConflictCheckResult } from '../../../services/conflict-detection/types.js';
import { calendar_v3 } from 'googleapis';

describe('Enhanced Conflict Response Formatting', () => {
  it('should format duplicate warnings with full event details', () => {
    const fullEvent: calendar_v3.Schema$Event = {
      id: 'duplicate123',
      summary: 'Team Meeting',
      description: 'Weekly team sync',
      location: 'Conference Room A',
      start: { dateTime: '2024-01-15T10:00:00Z' },
      end: { dateTime: '2024-01-15T11:00:00Z' },
      attendees: [
        { email: 'john@example.com', displayName: 'John Doe', responseStatus: 'accepted' }
      ],
      htmlLink: 'https://calendar.google.com/event?eid=duplicate123'
    };

    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [{
        event: {
          id: 'duplicate123',
          title: 'Team Meeting',
          url: 'https://calendar.google.com/event?eid=duplicate123',
          similarity: 0.95
        },
        fullEvent: fullEvent,
        suggestion: 'This appears to be a duplicate. Consider updating the existing event instead.'
      }],
      conflicts: []
    };

    const formatted = formatConflictWarnings(conflicts);
    
    expect(formatted).toContain('POTENTIAL DUPLICATES DETECTED');
    expect(formatted).toContain('95% similar');
    expect(formatted).toContain('Existing event details:');
    expect(formatted).toContain('Event: Team Meeting');
    expect(formatted).toContain('Event ID: duplicate123');
    expect(formatted).toContain('Description: Weekly team sync');
    expect(formatted).toContain('Location: Conference Room A');
    expect(formatted).toContain('John Doe (accepted)');
    expect(formatted).toContain('View: https://calendar.google.com/event?eid=duplicate123');
  });

  it('should format conflict warnings with full event details', () => {
    const conflictingEvent: calendar_v3.Schema$Event = {
      id: 'conflict456',
      summary: 'Design Review',
      description: 'Q4 design review meeting',
      location: 'Room 201',
      start: { dateTime: '2024-01-15T13:30:00Z' },
      end: { dateTime: '2024-01-15T14:30:00Z' },
      htmlLink: 'https://calendar.google.com/event?eid=conflict456'
    };

    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [],
      conflicts: [{
        type: 'overlap',
        calendar: 'primary',
        event: {
          id: 'conflict456',
          title: 'Design Review',
          url: 'https://calendar.google.com/event?eid=conflict456',
          start: '2024-01-15T13:30:00Z',
          end: '2024-01-15T14:30:00Z'
        },
        fullEvent: conflictingEvent,
        overlap: {
          duration: '30 minutes',
          percentage: 50,
          startTime: '2024-01-15T13:30:00Z',
          endTime: '2024-01-15T14:00:00Z'
        }
      }]
    };

    const formatted = formatConflictWarnings(conflicts);
    
    expect(formatted).toContain('SCHEDULING CONFLICTS DETECTED');
    expect(formatted).toContain('Calendar: primary');
    expect(formatted).toContain('Conflicting Event');
    expect(formatted).toContain('Overlap: 30 minutes (50% of your event)');
    expect(formatted).toContain('Conflicting event details:');
    expect(formatted).toContain('Event: Design Review');
    expect(formatted).toContain('Description: Q4 design review meeting');
    expect(formatted).toContain('Location: Room 201');
  });

  it('should fallback gracefully when full event details are not available', () => {
    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [{
        event: {
          id: 'dup789',
          title: 'Standup',
          url: 'https://calendar.google.com/event?eid=dup789',
          similarity: 0.85
        },
        suggestion: 'This event is very similar to an existing one. Is this intentional?'
      }],
      conflicts: []
    };

    const formatted = formatConflictWarnings(conflicts);
    
    expect(formatted).toContain('POTENTIAL DUPLICATES DETECTED');
    expect(formatted).toContain('85% similar');
    expect(formatted).toContain('"Standup"');
    expect(formatted).toContain('View existing event: https://calendar.google.com/event?eid=dup789');
    expect(formatted).not.toContain('Existing event details:'); // Should not show this section
  });

  it('should format multiple conflicts with proper separation', () => {
    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [],
      conflicts: [
        {
          type: 'overlap',
          calendar: 'work@company.com',
          event: {
            id: 'work1',
            title: 'Sprint Planning',
            url: 'https://calendar.google.com/event?eid=work1'
          },
          fullEvent: {
            id: 'work1',
            summary: 'Sprint Planning',
            start: { dateTime: '2024-01-15T09:00:00Z' },
            end: { dateTime: '2024-01-15T10:00:00Z' }
          },
          overlap: {
            duration: '15 minutes',
            percentage: 25,
            startTime: '2024-01-15T09:45:00Z',
            endTime: '2024-01-15T10:00:00Z'
          }
        },
        {
          type: 'overlap',
          calendar: 'work@company.com',
          event: {
            id: 'work2',
            title: 'Daily Standup',
            url: 'https://calendar.google.com/event?eid=work2'
          },
          overlap: {
            duration: '30 minutes',
            percentage: 100,
            startTime: '2024-01-15T10:00:00Z',
            endTime: '2024-01-15T10:30:00Z'
          }
        }
      ]
    };

    const formatted = formatConflictWarnings(conflicts);
    
    expect(formatted).toContain('Calendar: work@company.com');
    expect(formatted.match(/━━━ Conflicting Event ━━━/g)).toHaveLength(2);
    expect(formatted).toContain('Sprint Planning');
    expect(formatted).toContain('Daily Standup');
    expect(formatted).toContain('15 minutes (25% of your event)');
    expect(formatted).toContain('30 minutes (100% of your event)');
  });
});