import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

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

import { initializeOAuth2Client } from '../../../auth/client.js';

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
    // The mode banner is suppressed under NODE_ENV=test, which is exactly what
    // vitest sets — so the logging assertions below need a non-test value.
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
});
