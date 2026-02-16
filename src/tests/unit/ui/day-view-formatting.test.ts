import { describe, it, expect } from 'vitest';
import {
  setHostContext,
  formatDateHeading,
  formatAllDayRange,
  formatMultiDayDate
} from '../../../ui/day-view/modules/formatting.js';

describe('day-view formatting date-only behavior', () => {
  it('formatDateHeading keeps date-only values stable across host timezones', () => {
    setHostContext('en-US', 'Pacific/Kiritimati');
    expect(formatDateHeading('2026-01-01')).toBe('Thursday, January 1, 2026');

    setHostContext('en-US', 'America/Adak');
    expect(formatDateHeading('2026-01-01')).toBe('Thursday, January 1, 2026');
  });

  it('formatAllDayRange treats end date as exclusive', () => {
    setHostContext('en-US', 'Pacific/Kiritimati');

    const singleDay = formatAllDayRange('2026-01-01', '2026-01-02');
    expect(singleDay.isMultiDay).toBe(false);
    expect(singleDay.dateRange).toBe('Jan 1');

    const multiDay = formatAllDayRange('2026-01-01', '2026-01-04');
    expect(multiDay.isMultiDay).toBe(true);
    expect(multiDay.dateRange).toContain('Jan 1');
    expect(multiDay.dateRange).toContain('Jan 3');
  });

  it('formatMultiDayDate keeps YYYY-MM-DD day number stable', () => {
    setHostContext('en-US', 'America/Adak');

    const formatted = formatMultiDayDate('2026-01-01');
    expect(formatted.day).toBe('1');
    expect(formatted.monthYearDay).toContain('JAN 2026');
  });
});
