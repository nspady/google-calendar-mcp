/**
 * Shared googleapis mocks for handler tests.
 *
 * Usage for calendar events mock:
 * ```typescript
 * import { createGoogleapisMock } from '../mocks/googleapis.js';
 * vi.mock('googleapis', () => createGoogleapisMock(['list', 'insert', 'update', 'delete']));
 * ```
 */
import { vi } from 'vitest';

type EventMethod = 'list' | 'insert' | 'update' | 'delete' | 'get' | 'patch';
type FreebusyMethod = 'query';
type CalendarListMethod = 'list' | 'get';
type CalendarsMethod = 'get';

interface GoogleapisMockOptions {
  events?: EventMethod[];
  freebusy?: FreebusyMethod[];
  calendarList?: CalendarListMethod[];
  calendars?: CalendarsMethod[];
}

/**
 * Creates a googleapis mock with the specified methods.
 * All methods default to vi.fn() that can be configured in tests.
 */
export function createGoogleapisMock(options: GoogleapisMockOptions = {}) {
  const eventsMock: Record<string, ReturnType<typeof vi.fn>> = {};
  const freebusyMock: Record<string, ReturnType<typeof vi.fn>> = {};
  const calendarListMock: Record<string, ReturnType<typeof vi.fn>> = {};
  const calendarsMock: Record<string, ReturnType<typeof vi.fn>> = {};

  // Create event method mocks
  if (options.events) {
    for (const method of options.events) {
      eventsMock[method] = vi.fn();
    }
  }

  // Create freebusy method mocks
  if (options.freebusy) {
    for (const method of options.freebusy) {
      freebusyMock[method] = vi.fn();
    }
  }

  // Create calendarList method mocks
  if (options.calendarList) {
    for (const method of options.calendarList) {
      calendarListMock[method] = vi.fn();
    }
  }

  // Create calendars method mocks
  if (options.calendars) {
    for (const method of options.calendars) {
      calendarsMock[method] = vi.fn();
    }
  }

  return {
    google: {
      calendar: vi.fn(() => ({
        events: Object.keys(eventsMock).length > 0 ? eventsMock : undefined,
        freebusy: Object.keys(freebusyMock).length > 0 ? freebusyMock : undefined,
        calendarList: Object.keys(calendarListMock).length > 0 ? calendarListMock : undefined,
        calendars: Object.keys(calendarsMock).length > 0 ? calendarsMock : undefined
      }))
    },
    calendar_v3: {}
  };
}

/**
 * Simple googleapis mock with events.list only.
 * Common for read-only handlers.
 */
export const googleapisListMock = createGoogleapisMock({ events: ['list'] });

/**
 * Simple googleapis mock with events.insert only.
 * Common for create handlers.
 */
export const googleapisInsertMock = createGoogleapisMock({ events: ['insert'] });

/**
 * Simple googleapis mock with freebusy.query only.
 */
export const googleapisFreebusyMock = createGoogleapisMock({ freebusy: ['query'] });
