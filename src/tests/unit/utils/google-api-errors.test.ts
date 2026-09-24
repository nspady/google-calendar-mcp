import { describe, it, expect } from 'vitest';
import { GaxiosError } from 'gaxios';
import { isCalendarNotAccessibleError } from '../../../utils/google-api-errors.js';

function apiError(status: number, reason?: string): GaxiosError {
  const data = reason ? { error: { errors: [{ reason }] } } : {};
  const error = new GaxiosError(`HTTP ${status}`, {} as any, { status, data } as any);
  error.response = { status, data } as any;
  return error;
}

describe('isCalendarNotAccessibleError', () => {
  it.each([
    [apiError(404), true],
    [apiError(403), true],
    [apiError(403, 'forbidden'), true],
    [apiError(403, 'rateLimitExceeded'), false],
    [apiError(403, 'userRateLimitExceeded'), false],
    [apiError(403, 'quotaExceeded'), false],
    [apiError(403, 'dailyLimitExceeded'), false],
    [apiError(500), false],
    [new Error('timeout'), false],
  ])('%#', (error, expected) => {
    expect(isCalendarNotAccessibleError(error)).toBe(expected);
  });
});
