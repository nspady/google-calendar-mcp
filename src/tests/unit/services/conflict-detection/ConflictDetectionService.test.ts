import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictDetectionService } from '../../../../services/conflict-detection/ConflictDetectionService.js';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';

// Mock googleapis to intercept calendar.events.list calls
const listMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        list: listMock
      }
    })
  }
}));

describe('ConflictDetectionService - timezone normalization', () => {
  let service: ConflictDetectionService;
  let client: OAuth2Client;

  beforeEach(() => {
    service = new ConflictDetectionService();
    client = new OAuth2Client();
    listMock.mockReset();
  });

  it('detects overlap when new event is timezone-naive but includes timeZone', async () => {
    // Existing event on calendar (UTC times)
    const existingEvent: calendar_v3.Schema$Event = {
      id: 'existing',
      summary: 'Existing',
      start: { dateTime: '2025-01-01T18:00:00Z' }, // 10:00 AM PT
      end: { dateTime: '2025-01-01T19:00:00Z' }    // 11:00 AM PT
    };

    // Mock list call to return the existing event
    listMock.mockResolvedValue({
      data: { items: [existingEvent] }
    });

    const newEvent: calendar_v3.Schema$Event = {
      summary: 'New',
      start: { dateTime: '2025-01-01T10:00:00', timeZone: 'America/Los_Angeles' }, // naive local time
      end: { dateTime: '2025-01-01T11:00:00', timeZone: 'America/Los_Angeles' }
    };

    const result = await service.checkConflicts(client, newEvent, 'primary', {
      checkConflicts: true,
      checkDuplicates: false
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].event.id).toBe('existing');
  });

  it('does not flag back-to-back events as conflicts after normalization', async () => {
    const existingEvent: calendar_v3.Schema$Event = {
      id: 'existing',
      summary: 'Existing',
      start: { dateTime: '2025-01-01T18:00:00Z' }, // 10:00 AM PT
      end: { dateTime: '2025-01-01T19:00:00Z' }    // 11:00 AM PT
    };

    listMock.mockResolvedValue({
      data: { items: [existingEvent] }
    });

    const adjacentEvent: calendar_v3.Schema$Event = {
      summary: 'Adjacent',
      start: { dateTime: '2025-01-01T11:00:00', timeZone: 'America/Los_Angeles' }, // 11:00 AM PT
      end: { dateTime: '2025-01-01T12:00:00', timeZone: 'America/Los_Angeles' }
    };

    const result = await service.checkConflicts(client, adjacentEvent, 'primary', {
      checkConflicts: true,
      checkDuplicates: false
    });

    expect(result.conflicts).toHaveLength(0);
  });
});
