import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import {
  API_BASE_URL_ENV,
  DEFAULT_API_ORIGIN,
  getApiBaseUrl,
  rewriteApiUrl,
  applyApiBaseUrl,
} from '../../../utils/api-base-url.js';
import { BatchRequestHandler } from '../../../handlers/core/BatchRequestHandler.js';

const OVERRIDE = 'http://127.0.0.1:10255/tenant-a/calendar';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe(API_BASE_URL_ENV, () => {
  const original = process.env[API_BASE_URL_ENV];

  beforeEach(() => {
    delete process.env[API_BASE_URL_ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[API_BASE_URL_ENV];
    else process.env[API_BASE_URL_ENV] = original;
    vi.restoreAllMocks();
  });

  describe('getApiBaseUrl', () => {
    it('defaults to the public Google API origin', () => {
      expect(getApiBaseUrl()).toBe(DEFAULT_API_ORIGIN);
    });

    it('returns the override without a trailing slash', () => {
      process.env[API_BASE_URL_ENV] = `${OVERRIDE}/`;
      expect(getApiBaseUrl()).toBe(OVERRIDE);
    });

    it('treats a blank value as unset', () => {
      process.env[API_BASE_URL_ENV] = '  ';
      expect(getApiBaseUrl()).toBe(DEFAULT_API_ORIGIN);
    });

    it('rejects a value that is not an absolute http(s) URL', () => {
      process.env[API_BASE_URL_ENV] = 'proxy.internal/calendar';
      expect(() => getApiBaseUrl()).toThrow(new RegExp(API_BASE_URL_ENV));
    });
  });

  describe('rewriteApiUrl', () => {
    it('keeps the path prefix and the query string', () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      expect(rewriteApiUrl('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5').href).toBe(
        `${OVERRIDE}/calendar/v3/users/me/calendarList?maxResults=5`
      );
    });

    it('leaves other hosts alone (token refresh stays on oauth2.googleapis.com)', () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      expect(rewriteApiUrl('https://oauth2.googleapis.com/token').href).toBe('https://oauth2.googleapis.com/token');
    });

    it('is the identity when unset', () => {
      const url = 'https://www.googleapis.com/calendar/v3/calendars/primary';
      expect(rewriteApiUrl(url).href).toBe(url);
    });
  });

  describe('applyApiBaseUrl', () => {
    it('sends googleapis calendar calls to the override, prefix included', async () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      const fetchImplementation = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
      const client = applyApiBaseUrl(new OAuth2Client({ transporterOptions: { fetchImplementation } }));
      client.setCredentials({ access_token: 'stub', expiry_date: Date.now() + 3_600_000 });

      const calendar = google.calendar({ version: 'v3', auth: client });
      await calendar.calendarList.list({ maxResults: 5 });

      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      const url = fetchImplementation.mock.calls[0][0];
      expect(String(url)).toBe(`${OVERRIDE}/calendar/v3/users/me/calendarList?maxResults=5`);
    });

    it('adds nothing when unset', () => {
      const client = new OAuth2Client();
      const before = client.transporter.interceptors.request.size;
      applyApiBaseUrl(client);
      expect(client.transporter.interceptors.request.size).toBe(before);
    });

    it('returns the same client so it can be chained', () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      const client = new OAuth2Client();
      expect(applyApiBaseUrl(client)).toBe(client);
    });
  });

  describe('BatchRequestHandler', () => {
    it('posts the batch to the override', async () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      // The response body is not under test; only where the POST went.
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
      const auth = { getAccessToken: vi.fn().mockResolvedValue({ token: 'stub' }) } as unknown as OAuth2Client;
      await new BatchRequestHandler(auth)
        .executeBatch([{ method: 'GET', path: '/calendar/v3/calendars/primary' }])
        .catch(() => undefined);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${OVERRIDE}/batch/calendar/v3`);
    });
  });
});
