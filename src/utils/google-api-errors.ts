import { GaxiosError } from 'gaxios';

/**
 * True for 403/404 from a calendar lookup: the calendar isn't visible to this account
 * (e.g. shared by ID but not in its calendar list). Expected, unlike timeouts or 5xx.
 */
export function isCalendarNotAccessibleError(error: unknown): boolean {
  const status = error instanceof GaxiosError ? error.response?.status : undefined;
  return status === 403 || status === 404;
}
