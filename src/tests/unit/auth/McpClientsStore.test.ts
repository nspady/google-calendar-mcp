import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  }
}));

vi.mock('../../../auth/utils.js', () => ({
  getSecureTokenPath: vi.fn(() => '/tmp/test/tokens.json'),
}));

import { McpClientsStore } from '../../../auth/mcp-oauth/McpClientsStore.js';
import { MCP_TOKEN_PREFIX } from '../../../auth/mcp-oauth/persistence.js';

describe('McpClientsStore', () => {
  let store: McpClientsStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new McpClientsStore();
    await store.initialize();
  });

  it('returns undefined for unknown client', async () => {
    const result = await store.getClient('nonexistent');
    expect(result).toBeUndefined();
  });

  it('registers a client and retrieves it', async () => {
    const metadata = {
      redirect_uris: [new URL('https://example.com/callback')],
      client_name: 'Test Client',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    };

    const registered = await store.registerClient(metadata);

    expect(registered.client_id).toBeDefined();
    expect(registered.client_secret).toMatch(new RegExp(`^${MCP_TOKEN_PREFIX.CLIENT_SECRET}`));
    expect(registered.client_id_issued_at).toBeGreaterThan(0);
    expect(registered.client_secret_expires_at).toBe(0);
    expect(registered.client_name).toBe('Test Client');

    const retrieved = await store.getClient(registered.client_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.client_id).toBe(registered.client_id);
    expect(retrieved!.client_name).toBe('Test Client');
  });

  it('registers multiple clients with unique IDs', async () => {
    const client1 = await store.registerClient({
      redirect_uris: [new URL('https://a.example.com/cb')],
    });
    const client2 = await store.registerClient({
      redirect_uris: [new URL('https://b.example.com/cb')],
    });

    expect(client1.client_id).not.toBe(client2.client_id);
    expect(client1.client_secret).not.toBe(client2.client_secret);
  });

  it('persists to disk after registration', async () => {
    const fs = await import('fs/promises');

    await store.registerClient({
      redirect_uris: [new URL('https://example.com/cb')],
    });

    expect(fs.default.writeFile).toHaveBeenCalled();
  });
});
