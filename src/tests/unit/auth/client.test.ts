import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { initializeOAuth2Client, loadCredentials } from '../../../auth/client.js';

vi.mock('fs/promises');
vi.mock('../../../auth/utils.js', () => ({
  getKeysFilePath: () => '/path/to/gcp-oauth.keys.json',
  generateCredentialsErrorMessage: () => 'OAuth credentials not found.'
}));

const mockKeysFile = (keys: unknown) => vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(keys) as any);

describe('auth/client credentials loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads installed-format credentials', async () => {
    mockKeysFile({ installed: { client_id: 'id', client_secret: 'secret', redirect_uris: ['http://localhost:4000/cb'] } });
    const client = await initializeOAuth2Client();
    expect((client as any)._clientId).toBe('id');
    expect((client as any).redirectUri).toBe('http://localhost:4000/cb');
  });

  it('defaults redirect_uris for installed-format credentials that omit them', async () => {
    mockKeysFile({ installed: { client_id: 'id', client_secret: 'secret' } });
    const client = await initializeOAuth2Client();
    expect((client as any).redirectUri).toBe('http://localhost:3000/oauth2callback');
  });

  it('rejects installed-format credentials without client_id or client_secret', async () => {
    mockKeysFile({ installed: { client_id: 'id' } });
    await expect(loadCredentials()).rejects.toThrow(/missing client_id or client_secret/);
  });

  it('loads direct-format credentials', async () => {
    mockKeysFile({ client_id: 'id', client_secret: 'secret' });
    await expect(loadCredentials()).resolves.toEqual({ client_id: 'id', client_secret: 'secret' });
  });

  it('names the resolved credentials path when loading fails', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));
    await expect(initializeOAuth2Client()).rejects.toThrow(/Credentials file: \/path\/to\/gcp-oauth\.keys\.json/);
  });
});
