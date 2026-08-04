export interface OAuthRedirectUriOptions {
  defaultHost: string;
  runtimePort: number;
  query?: string;
}

/**
 * Builds the OAuth callback URI used by Google.
 *
 * HTTPS callbacks omit the port by default, while local HTTP callbacks retain
 * the runtime listener port. GOOGLE_OAUTH_REDIRECT_PORT can override either
 * behavior when a reverse proxy exposes a non-standard external port.
 */
export function buildOAuthRedirectUri({
  defaultHost,
  runtimePort,
  query = ''
}: OAuthRedirectUriOptions): string {
  const redirectHost = process.env.GOOGLE_OAUTH_REDIRECT_HOST || defaultHost;
  const redirectScheme =
    String(process.env.GOOGLE_OAUTH_REDIRECT_SCHEME || 'http').toLowerCase() === 'https'
      ? 'https'
      : 'http';
  const configuredRedirectPort = String(process.env.GOOGLE_OAUTH_REDIRECT_PORT || '').trim();
  const effectivePort = configuredRedirectPort || String(runtimePort);
  const includePort = configuredRedirectPort.length > 0 || redirectScheme !== 'https';
  const portSegment = includePort ? `:${effectivePort}` : '';

  return `${redirectScheme}://${redirectHost}${portSegment}/oauth2callback${query}`;
}
