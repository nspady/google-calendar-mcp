/**
 * GOOGLE_CALENDAR_API_BASE_URL sends every Google Calendar API call to a base URL
 * of your own instead of https://www.googleapis.com.
 *
 * Meant for deployments with an egress proxy in front of Google: the server
 * dials the proxy over plain HTTP and the proxy originates TLS. The value is an
 * absolute http(s) URL and may carry a path prefix, which is kept as-is, so
 * `http://proxy:10255/tenant-a/calendar` receives
 * `/tenant-a/calendar/calendar/v3/...`. Token refresh (oauth2.googleapis.com)
 * and the OAuth login flow are not affected.
 *
 * Implemented by wrapping the OAuth2Client transporter's `request` rather than
 * googleapis' `rootUrl` option: `rootUrl` resolves the API path against the
 * override's origin only and drops any path prefix.
 */
import type { OAuth2Client } from 'google-auth-library';
import { DEFAULT_API_ORIGIN, getApiBaseUrl } from '../config/AppConfig.js';

// Taken from the client rather than imported from gaxios, which would resolve to
// gaxios' ESM typings while google-auth-library is typed against its CJS build.
type RequestOptions = NonNullable<Parameters<OAuth2Client['transporter']['request']>[0]>;

/**
 * Rewrites a URL on the public Google API origin onto `base`, path and query
 * preserved. Any other URL comes back unchanged.
 */
export function rewriteApiUrl(url: URL, base: string): URL {
  if (url.origin !== DEFAULT_API_ORIGIN) return url;
  return new URL(`${base}${url.pathname}${url.search}`);
}

/**
 * Makes every request the client sends honour GOOGLE_CALENDAR_API_BASE_URL,
 * resolved once, here. A no-op when the variable is unset. Returns the client
 * for chaining.
 *
 * The URL is rewritten before gaxios prepares the request, not in a request
 * interceptor: gaxios picks its proxy agent from HTTPS_PROXY/NO_PROXY while
 * preparing, so an interceptor would leave NO_PROXY matched against
 * www.googleapis.com instead of the override host.
 */
export function applyApiBaseUrl<T extends OAuth2Client>(client: T): T {
  const base = getApiBaseUrl();
  if (base === DEFAULT_API_ORIGIN) return client;
  const transporter = client.transporter;
  const request = transporter.request.bind(transporter);
  transporter.request = ((opts: RequestOptions = {}) =>
    request(opts.url ? { ...opts, url: rewriteApiUrl(new URL(opts.url, opts.baseURL), base) } : opts)
  ) as typeof transporter.request;
  return client;
}
