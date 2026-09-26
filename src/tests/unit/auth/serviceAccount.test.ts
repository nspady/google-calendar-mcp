import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  detectServiceAccountKey,
  initializeServiceAccountClient,
  ServiceAccountKey,
  SERVICE_ACCOUNT_SCOPES
} from '../../../auth/serviceAccount.js';

// A syntactically valid PEM is required: JWT parses the key eagerly.
const TEST_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEAtestkeymaterialonly',
  '-----END PRIVATE KEY-----'
].join('\n');

const SERVICE_ACCOUNT_KEY = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'abc123',
  private_key: TEST_PRIVATE_KEY,
  client_email: 'calendar-mcp@test-project.iam.gserviceaccount.com',
  client_id: '1234567890'
};

const OAUTH_CLIENT_KEY = {
  installed: {
    client_id: 'client-id.apps.googleusercontent.com',
    client_secret: 'client-secret',
    redirect_uris: ['http://localhost']
  }
};

describe('service account authentication', () => {
  let tempDir: string;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gcal-sa-'));
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT;
    delete process.env.GOOGLE_OAUTH_CREDENTIALS;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeKey(name: string, contents: unknown): Promise<string> {
    const file = path.join(tempDir, name);
    await fs.writeFile(file, JSON.stringify(contents));
    return file;
  }

  async function detectOrFail(): Promise<ServiceAccountKey> {
    const detected = await detectServiceAccountKey();
    expect(detected).not.toBeNull();
    return detected!;
  }

  describe('detectServiceAccountKey', () => {
    it('detects a service account key given by GOOGLE_SERVICE_ACCOUNT_KEY', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
      expect(detected.source).toBe('GOOGLE_SERVICE_ACCOUNT_KEY');
    });

    it('also honours GOOGLE_APPLICATION_CREDENTIALS', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
      expect(detected.source).toBe('GOOGLE_APPLICATION_CREDENTIALS');
    });

    it('detects a service account key supplied through GOOGLE_OAUTH_CREDENTIALS', async () => {
      // Switching an existing install over should be a one-file change.
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('creds.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
      expect(detected.source).toBe('GOOGLE_OAUTH_CREDENTIALS');
    });

    it('returns null for an OAuth client file so the OAuth flow still applies', async () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('oauth.json', OAUTH_CLIENT_KEY);

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('prefers the explicit key path over the credentials path', async () => {
      const other = { ...SERVICE_ACCOUNT_KEY, client_email: 'explicit@test-project.iam.gserviceaccount.com' };
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('explicit.json', other);
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('fallback.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.email).toBe('explicit@test-project.iam.gserviceaccount.com');
    });

    it('lets an explicit OAuth credentials file win over an ambient GOOGLE_APPLICATION_CREDENTIALS', async () => {
      // GOOGLE_APPLICATION_CREDENTIALS is often set for unrelated Google tooling.
      // It must not silently flip this server to service account mode on restart.
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('oauth.json', OAUTH_CLIENT_KEY);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it.each([null, [], {}, { unrelated: true }])(
      'falls back to ambient credentials for non-OAuth JSON %j', async (contents) => {
        process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('not-oauth.json', contents);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

        const detected = await detectOrFail();

        expect(detected.source).toBe('GOOGLE_APPLICATION_CREDENTIALS');
      }
    );

    it('recognizes direct OAuth credentials and keeps them ahead of ambient credentials', async () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('oauth.json', {
        client_id: 'client-id.apps.googleusercontent.com',
        client_secret: 'client-secret'
      });
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('still reads GOOGLE_APPLICATION_CREDENTIALS when no OAuth credentials path is set', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.source).toBe('GOOGLE_APPLICATION_CREDENTIALS');
    });

    it('fails loudly when GOOGLE_SERVICE_ACCOUNT_KEY cannot be read', async () => {
      // A typo here used to fall through to OAuth silently, which is exactly what
      // makes a misconfigured deployment hard to diagnose.
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = path.join(tempDir, 'does-not-exist.json');

      await expect(detectServiceAccountKey()).rejects.toThrow(
        /GOOGLE_SERVICE_ACCOUNT_KEY points at .*does-not-exist\.json/
      );
    });

    it('fails loudly when GOOGLE_SERVICE_ACCOUNT_KEY is not JSON', async () => {
      const file = path.join(tempDir, 'garbage.json');
      await fs.writeFile(file, 'not json at all');
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = file;

      await expect(detectServiceAccountKey()).rejects.toThrow(/could not be read as JSON/);
    });

    it('fails loudly when GOOGLE_SERVICE_ACCOUNT_KEY is not a service account key', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('oauth.json', OAUTH_CLIENT_KEY);

      await expect(detectServiceAccountKey()).rejects.toThrow(/not a service account key/);
    });

    it('does not fail on a broken ambient GOOGLE_APPLICATION_CREDENTIALS', async () => {
      // Ambient and shared: a stale value must not take down a working OAuth install.
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tempDir, 'missing-adc.json');

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('does not fail on an ambient key that declares itself a service account but is malformed', async () => {
      // Declaring `"type": "service_account"` without the fields to back it up is
      // worth a warning, not a dead server: this install may be using OAuth.
      const { private_key, ...withoutKey } = SERVICE_ACCOUNT_KEY;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('broken-adc.json', withoutKey);

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('falls back to GOOGLE_APPLICATION_CREDENTIALS when the OAuth credentials file is unusable', async () => {
      // Precedence is about a *working* OAuth setup. A path that resolves to
      // nothing is not one, so the ambient variable still gets its turn.
      process.env.GOOGLE_OAUTH_CREDENTIALS = path.join(tempDir, 'gone.json');
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectOrFail();

      expect(detected.source).toBe('GOOGLE_APPLICATION_CREDENTIALS');
    });

    it('returns null when no candidate file exists', async () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = path.join(tempDir, 'also-missing.json');

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('reports a service account key that is missing required fields', async () => {
      const { private_key, ...withoutKey } = SERVICE_ACCOUNT_KEY;
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('broken.json', withoutKey);

      await expect(detectServiceAccountKey()).rejects.toThrow(/client_email or private_key/);
    });
  });

  describe('initializeServiceAccountClient', () => {
    it('builds a JWT client, which OAuth2Client consumers accept unchanged', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = initializeServiceAccountClient(await detectOrFail());

      expect(client).toBeInstanceOf(JWT);
      expect(client.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
      expect(client.scopes).toEqual(SERVICE_ACCOUNT_SCOPES);
    });

    it('leaves subject unset so the service account acts as itself', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = initializeServiceAccountClient(await detectOrFail());

      expect(client.subject).toBeUndefined();
    });

    it('sets subject for domain-wide delegation when configured', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT = 'user@example.com';
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = initializeServiceAccountClient(await detectOrFail());

      expect(client.subject).toBe('user@example.com');
    });

    it('needs no second read of the key file', async () => {
      // Detection carries the key material, so startup opens the file exactly once.
      // Deleting it between the two steps proves there is no second read.
      const file = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = file;

      const detected = await detectOrFail();
      await fs.rm(file);

      const client = initializeServiceAccountClient(detected);

      expect(client.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
    });
  });
});
