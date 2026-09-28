import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

const state = vi.hoisted(() => ({
  detectServiceAccountKey: vi.fn(async () => null as any),
  initializeServiceAccountClient: vi.fn(() => ({ id: 'jwt-client' }) as any),
  keysFilePath: ''
}));

vi.mock('../../../auth/serviceAccount.js', () => ({
  detectServiceAccountKey: state.detectServiceAccountKey,
  initializeServiceAccountClient: state.initializeServiceAccountClient
}));

vi.mock('../../../auth/utils.js', () => ({
  getKeysFilePath: () => state.keysFilePath,
  generateCredentialsErrorMessage: () => 'credentials missing'
}));

import { initializeOAuth2Client, loadCredentials } from '../../../auth/client.js';

const SERVICE_ACCOUNT = {
  path: '/keys/sa.json',
  email: 'calendar-mcp@test-project.iam.gserviceaccount.com',
  source: 'GOOGLE_SERVICE_ACCOUNT_KEY',
  privateKey: 'private-key'
};

describe('initializeOAuth2Client', () => {
  let tempDir: string;
  let stderr: ReturnType<typeof vi.spyOn>;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.detectServiceAccountKey.mockResolvedValue(null);
    state.initializeServiceAccountClient.mockReturnValue({ id: 'jwt-client' });

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcal-client-'));
    state.keysFilePath = path.join(tempDir, 'gcp-oauth.keys.json');
    await fs.writeFile(
      state.keysFilePath,
      JSON.stringify({
        installed: {
          client_id: 'client-id.apps.googleusercontent.com',
          client_secret: 'client-secret',
          redirect_uris: ['http://localhost:3000/oauth2callback']
        }
      })
    );

    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // The mode banner is suppressed under NODE_ENV=test, so logging assertions
    // need a non-test value.
    process.env.NODE_ENV = 'production';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = savedNodeEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function loggedLines(): string {
    return stderr.mock.calls.map((call: any[]) => String(call[0])).join('');
  }

  async function writeKeys(keys: unknown): Promise<void> {
    await fs.writeFile(state.keysFilePath, JSON.stringify(keys));
  }

  it('uses a service account passed in by the caller without detecting again', async () => {
    const client = await initializeOAuth2Client(SERVICE_ACCOUNT as any);

    expect(client).toEqual({ id: 'jwt-client' });
    expect(state.initializeServiceAccountClient).toHaveBeenCalledWith(SERVICE_ACCOUNT);
    expect(state.detectServiceAccountKey).not.toHaveBeenCalled();
  });

  it('detects a service account when the caller passes nothing', async () => {
    state.detectServiceAccountKey.mockResolvedValue(SERVICE_ACCOUNT);

    const client = await initializeOAuth2Client();

    expect(client).toEqual({ id: 'jwt-client' });
    expect(state.detectServiceAccountKey).toHaveBeenCalledTimes(1);
  });

  it('takes the OAuth path when the caller passes null, without detecting', async () => {
    const client = await initializeOAuth2Client(null);

    expect(state.detectServiceAccountKey).not.toHaveBeenCalled();
    expect(state.initializeServiceAccountClient).not.toHaveBeenCalled();
    expect((client as any)._clientId).toBe('client-id.apps.googleusercontent.com');
  });

  it('loads installed-format credentials and their redirect URI', async () => {
    await writeKeys({
      installed: {
        client_id: 'id',
        client_secret: 'secret',
        redirect_uris: ['http://localhost:4000/cb']
      }
    });

    const client = await initializeOAuth2Client(null);

    expect((client as any)._clientId).toBe('id');
    expect((client as any).redirectUri).toBe('http://localhost:4000/cb');
  });

  it('defaults the redirect URI when installed credentials omit it', async () => {
    await writeKeys({ installed: { client_id: 'id', client_secret: 'secret' } });

    const client = await initializeOAuth2Client(null);

    expect((client as any).redirectUri).toBe('http://localhost:3000/oauth2callback');
  });

  it('rejects installed-format credentials without a client ID or secret', async () => {
    await writeKeys({ installed: { client_id: 'id' } });

    await expect(loadCredentials()).rejects.toThrow(/installed.*missing client_id or client_secret/);
  });

  it('loads web-format credentials and their redirect URI', async () => {
    await writeKeys({
      web: {
        client_id: 'web-id',
        client_secret: 'web-secret',
        redirect_uris: ['https://oauth.example.com/cb']
      }
    });

    const client = await initializeOAuth2Client(null);

    expect((client as any)._clientId).toBe('web-id');
    expect((client as any).redirectUri).toBe('https://oauth.example.com/cb');
    await expect(loadCredentials()).resolves.toEqual({ client_id: 'web-id', client_secret: 'web-secret' });
  });

  it('defaults the redirect URI when web credentials omit it', async () => {
    await writeKeys({ web: { client_id: 'id', client_secret: 'secret' } });

    const client = await initializeOAuth2Client(null);

    expect((client as any).redirectUri).toBe('http://localhost:3000/oauth2callback');
  });

  it('rejects web-format credentials without a client ID or secret', async () => {
    await writeKeys({ web: { client_id: 'id' } });

    await expect(loadCredentials()).rejects.toThrow(/web.*missing client_id or client_secret/);
  });

  it('loads direct-format credentials', async () => {
    await writeKeys({ client_id: 'id', client_secret: 'secret' });

    await expect(loadCredentials()).resolves.toEqual({ client_id: 'id', client_secret: 'secret' });
  });

  it('rejects a credentials file with no recognized format', async () => {
    await writeKeys({ random: 'stuff' });

    await expect(loadCredentials()).rejects.toThrow(/Invalid credentials file format/);
  });

  it('reports the credentials file path when loading fails', async () => {
    await fs.rm(state.keysFilePath);

    await expect(initializeOAuth2Client(null)).rejects.toThrow(state.keysFilePath);
  });

  it('reports the service account and where it came from', async () => {
    await initializeOAuth2Client(SERVICE_ACCOUNT as any);

    expect(loggedLines()).toContain(
      'Authenticating with service account calendar-mcp@test-project.iam.gserviceaccount.com from GOOGLE_SERVICE_ACCOUNT_KEY'
    );
  });

  it('reports the OAuth credentials file it chose', async () => {
    await initializeOAuth2Client(null);

    expect(loggedLines()).toContain(`Authenticating with OAuth client credentials from ${state.keysFilePath}`);
  });

  it('stays quiet under NODE_ENV=test so stdio output is not polluted', async () => {
    process.env.NODE_ENV = 'test';

    await initializeOAuth2Client(SERVICE_ACCOUNT as any);

    expect(loggedLines()).toBe('');
  });

  describe('with GOOGLE_CALENDAR_API_BASE_URL set', () => {
    const savedBaseUrl = process.env.GOOGLE_CALENDAR_API_BASE_URL;

    afterEach(() => {
      if (savedBaseUrl === undefined) delete process.env.GOOGLE_CALENDAR_API_BASE_URL;
      else process.env.GOOGLE_CALENDAR_API_BASE_URL = savedBaseUrl;
    });

    it('names the origin it routes Calendar calls to, once, without the path', async () => {
      process.env.GOOGLE_CALENDAR_API_BASE_URL = 'http://127.0.0.1:10255/tenant-a/calendar';

      await initializeOAuth2Client(null);

      const routed = loggedLines().split('\n').filter((line) => line.includes('routed'));
      expect(routed).toEqual(['Calendar API calls routed to http://127.0.0.1:10255 (GOOGLE_CALENDAR_API_BASE_URL)']);
    });

    it('says nothing about routing when unset', async () => {
      delete process.env.GOOGLE_CALENDAR_API_BASE_URL;

      await initializeOAuth2Client(null);

      expect(loggedLines()).not.toContain('routed');
    });

    it('reports a bad value as itself, not as a credentials problem', async () => {
      process.env.GOOGLE_CALENDAR_API_BASE_URL = 'proxy.internal/calendar';

      // Anchored: an "Error loading OAuth keys: " prefix would fail it.
      await expect(initializeOAuth2Client(null)).rejects.toThrow(/^GOOGLE_CALENDAR_API_BASE_URL must be/);
    });

    it('routes a service account client too', async () => {
      process.env.GOOGLE_CALENDAR_API_BASE_URL = 'http://127.0.0.1:10255/tenant-a/calendar';
      const fetchImplementation = vi.fn().mockResolvedValue(
        new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
      );
      const jwt = new OAuth2Client({ transporterOptions: { fetchImplementation } });
      jwt.setCredentials({ access_token: 'stub', expiry_date: Date.now() + 3_600_000 });
      state.initializeServiceAccountClient.mockReturnValue(jwt);

      const client = await initializeOAuth2Client(SERVICE_ACCOUNT as any);
      await google.calendar({ version: 'v3', auth: client }).calendarList.list();

      expect(String(fetchImplementation.mock.calls[0][0])).toBe(
        'http://127.0.0.1:10255/tenant-a/calendar/calendar/v3/users/me/calendarList'
      );
    });
  });
});
