import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';

vi.mock('fs/promises');
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { loadCredentials, initializeOAuth2Client } from '../../../auth/client.js';
import { getCredentialsProjectId } from '../../../auth/utils.js';

const FAKE_PATH = '/fake/path/gcp-oauth.keys.json';

describe('loadCredentialsFromFile (via loadCredentials)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_CREDENTIALS = FAKE_PATH;
  });

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CREDENTIALS;
  });

  it('parses the "installed" (Desktop app) format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
      installed: {
        client_id: 'desktop-client-id',
        client_secret: 'desktop-secret',
        redirect_uris: ['http://localhost:3000/oauth2callback'],
      },
    }));
    const creds = await loadCredentials();
    expect(creds).toEqual({ client_id: 'desktop-client-id', client_secret: 'desktop-secret' });
  });

  it('parses the "web" (Web application) format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
      web: {
        client_id: 'web-client-id',
        client_secret: 'web-secret',
        redirect_uris: ['https://example.com/oauth2callback'],
      },
    }));
    const creds = await loadCredentials();
    expect(creds).toEqual({ client_id: 'web-client-id', client_secret: 'web-secret' });
  });

  it('parses the direct (root-level) format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
      client_id: 'direct-client-id',
      client_secret: 'direct-secret',
      redirect_uris: ['http://localhost:3000/oauth2callback'],
    }));
    const creds = await loadCredentials();
    expect(creds).toEqual({ client_id: 'direct-client-id', client_secret: 'direct-secret' });
  });

  it('throws on a file with no recognized format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({ random: 'stuff' }));
    await expect(loadCredentials()).rejects.toThrow(/Invalid credentials file format/);
  });
});

describe('initializeOAuth2Client redirect_uri extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_CREDENTIALS = FAKE_PATH;
  });

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CREDENTIALS;
  });

  it('uses the redirect URI from the "installed" format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
      installed: {
        client_id: 'cid',
        client_secret: 'cs',
        redirect_uris: ['http://localhost:3000/installed-cb'],
      },
    }));
    const client = await initializeOAuth2Client();
    // google-auth-library stores it on the underlying redirectUri / _redirectUri
    const ru = (client as any).redirectUri ?? (client as any)._redirectUri;
    expect(ru).toBe('http://localhost:3000/installed-cb');
  });

  it('uses the redirect URI from the "web" format', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify({
      web: {
        client_id: 'cid',
        client_secret: 'cs',
        redirect_uris: ['https://oauth.example.com/web-cb'],
      },
    }));
    const client = await initializeOAuth2Client();
    const ru = (client as any).redirectUri ?? (client as any)._redirectUri;
    expect(ru).toBe('https://oauth.example.com/web-cb');
  });
});

describe('getCredentialsProjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_CREDENTIALS = FAKE_PATH;
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CREDENTIALS;
  });

  it('reads project_id from the "installed" format', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      installed: { project_id: 'desktop-project' },
    }));
    expect(getCredentialsProjectId()).toBe('desktop-project');
  });

  it('reads project_id from the "web" format', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      web: { project_id: 'web-project' },
    }));
    expect(getCredentialsProjectId()).toBe('web-project');
  });

  it('reads project_id from the direct (root-level) format', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      project_id: 'direct-project',
    }));
    expect(getCredentialsProjectId()).toBe('direct-project');
  });

  it('returns undefined when no project_id is present', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      web: { client_id: 'cid' },
    }));
    expect(getCredentialsProjectId()).toBeUndefined();
  });

  it('returns undefined when the credentials file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getCredentialsProjectId()).toBeUndefined();
  });
});
