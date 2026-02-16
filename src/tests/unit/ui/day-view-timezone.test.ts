import { describe, it, expect } from 'vitest';
import { calculateEventPosition } from '../../../ui/day-view/modules/positioning.js';
import { calculateAvailableSlots } from '../../../ui/day-view/modules/utilities.js';
import type { DayViewEvent } from '../../../ui/day-view/modules/types.js';

describe('day-view timezone behavior', () => {
  it('calculateEventPosition uses the supplied timezone for vertical placement', () => {
    const event: DayViewEvent = {
      id: 'tokyo-morning',
      summary: 'Tokyo morning event',
      start: '2026-01-27T00:00:00Z', // 09:00 in Asia/Tokyo
      end: '2026-01-27T01:30:00Z',   // 10:30 in Asia/Tokyo
      isAllDay: false,
      htmlLink: 'https://calendar.google.com',
      calendarId: 'primary'
    };

    const position = calculateEventPosition(event, 8, 18, 'Asia/Tokyo');

    expect(position.top).toBe('48px');     // 1 hour after 8:00
    expect(position.height).toBe('72px');  // 1.5 hours * 48px
  });

  it('calculateAvailableSlots uses the supplied timezone for free/busy windows', () => {
    const events: DayViewEvent[] = [
      {
        id: 'busy-9am-jst',
        summary: 'Busy at 9 AM JST',
        start: '2026-01-27T00:00:00Z', // 09:00 JST
        end: '2026-01-27T01:00:00Z',   // 10:00 JST
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary'
      }
    ];

    const slots = calculateAvailableSlots(events, 60, 9, 12, 'Asia/Tokyo');

    expect(slots.map(s => [s.startMinutes, s.endMinutes])).toEqual([
      [600, 660], // 10:00-11:00
      [660, 720], // 11:00-12:00
    ]);
  });

  it('handles DST fall-back repeated hour without collapsing to a tiny block', () => {
    const event: DayViewEvent = {
      id: 'dst-fall-back',
      summary: 'Crosses repeated 1 AM hour',
      // 2026-11-01 in Los Angeles: 01:30 PDT -> 01:30 PST (1 real hour)
      start: '2026-11-01T08:30:00Z',
      end: '2026-11-01T09:30:00Z',
      isAllDay: false,
      htmlLink: 'https://calendar.google.com',
      calendarId: 'primary'
    };

    const position = calculateEventPosition(event, 0, 6, 'America/Los_Angeles');

    expect(position.top).toBe('72px');
    expect(position.height).toBe('48px');
  });

  it('handles DST fall-back repeated hour in available-slot calculations', () => {
    const events: DayViewEvent[] = [
      {
        id: 'dst-fall-back-busy',
        summary: 'Busy during repeated hour',
        // 01:30 PDT -> 01:30 PST (1 real hour)
        start: '2026-11-01T08:30:00Z',
        end: '2026-11-01T09:30:00Z',
        isAllDay: false,
        htmlLink: 'https://calendar.google.com',
        calendarId: 'primary'
      }
    ];

    const slots = calculateAvailableSlots(events, 30, 1, 4, 'America/Los_Angeles');

    expect(slots.map(s => [s.startMinutes, s.endMinutes])).toEqual([
      [60, 90],
      [150, 180],
      [180, 210],
      [210, 240],
    ]);
  });
});
