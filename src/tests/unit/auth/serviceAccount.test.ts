import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  detectServiceAccountKey,
  initializeServiceAccountClient,
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
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeKey(name: string, contents: unknown): Promise<string> {
    const file = path.join(tempDir, name);
    await fs.writeFile(file, JSON.stringify(contents));
    return file;
  }

  describe('detectServiceAccountKey', () => {
    it('detects a service account key given by GOOGLE_SERVICE_ACCOUNT_KEY', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectServiceAccountKey();

      expect(detected).not.toBeNull();
      expect(detected!.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
    });

    it('also honours GOOGLE_APPLICATION_CREDENTIALS', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = await writeKey('adc.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectServiceAccountKey();

      expect(detected?.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
    });

    it('detects a service account key supplied through GOOGLE_OAUTH_CREDENTIALS', async () => {
      // Switching an existing install over should be a one-file change.
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('creds.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectServiceAccountKey();

      expect(detected?.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
    });

    it('returns null for an OAuth client file so the OAuth flow still applies', async () => {
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('oauth.json', OAUTH_CLIENT_KEY);

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('returns null when the file is missing or unreadable', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = path.join(tempDir, 'does-not-exist.json');
      process.env.GOOGLE_OAUTH_CREDENTIALS = path.join(tempDir, 'also-missing.json');

      await expect(detectServiceAccountKey()).resolves.toBeNull();
    });

    it('reports a service account key that is missing required fields', async () => {
      const { private_key, ...withoutKey } = SERVICE_ACCOUNT_KEY;
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('broken.json', withoutKey);

      await expect(detectServiceAccountKey()).rejects.toThrow(/client_email or private_key/);
    });

    it('prefers the explicit key path over the credentials path', async () => {
      const other = { ...SERVICE_ACCOUNT_KEY, client_email: 'explicit@test-project.iam.gserviceaccount.com' };
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = await writeKey('explicit.json', other);
      process.env.GOOGLE_OAUTH_CREDENTIALS = await writeKey('fallback.json', SERVICE_ACCOUNT_KEY);

      const detected = await detectServiceAccountKey();

      expect(detected?.email).toBe('explicit@test-project.iam.gserviceaccount.com');
    });
  });

  describe('initializeServiceAccountClient', () => {
    it('builds a JWT client, which OAuth2Client consumers accept unchanged', async () => {
      const file = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = await initializeServiceAccountClient(file);

      expect(client).toBeInstanceOf(JWT);
      expect(client.email).toBe(SERVICE_ACCOUNT_KEY.client_email);
      expect(client.scopes).toEqual(SERVICE_ACCOUNT_SCOPES);
    });

    it('leaves subject unset so the service account acts as itself', async () => {
      const file = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = await initializeServiceAccountClient(file);

      expect(client.subject).toBeUndefined();
    });

    it('sets subject for domain-wide delegation when configured', async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT = 'user@example.com';
      const file = await writeKey('sa.json', SERVICE_ACCOUNT_KEY);

      const client = await initializeServiceAccountClient(file);

      expect(client.subject).toBe('user@example.com');
    });
  });
});
