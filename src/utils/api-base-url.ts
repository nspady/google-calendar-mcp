import type { OAuth2Client } from 'google-auth-library';

/**
 * Environment variable that sends every Google Calendar API call to a base URL
 * of your own instead of https://www.googleapis.com.
 *
 * Meant for deployments with an egress proxy in front of Google: the server
 * dials the proxy over plain HTTP and the proxy originates TLS. The value is an
 * absolute http(s) URL and may carry a path prefix, which is kept as-is, so
 * `http://proxy:10255/tenant-a/calendar` receives
 * `/tenant-a/calendar/calendar/v3/...`. Token refresh (oauth2.googleapis.com)
 * and the OAuth login flow are not affected.
 *
 * Implemented as a request interceptor on the OAuth2Client's transporter rather
 * than googleapis' `rootUrl` option: `rootUrl` resolves the API path against the
 * override's origin only and drops any path prefix.
 */
export const API_BASE_URL_ENV = 'GOOGLE_CALENDAR_API_BASE_URL';

export const DEFAULT_API_ORIGIN = 'https://www.googleapis.com';

/**
 * The base URL every Calendar API call goes to: the override without a
 * trailing slash, or the public Google origin when unset or blank.
 * @throws Error if the override is set but is not an absolute http(s) URL
 */
export function getApiBaseUrl(): string {
  const raw = process.env[API_BASE_URL_ENV]?.trim();
  if (!raw) return DEFAULT_API_ORIGIN;
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error(`${API_BASE_URL_ENV} must be an absolute http(s) URL, got: ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Rewrites a URL on the public Google API origin onto the configured base URL,
 * path and query preserved. Any other URL comes back unchanged.
 */
export function rewriteApiUrl(url: string | URL): URL {
  const original = new URL(url);
  const base = getApiBaseUrl();
  if (base === DEFAULT_API_ORIGIN || original.origin !== DEFAULT_API_ORIGIN) {
    return original;
  }
  return new URL(`${base}${original.pathname}${original.search}`);
}

/**
 * Makes every request the client sends honour GOOGLE_CALENDAR_API_BASE_URL.
 * A no-op when the variable is unset. Returns the client for chaining.
 */
export function applyApiBaseUrl<T extends OAuth2Client>(client: T): T {
  if (getApiBaseUrl() === DEFAULT_API_ORIGIN) return client;
  client.transporter.interceptors.request.add({
    resolved: async (config) => {
      config.url = rewriteApiUrl(config.url);
      return config;
    },
  });
  return client;
}
