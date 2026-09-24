import { GaxiosError } from 'gaxios';

// 403 reasons that mean "slow down", not "no access"
const RATE_LIMIT_REASON = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded/;

/**
 * True for 403/404 from a calendar lookup: the calendar isn't visible to this account
 * (e.g. shared by ID but not in its calendar list). Expected, unlike timeouts or 5xx.
 * Rate-limit and quota 403s are excluded: they are transient failures, not access errors.
 */
export function isCalendarNotAccessibleError(error: unknown): boolean {
  if (!(error instanceof GaxiosError)) {
    return false;
  }
  const status = error.response?.status;
  if (status === 404) {
    return true;
  }
  if (status !== 403) {
    return false;
  }
  const data = error.response?.data as { error?: { errors?: Array<{ reason?: string }> } } | undefined;
  const reasons = (data?.error?.errors ?? []).map(e => e.reason ?? '').join(' ');
  return !RATE_LIMIT_REASON.test(reasons);
}
