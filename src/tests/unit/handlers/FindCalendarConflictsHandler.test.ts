import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FindCalendarConflictsHandler } from '../../../handlers/core/FindCalendarConflictsHandler.js';
import { OAuth2Client } from 'google-auth-library';

describe('FindCalendarConflictsHandler', () => {
  let handler: FindCalendarConflictsHandler;
  let workClient: OAuth2Client;
  let personalClient: OAuth2Client;
  let accounts: Map<string, OAuth2Client>;

  beforeEach(() => {
    handler = new FindCalendarConflictsHandler();
    workClient = new OAuth2Client();
    personalClient = new OAuth2Client();
    accounts = new Map([
      ['work', workClient],
      ['personal', personalClient]
    ]);

    vi.spyOn(handler as any, 'resolveCalendarIds').mockImplementation(async (_client, ids: string[]) => ids);
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('UTC');
  });

  const createCalendarMock = (events: any[]) => ({
    events: {
      list: vi.fn().mockResolvedValue({
        data: {
          items: events
        }
      })
    }
  });

  it('detects overlapping events across different accounts', async () => {
    const workEvents = [
      {
        id: 'work-1',
        summary: 'Work Standup',
        start: { dateTime: '2025-01-01T17:00:00Z' },
        end: { dateTime: '2025-01-01T17:30:00Z' }
      }
    ];
    const personalEvents = [
      {
        id: 'personal-1',
        summary: 'Gym',
        start: { dateTime: '2025-01-01T17:15:00Z' },
        end: { dateTime: '2025-01-01T18:00:00Z' }
      }
    ];

    vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => {
      if (client === workClient) {
        return createCalendarMock(workEvents);
      }
      return createCalendarMock(personalEvents);
    });

    const result = await handler.runTool({
      account: ['work', 'personal'],
      calendarId: 'primary',
      timeMin: '2025-01-01T00:00:00Z',
      timeMax: '2025-01-02T00:00:00Z'
    }, accounts);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalConflicts).toBe(1);
    expect(parsed.conflicts[0].accountsInvolved).toEqual(['work', 'personal']);
    expect(parsed.conflicts[0].events).toHaveLength(2);
    expect(parsed.conflicts[0].events.map((entry: any) => entry.accountId)).toContain('work');
    expect(parsed.conflicts[0].events.map((entry: any) => entry.accountId)).toContain('personal');
  });

  it('returns empty conflicts when schedules do not overlap', async () => {
    const workEvents = [
      {
        id: 'work-1',
        summary: 'Morning sync',
        start: { dateTime: '2025-01-01T16:00:00Z' },
        end: { dateTime: '2025-01-01T16:30:00Z' }
      }
    ];
    const personalEvents = [
      {
        id: 'personal-1',
        summary: 'Lunch',
        start: { dateTime: '2025-01-01T18:00:00Z' },
        end: { dateTime: '2025-01-01T18:30:00Z' }
      }
    ];

    vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => {
      if (client === workClient) {
        return createCalendarMock(workEvents);
      }
      return createCalendarMock(personalEvents);
    });

    const result = await handler.runTool({
      account: ['work', 'personal'],
      calendarId: 'primary',
      timeMin: '2025-01-01T00:00:00Z',
      timeMax: '2025-01-02T00:00:00Z'
    }, accounts);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalConflicts).toBe(0);
    expect(parsed.conflicts).toHaveLength(0);
  });

  it('defaults to primary calendar when calendarId omitted', async () => {
    const workEvents = [
      {
        id: 'work-1',
        summary: 'Interview',
        start: { dateTime: '2025-01-02T10:00:00Z' },
        end: { dateTime: '2025-01-02T11:00:00Z' }
      }
    ];
    const personalEvents = [
      {
        id: 'personal-1',
        summary: 'Doctor',
        start: { dateTime: '2025-01-02T10:30:00Z' },
        end: { dateTime: '2025-01-02T11:30:00Z' }
      }
    ];

    vi.spyOn(handler as any, 'getCalendar').mockImplementation((client: OAuth2Client) => {
      if (client === workClient) {
        return createCalendarMock(workEvents);
      }
      return createCalendarMock(personalEvents);
    });

    const result = await handler.runTool({
      account: ['work', 'personal'],
      timeMin: '2025-01-02T00:00:00Z',
      timeMax: '2025-01-03T00:00:00Z'
    }, accounts);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.accounts).toEqual(['work', 'personal']);
    expect(parsed.totalConflicts).toBe(1);
    expect(parsed.timeRange.start).toBe('2025-01-02T00:00:00Z');
  });
});
