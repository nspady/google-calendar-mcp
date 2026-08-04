import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOAuthRedirectUri } from '../../../auth/redirectUri.js';

describe('buildOAuthRedirectUri', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the runtime port for a local HTTP callback', () => {
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_HOST', '');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_SCHEME', '');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_PORT', '');

    expect(buildOAuthRedirectUri({
      defaultHost: 'localhost',
      runtimePort: 3500
    })).toBe('http://localhost:3500/oauth2callback');
  });

  it('omits the default port for an external HTTPS callback', () => {
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_HOST', 'calendar.example.com');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_SCHEME', 'https');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_PORT', '');

    expect(buildOAuthRedirectUri({
      defaultHost: 'localhost',
      runtimePort: 3500
    })).toBe('https://calendar.example.com/oauth2callback');
  });

  it('uses an explicitly configured external port and preserves the query', () => {
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_HOST', 'calendar.example.com');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_SCHEME', 'https');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_PORT', '8443');

    expect(buildOAuthRedirectUri({
      defaultHost: 'localhost',
      runtimePort: 3500,
      query: '?account=work'
    })).toBe('https://calendar.example.com:8443/oauth2callback?account=work');
  });
});
