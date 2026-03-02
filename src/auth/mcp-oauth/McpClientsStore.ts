import crypto from 'crypto';
import { getMcpStoragePath, loadJsonFile, saveJsonFile, MCP_TOKEN_PREFIX } from './persistence.js';

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export class McpClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();
  private persistPath: string;

  constructor() {
    this.persistPath = getMcpStoragePath('mcp-clients.json');
  }

  async initialize(): Promise<void> {
    const data = await loadJsonFile<Record<string, OAuthClientInformationFull>>(this.persistPath);
    if (data) {
      for (const [key, val] of Object.entries(data)) {
        this.clients.set(key, val);
      }
    }
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    const clientId = crypto.randomUUID();
    const clientSecret = `${MCP_TOKEN_PREFIX.CLIENT_SECRET}${crypto.randomUUID()}`;

    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // Never expires
    };

    this.clients.set(clientId, registered);
    await saveJsonFile(this.persistPath, Object.fromEntries(this.clients));
    return registered;
  }
}
