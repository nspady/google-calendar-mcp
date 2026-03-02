import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loadCredentialsContent: vi.fn(),
  oauth2ConstructorArgs: [] as unknown[][],
}));

vi.mock('../../../auth/utils.js', () => ({
  loadCredentialsContent: state.loadCredentialsContent,
  generateCredentialsErrorMessage: () => 'mock credentials error',
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    constructor(...args: unknown[]) {
      state.oauth2ConstructorArgs.push(args);
    }
  }
}));

import { initializeOAuth2Client, loadCredentials } from '../../../auth/client.js';

describe('auth/client credential parsing', () => {
  const originalRedirectBase = process.env.OAUTH_REDIRECT_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    state.oauth2ConstructorArgs.length = 0;
    delete process.env.OAUTH_REDIRECT_BASE_URL;
  });

  afterEach(() => {
    if (originalRedirectBase === undefined) {
      delete process.env.OAUTH_REDIRECT_BASE_URL;
    } else {
      process.env.OAUTH_REDIRECT_BASE_URL = originalRedirectBase;
    }
  });

  it('normalizes malformed credential keys with trailing whitespace', async () => {
    state.loadCredentialsContent.mockReturnValue(JSON.stringify({
      web: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        'redirect_uris  ': ['https://example.com/oauth2callback'],
      },
    }));

    await initializeOAuth2Client();

    expect(state.oauth2ConstructorArgs).toHaveLength(1);
    expect(state.oauth2ConstructorArgs[0][0]).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/oauth2callback',
    });

    const credentials = await loadCredentials();
    expect(credentials).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });

  it('uses OAUTH_REDIRECT_BASE_URL when redirect_uris are missing', async () => {
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://my-app.up.railway.app';
    state.loadCredentialsContent.mockReturnValue(JSON.stringify({
      web: {
        client_id: 'cloud-client-id',
        client_secret: 'cloud-client-secret',
      },
    }));

    await initializeOAuth2Client();

    expect(state.oauth2ConstructorArgs).toHaveLength(1);
    expect(state.oauth2ConstructorArgs[0][0]).toEqual({
      clientId: 'cloud-client-id',
      clientSecret: 'cloud-client-secret',
      redirectUri: 'https://my-app.up.railway.app/oauth2callback',
    });
  });
});
