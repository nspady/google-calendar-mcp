import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { API_BASE_URL_ENV, DEFAULT_API_ORIGIN, getApiBaseUrl } from '../../../config/AppConfig.js';
import { rewriteApiUrl, applyApiBaseUrl } from '../../../utils/api-base-url.js';
import { BatchRequestHandler } from '../../../handlers/core/BatchRequestHandler.js';

const OVERRIDE = 'http://127.0.0.1:10255/tenant-a/calendar';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** An OAuth2Client with a stub token and a fetch mock, routed through applyApiBaseUrl. */
function routedClient() {
  const fetchImplementation = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
  const client = applyApiBaseUrl(new OAuth2Client({ transporterOptions: { fetchImplementation } }));
  client.setCredentials({ access_token: 'stub', expiry_date: Date.now() + 3_600_000 });
  return { client, fetchImplementation };
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

    it.each([
      ['a query string', `${OVERRIDE}?k=v`, /query/],
      ['a fragment', `${OVERRIDE}#frag`, /fragment/],
      ['a username', 'http://user@127.0.0.1:10255/tenant-a/calendar', /credentials/],
      ['a username and password', 'http://user:pw@127.0.0.1:10255/tenant-a/calendar', /credentials/],
    ])('rejects a base with %s', (_, value, reason) => {
      process.env[API_BASE_URL_ENV] = value;
      expect(() => getApiBaseUrl()).toThrow(reason);
    });

    it.each(['?', '#', '/?', '/#'])('drops an empty trailing %s', (suffix) => {
      process.env[API_BASE_URL_ENV] = `${OVERRIDE}${suffix}`;
      expect(getApiBaseUrl()).toBe(OVERRIDE);
    });

    it.each([
      'ftp://user:s3cret@proxy',
      'http://user:s3cret@proxy/calendar',
    ])('keeps the value out of the error for %s', (value) => {
      process.env[API_BASE_URL_ENV] = value;
      expect(() => getApiBaseUrl()).toThrow(new RegExp(API_BASE_URL_ENV));
      expect(() => getApiBaseUrl()).not.toThrow(/s3cret/);
    });
  });

  describe('rewriteApiUrl', () => {
    it('keeps the path prefix and the query string', () => {
      expect(rewriteApiUrl(new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5'), OVERRIDE).href).toBe(
        `${OVERRIDE}/calendar/v3/users/me/calendarList?maxResults=5`
      );
    });

    it('leaves other hosts alone (token refresh stays on oauth2.googleapis.com)', () => {
      expect(rewriteApiUrl(new URL('https://oauth2.googleapis.com/token'), OVERRIDE).href).toBe('https://oauth2.googleapis.com/token');
    });
  });

  describe('applyApiBaseUrl', () => {
    it('sends googleapis calendar calls to the override, prefix included', async () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      const { client, fetchImplementation } = routedClient();

      const calendar = google.calendar({ version: 'v3', auth: client });
      await calendar.calendarList.list({ maxResults: 5 });

      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      const url = fetchImplementation.mock.calls[0][0];
      expect(String(url)).toBe(`${OVERRIDE}/calendar/v3/users/me/calendarList?maxResults=5`);
    });

    it('leaves the transporter untouched when unset', () => {
      const client = new OAuth2Client();
      const request = client.transporter.request;
      applyApiBaseUrl(client);
      expect(client.transporter.request).toBe(request);
    });

    it('resolves the base once, when the client is set up', async () => {
      process.env[API_BASE_URL_ENV] = OVERRIDE;
      const { client, fetchImplementation } = routedClient();
      process.env[API_BASE_URL_ENV] = 'http://elsewhere.invalid';

      await google.calendar({ version: 'v3', auth: client }).calendarList.list();

      expect(String(fetchImplementation.mock.calls[0][0])).toMatch(new RegExp(`^${OVERRIDE}/`));
    });

    // gaxios picks its proxy agent from HTTPS_PROXY/NO_PROXY while preparing the
    // request, so the URL has to be rewritten before that step for NO_PROXY to
    // be matched against the override host rather than www.googleapis.com.
    describe('with HTTPS_PROXY set', () => {
      const proxyEnv = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;
      const saved = Object.fromEntries(proxyEnv.map((k) => [k, process.env[k]]));

      beforeEach(() => {
        for (const k of proxyEnv) delete process.env[k];
        process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
        process.env[API_BASE_URL_ENV] = OVERRIDE;
      });

      afterEach(() => {
        for (const k of proxyEnv) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      });

      async function agentForCalendarCall(): Promise<unknown> {
        const { client, fetchImplementation } = routedClient();
        await google.calendar({ version: 'v3', auth: client }).calendarList.list();
        expect(String(fetchImplementation.mock.calls[0][0])).toMatch(new RegExp(`^${OVERRIDE}/`));
        return fetchImplementation.mock.calls[0][1].agent;
      }

      it('goes direct when NO_PROXY names the override host', async () => {
        process.env.NO_PROXY = '127.0.0.1';
        expect(await agentForCalendarCall()).toBeUndefined();
      });

      it('uses the proxy when NO_PROXY names only www.googleapis.com', async () => {
        process.env.NO_PROXY = 'www.googleapis.com';
        expect(await agentForCalendarCall()).toBeDefined();
      });
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
