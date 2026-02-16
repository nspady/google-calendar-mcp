import { describe, it, expect } from 'vitest';
import { computeCalendarFilters, computeCalendarSummary } from '../../../ui/day-view/modules/utilities.js';
import type { DayViewEvent, MultiDayViewEvent } from '../../../ui/day-view/modules/types.js';

describe('day-view utilities', () => {
  it('computeCalendarFilters keeps per-account calendars separate', () => {
    const events: DayViewEvent[] = [
      {
        id: '1',
        summary: 'Work primary event',
        start: '2026-01-27T09:00:00',
        end: '2026-01-27T10:00:00',
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary',
        calendarName: 'Primary',
        accountId: 'work',
        backgroundColor: '#4285f4'
      },
      {
        id: '2',
        summary: 'Personal primary event',
        start: '2026-01-27T11:00:00',
        end: '2026-01-27T12:00:00',
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary',
        calendarName: 'Primary',
        accountId: 'personal',
        backgroundColor: '#34a853'
      }
    ];

    const filters = computeCalendarFilters(events);

    expect(filters).toHaveLength(2);
    expect(filters.map(f => f.accountId).sort()).toEqual(['personal', 'work']);
    expect(filters.every(f => f.calendarId === 'primary')).toBe(true);
  });

  it('computeCalendarSummary keeps per-account calendars separate', () => {
    const events: MultiDayViewEvent[] = [
      {
        id: '1',
        summary: 'Work primary event',
        start: '2026-01-27T09:00:00',
        end: '2026-01-27T10:00:00',
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary',
        calendarName: 'Primary',
        accountId: 'work',
        backgroundColor: '#4285f4'
      },
      {
        id: '2',
        summary: 'Personal primary event',
        start: '2026-01-27T11:00:00',
        end: '2026-01-27T12:00:00',
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary',
        calendarName: 'Primary',
        accountId: 'personal',
        backgroundColor: '#34a853'
      }
    ];

    const summary = computeCalendarSummary(events);

    expect(summary).toHaveLength(2);
    expect(summary.map(s => s.calendarId)).toEqual(['primary', 'primary']);
    expect(summary.map(s => s.count)).toEqual([1, 1]);
  });
});
