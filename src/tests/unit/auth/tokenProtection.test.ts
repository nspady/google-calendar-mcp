import { afterEach, describe, expect, it, vi } from 'vitest';
import { platform, tmpdir } from 'os';
import fs from 'fs/promises';
import path from 'path';
import { OAuth2Client } from 'google-auth-library';
import { decodeTokenFile, encodeTokenFile } from '../../../auth/tokenProtection.js';
import { TokenManager } from '../../../auth/tokenManager.js';

afterEach(() => vi.unstubAllEnvs());

describe('token file protection', () => {
  it('retains the legacy format only in compatibility mode', async () => {
    const text = JSON.stringify({ personal: { refresh_token: 'synthetic-refresh' } });
    expect(await encodeTokenFile(text, 'plaintext')).toBe(text);
    expect(await decodeTokenFile(text, 'plaintext')).toBe(text);
  });

  it('rejects plaintext, malformed data, and unknown versions without echoing secrets', async () => {
    for (const text of [
      '{"personal":{"refresh_token":"do-not-log-this"}}',
      'do-not-log-this',
      '{"format":"google-calendar-mcp-dpapi","version":2,"ciphertext":"AAAA"}',
      '{"format":"google-calendar-mcp-dpapi","version":1,"ciphertext":"!invalid!"}'
    ]) {
      await expect(decodeTokenFile(text, 'dpapi')).rejects.toThrow(/Invalid encrypted token/);
      try { await decodeTokenFile(text, 'dpapi'); } catch (error) {
        expect(String(error)).not.toContain('do-not-log-this');
      }
    }
  });

  it('rejects an encrypted envelope in plaintext mode instead of treating it as accounts', async () => {
    await expect(decodeTokenFile(
      '{"format":"google-calendar-mcp-dpapi","version":1,"ciphertext":"AAAA"}', 'plaintext'
    )).rejects.toThrow('Encrypted tokens require');
  });

  it.skipIf(platform() !== 'win32')('round-trips through real DPAPI and rejects damaged ciphertext', async () => {
    const text = JSON.stringify({ personal: { refresh_token: 'synthetic-native-dpapi-test' } });
    const encoded = await encodeTokenFile(text, 'dpapi');
    expect(encoded).not.toContain('synthetic-native-dpapi-test');
    expect(await decodeTokenFile(encoded, 'dpapi')).toBe(text);
    const envelope = JSON.parse(encoded);
    const blob = Buffer.from(envelope.ciphertext, 'base64');
    blob[blob.length - 1] ^= 0xff;
    envelope.ciphertext = blob.toString('base64');
    await expect(decodeTokenFile(JSON.stringify(envelope), 'dpapi')).rejects.toThrow('DPAPI unprotect failed');
  });

  it.skipIf(platform() !== 'win32')('integrates encrypted storage with TokenManager without legacy migration', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'calendar-mcp-protection-'));
    const file = path.join(dir, 'tokens.json');
    vi.stubEnv('GOOGLE_CALENDAR_MCP_TOKEN_PATH', file);
    vi.stubEnv('GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION', 'dpapi');
    try {
      const manager = new TokenManager(new OAuth2Client('synthetic-id', 'synthetic-secret'), 'personal');
      const records = { personal: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' } };
      const internal = manager as unknown as {
        writeTokenFile(tokens: typeof records): Promise<void>;
        loadMultiAccountTokensRaw(): Promise<unknown>;
        migrateLegacyTokens(): Promise<boolean>;
      };
      await internal.writeTokenFile(records);
      const stored = await fs.readFile(file, 'utf8');
      expect(stored).not.toContain('synthetic-refresh');
      expect(stored).not.toContain('synthetic-access');
      expect(await internal.loadMultiAccountTokensRaw()).toEqual(records);
      expect(await internal.migrateLegacyTokens()).toBe(false);
      await fs.writeFile(file, JSON.stringify(records));
      await expect(internal.loadMultiAccountTokensRaw()).rejects.toThrow('plaintext tokens are not accepted');
      expect(await fs.readFile(file, 'utf8')).toBe(JSON.stringify(records));
    } finally {
      await fs.unlink(file).catch(() => {});
      await fs.rmdir(dir);
    }
  });
});
