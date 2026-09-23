import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictDetectionService } from '../../../../services/conflict-detection/ConflictDetectionService.js';
import { OAuth2Client } from 'google-auth-library';
import { calendar_v3 } from 'googleapis';
import { GaxiosError } from 'gaxios';
import { createWarningsArray } from '../../../../utils/response-builder.js';

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

describe('ConflictDetectionService - calendars that cannot be checked', () => {
  const newEvent: calendar_v3.Schema$Event = {
    summary: 'New',
    start: { dateTime: '2025-01-01T10:00:00Z' },
    end: { dateTime: '2025-01-01T11:00:00Z' }
  };

  function apiError(status: number): GaxiosError {
    const error = new GaxiosError(`HTTP ${status}`, {} as any, { status, data: {} } as any);
    error.response = { status, data: {} } as any;
    return error;
  }

  beforeEach(() => {
    listMock.mockReset();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('skips calendars without access quietly', async () => {
    listMock.mockRejectedValue(apiError(404));
    const result = await new ConflictDetectionService().checkConflicts(new OAuth2Client(), newEvent, 'primary', {
      calendarsToCheck: ['primary', 'shared@example.com']
    });
    expect(result.hasConflicts).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it('warns when a calendar check fails for another reason', async () => {
    listMock
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockRejectedValueOnce(new Error('timeout of 3000ms exceeded'));
    const result = await new ConflictDetectionService().checkConflicts(new OAuth2Client(), newEvent, 'primary', {
      calendarsToCheck: ['primary', 'team@example.com']
    });
    expect(result.hasConflicts).toBe(false);
    expect(result.warnings).toEqual(['Could not check calendar "team@example.com" for conflicts: timeout of 3000ms exceeded']);
    expect(createWarningsArray(result)).toEqual(result.warnings);
  });
});
