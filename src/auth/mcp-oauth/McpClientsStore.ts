import crypto from 'crypto';
import { getMcpStoragePath, loadJsonFile, saveJsonFile } from './persistence.js';

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
    const client = this.clients.get(clientId);
    if (client && (client as any).client_secret) {
      // Strip client_secret from legacy registrations — MCP clients (e.g. ChatGPT)
      // don't send secrets in token exchanges, so treat all clients as public.
      delete (client as any).client_secret;
      delete (client as any).client_secret_expires_at;
    }
    return client;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    const clientId = crypto.randomUUID();

    // Don't issue a client_secret — many MCP clients (e.g. ChatGPT) register
    // with token_endpoint_auth_method='client_secret_post' but never actually
    // send the secret in the token exchange. Without a stored secret, the SDK's
    // clientAuth middleware skips secret validation (public client behavior).
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    this.clients.set(clientId, registered);
    try {
      await saveJsonFile(this.persistPath, Object.fromEntries(this.clients));
    } catch (error) {
      process.stderr.write(`McpClientsStore save error: ${error instanceof Error ? error.message : error}\n`);
      // Continue without persistence — clients will work in-memory for this session
    }
    return registered;
  }
}
