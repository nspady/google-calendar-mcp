import { describe, it, expect, vi } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';

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

    const result = await handler.runTool(args, mockOAuth2Client);
    const response = result.content[0].text;

    // Verify the response format
    expect(response).toContain('⚠️ DUPLICATE EVENT DETECTED!');
    
    // Should show similarity percentage
    expect(response).toContain('100% similar');
    
    // Should show the duplicate suggestion
    expect(response).toContain('This appears to be a duplicate. Consider updating the existing event instead.');
    
    // Should show full event details
    expect(response).toContain('Existing event details:');
    expect(response).toContain('Event: Lunch with Josh');
    expect(response).toContain('Event ID: existing-lunch-123');
    expect(response).toContain('Description: Monthly catch-up lunch');
    expect(response).toContain('Location: The Coffee Shop');
    expect(response).toContain('Guests: Josh (accepted)');
    
    // Should include the view link
    expect(response).toContain('View: https://calendar.google.com/calendar/event?eid=existing-lunch-123');
    
    // Should include instructions to override
    expect(response).toContain('To create anyway, set blockOnHighSimilarity to false.');
  });

  it('should use configurable thresholds', () => {
    const handler = new CreateEventHandler();
    
    // Check that the thresholds are properly defined
    expect(handler['BLOCK_SIMILARITY_THRESHOLD']).toBe(0.9);
    expect(handler['DEFAULT_DUPLICATE_THRESHOLD']).toBe(0.8);
  });
});