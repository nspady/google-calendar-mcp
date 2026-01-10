/**
 * Shared datetime utility mocks for handler tests.
 *
 * Usage:
 * ```typescript
 * import { datetimeMock } from '../mocks/datetime.js';
 * vi.mock('../../../utils/datetime.js', () => datetimeMock);
 * ```
 */
import { vi } from 'vitest';

/**
 * Mock implementation of datetime utilities.
 * Provides consistent behavior across all handler tests.
 */
export const datetimeMock = {
  hasTimezoneInDatetime: vi.fn((datetime: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)
  ),
  convertToRFC3339: vi.fn((datetime: string, _timezone: string) => {
    if (!datetime) return undefined;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(datetime)) {
      return datetime;
    }
    return `${datetime}Z`;
  }),
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
};
