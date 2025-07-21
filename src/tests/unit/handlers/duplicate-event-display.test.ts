import { describe, it, expect } from 'vitest';
import { formatConflictWarnings } from '../../../handlers/utils.js';
import { ConflictCheckResult } from '../../../services/conflict-detection/types.js';
import { calendar_v3 } from 'googleapis';

describe('Duplicate Event Display', () => {
  it('should show full formatted event details for duplicates with calendarId', () => {
    const duplicateEvent: calendar_v3.Schema$Event = {
      id: 'dup123',
      summary: 'Weekly Team Standup',
      description: 'Weekly sync with the engineering team',
      location: 'Conference Room B',
      start: { 
        dateTime: '2024-01-15T10:00:00-08:00',
        timeZone: 'America/Los_Angeles'
      },
      end: { 
        dateTime: '2024-01-15T10:30:00-08:00',
        timeZone: 'America/Los_Angeles'
      },
      attendees: [
        { email: 'alice@example.com', displayName: 'Alice', responseStatus: 'accepted' },
        { email: 'bob@example.com', displayName: 'Bob', responseStatus: 'needsAction' }
      ],
      organizer: {
        email: 'team-lead@example.com',
        displayName: 'Team Lead'
      },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }]
      }
    };

    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [{
        event: {
          id: 'dup123',
          title: 'Weekly Team Standup',
          url: 'https://calendar.google.com/calendar/event?eid=dup123&cid=primary',
          similarity: 0.85
        },
        fullEvent: duplicateEvent,
        calendarId: 'primary',
        suggestion: 'This event is very similar to an existing one. Is this intentional?'
      }],
      conflicts: []
    };

    const formatted = formatConflictWarnings(conflicts);
    
    // Verify the header
    expect(formatted).toContain('POTENTIAL DUPLICATES DETECTED');
    expect(formatted).toContain('85% similar');
    expect(formatted).toContain('This event is very similar to an existing one. Is this intentional?');
    
    // Verify full event details are shown
    expect(formatted).toContain('Existing event details:');
    expect(formatted).toContain('Event: Weekly Team Standup');
    expect(formatted).toContain('Event ID: dup123');
    expect(formatted).toContain('Description: Weekly sync with the engineering team');
    expect(formatted).toContain('Location: Conference Room B');
    
    // Verify time formatting
    expect(formatted).toContain('Start:');
    expect(formatted).toContain('End:');
    expect(formatted).toContain('PST'); // Should show timezone
    
    // Verify attendees
    expect(formatted).toContain('Guests: Alice (accepted), Bob (pending)');
    
    // Verify the URL is generated with calendarId
    expect(formatted).toContain('View: https://calendar.google.com/calendar/event?eid=dup123&cid=primary');
  });

  it('should show multiple duplicates with their full details', () => {
    const dup1: calendar_v3.Schema$Event = {
      id: 'morning-standup',
      summary: 'Team Standup',
      start: { dateTime: '2024-01-15T09:00:00Z' },
      end: { dateTime: '2024-01-15T09:15:00Z' }
    };

    const dup2: calendar_v3.Schema$Event = {
      id: 'daily-standup',
      summary: 'Daily Team Standup',
      description: 'Quick sync',
      start: { dateTime: '2024-01-15T09:00:00Z' },
      end: { dateTime: '2024-01-15T09:30:00Z' },
      location: 'Zoom'
    };

    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [
        {
          event: {
            id: 'morning-standup',
            title: 'Team Standup',
            similarity: 0.75
          },
          fullEvent: dup1,
          calendarId: 'primary',
          suggestion: 'This event is very similar to an existing one. Is this intentional?'
        },
        {
          event: {
            id: 'daily-standup',
            title: 'Daily Team Standup',
            similarity: 0.82
          },
          fullEvent: dup2,
          calendarId: 'work@company.com',
          suggestion: 'This event is very similar to an existing one. Is this intentional?'
        }
      ],
      conflicts: []
    };

    const formatted = formatConflictWarnings(conflicts);
    
    // Should have two duplicate sections
    expect(formatted.match(/━━━ Duplicate Event/g)).toHaveLength(2);
    
    // First duplicate
    expect(formatted).toContain('75% similar');
    expect(formatted).toContain('Event: Team Standup');
    expect(formatted).toContain('Event ID: morning-standup');
    
    // Second duplicate
    expect(formatted).toContain('82% similar');
    expect(formatted).toContain('Event: Daily Team Standup');
    expect(formatted).toContain('Description: Quick sync');
    expect(formatted).toContain('Location: Zoom');
  });

  it('should handle duplicates without full event details gracefully', () => {
    const conflicts: ConflictCheckResult = {
      hasConflicts: true,
      duplicates: [{
        event: {
          id: 'basic-dup',
          title: 'Meeting',
          url: 'https://calendar.google.com/event/basic-dup',
          similarity: 0.7
        },
        suggestion: 'This event is very similar to an existing one. Is this intentional?'
      }],
      conflicts: []
    };

    const formatted = formatConflictWarnings(conflicts);
    
    expect(formatted).toContain('70% similar');
    expect(formatted).toContain('"Meeting"');
    expect(formatted).toContain('View existing event: https://calendar.google.com/event/basic-dup');
    expect(formatted).not.toContain('Existing event details:');
  });
});