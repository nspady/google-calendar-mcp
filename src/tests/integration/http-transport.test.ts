import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * HTTP transport handshake integration test.
 *
 * Proves the per-session StreamableHTTP fix: two clients each complete the full
 * MCP handshake (initialize -> notifications/initialized -> tools/list) against a
 * single running server, and a follow-up request on an established client
 * succeeds (the original bug 500'd on request #2 because a single stateless
 * transport was reused across requests).
 *
 * Self-contained: spawns the built server with NODE_ENV=test and a dummy
 * GOOGLE_OAUTH_CREDENTIALS file. Tool registration is token-independent, so no
 * real Google account, tokens, or network access are required.
 */

const HOST = '127.0.0.1';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function startHttpServer(port: number, credentialsPath: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['build/index.js', '--transport', 'http', '--host', HOST, '--port', String(port)],
      {
        env: { ...process.env, NODE_ENV: 'test', GOOGLE_OAUTH_CREDENTIALS: credentialsPath },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let settled = false;
    const onOutput = (buf: Buffer) => {
      if (!settled && buf.toString().includes('listening on http')) {
        settled = true;
        resolve(child);
      }
    };
    child.stderr.on('data', onOutput);
    child.stdout.on('data', onOutput);
    child.on('exit', (code) => {
      if (!settled) {
        reject(new Error(`Server exited before it was ready (code ${code})`));
      }
    });

    // Failsafe watchdog, not a fixed wait: readiness resolves on the real
    // "listening" banner above. Fake timers cannot drive a spawned subprocess,
    // so a real wall-clock guard is required to avoid hanging forever on a
    // server that never binds.

    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        reject(new Error('Server did not become ready within 15s'));
      }
    }, 15000);
  });
}

async function connectClient(name: string, url: string): Promise<Client> {
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport); // performs initialize + notifications/initialized
  return client;
}

describe('HTTP transport - per-session handshake', () => {
  let server: ChildProcess;
  let port: number;
  let tempDir: string;
  let mcpUrl: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gcal-mcp-http-'));
    const credentialsPath = join(tempDir, 'credentials.json');
    writeFileSync(
      credentialsPath,
      JSON.stringify({ client_id: 'test-client-id', client_secret: 'test-client-secret' })
    );

    port = await getFreePort();
    mcpUrl = `http://${HOST}:${port}/mcp`;
    server = await startHttpServer(port, credentialsPath);
  }, 30000);

  afterAll(() => {
    if (server && !server.killed) {
      server.kill('SIGKILL');
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('completes the handshake and lists calendar tools (R1)', async () => {
    const client = await connectClient('http-client-1', mcpUrl);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('list-events');
      expect(names).toContain('create-event');

      // Follow-up request on an established session must not 500 (the original bug).
      const second = await client.listTools();
      expect(second.tools.length).toBe(tools.length);
    } finally {
      await client.close();
    }
  }, 30000);

  it('supports two sequential clients, each isolated (R2)', async () => {
    const clientA = await connectClient('http-client-a', mcpUrl);
    let namesA: string[];
    try {
      namesA = (await clientA.listTools()).tools.map((t) => t.name);
      expect(namesA).toContain('list-events');
    } finally {
      await clientA.close();
    }

    // A second client connecting after the first proves per-session isolation
    // rather than one-shot success against a shared transport.
    const clientB = await connectClient('http-client-b', mcpUrl);
    try {
      const namesB = (await clientB.listTools()).tools.map((t) => t.name);
      expect(namesB).toContain('list-events');
      expect(namesB).toContain('create-event');
      expect(namesB.sort()).toEqual(namesA.sort());
    } finally {
      await clientB.close();
    }
  }, 30000);
});
