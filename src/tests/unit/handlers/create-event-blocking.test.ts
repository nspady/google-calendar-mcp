import { describe, it, expect, vi } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';
import { CONFLICT_DETECTION_CONFIG } from '../../../services/conflict-detection/config.js';

describe('CreateEventHandler Blocking Logic', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;

  it('should show full event details when blocking due to high similarity', async () => {
    const handler = new CreateEventHandler();
    
    // Mock the conflict detection service
    const existingEvent: calendar_v3.Schema$Event = {
      id: 'existing-lunch-123',
      summary: 'Lunch with Josh',
      description: 'Monthly catch-up lunch',
      location: 'The Coffee Shop',
      start: { 
        dateTime: '2024-01-15T12:00:00-08:00',
        timeZone: 'America/Los_Angeles'
      },
      end: { 
        dateTime: '2024-01-15T13:00:00-08:00',
        timeZone: 'America/Los_Angeles'
      },
      attendees: [
        { email: 'josh@example.com', displayName: 'Josh', responseStatus: 'accepted' }
      ],
      htmlLink: 'https://calendar.google.com/calendar/event?eid=existing-lunch-123'
    };

    // Mock the checkConflicts method to return a high similarity duplicate
    vi.spyOn(handler['conflictDetectionService'], 'checkConflicts').mockResolvedValue({
      hasConflicts: true,
      duplicates: [{
        event: {
          id: 'existing-lunch-123',
          title: 'Lunch with Josh',
          url: 'https://calendar.google.com/calendar/event?eid=existing-lunch-123',
          similarity: 1.0 // 100% similar
        },
        fullEvent: existingEvent,
        calendarId: 'primary',
        suggestion: 'This appears to be a duplicate. Consider updating the existing event instead.'
      }],
      conflicts: []
    });

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');

    const args = {
      calendarId: 'primary',
      summary: 'Lunch with Josh',
      start: '2024-01-15T12:00:00',
      end: '2024-01-15T13:00:00',
      location: 'The Coffee Shop'
    };

    // Now it should throw an error instead of returning a text message
    await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
      'Duplicate event detected (100% similar). Event "Lunch with Josh" already exists. To create anyway, set allowDuplicates to true.'
    );
  });

  it('should use centralized threshold configuration', () => {
    // Verify that the config has the expected thresholds
    expect(CONFLICT_DETECTION_CONFIG.DEFAULT_DUPLICATE_THRESHOLD).toBe(0.7);
    expect(CONFLICT_DETECTION_CONFIG.DUPLICATE_THRESHOLDS.WARNING).toBe(0.7);
    expect(CONFLICT_DETECTION_CONFIG.DUPLICATE_THRESHOLDS.BLOCKING).toBe(0.95);
  });
});