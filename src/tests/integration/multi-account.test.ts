import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';

const MULTI_ACCOUNT_IDS = (process.env.MULTI_ACCOUNT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

const MULTI_ACCOUNT_TESTS_ENABLED = process.env.MULTI_ACCOUNT_TESTS === 'true' && MULTI_ACCOUNT_IDS.length >= 2;

if (!MULTI_ACCOUNT_TESTS_ENABLED) {
  console.warn(
    `[multi-account.test] Skipping multi-account integration tests. ` +
    `Set MULTI_ACCOUNT_TESTS=true and MULTI_ACCOUNT_IDS=work,personal (or similar) ` +
    `after authenticating each account to run these tests.`
  );
}

const describeIfEnabled = MULTI_ACCOUNT_TESTS_ENABLED ? describe : describe.skip;

describeIfEnabled('Multi-account integration (stdio transport)', () => {
  let client: Client;
  let serverProcess: ChildProcess;
  const createdEvents: Array<{ accountId: string; calendarId: string; eventId: string }> = [];

  beforeAll(async () => {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>;
    cleanEnv.NODE_ENV = 'test';

    serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    client = new Client({
      name: "multi-account-integration",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env: cleanEnv
    });

    await client.connect(transport);
  }, 40000);

  afterAll(async () => {
    for (const event of createdEvents.reverse()) {
      try {
        await client.callTool({
          name: 'delete-event',
          arguments: {
            calendarId: event.calendarId,
            eventId: event.eventId,
            account: event.accountId
          }
        });
      } catch {
        // Best-effort cleanup
      }
    }

    if (client) {
      await client.close();
    }

    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }, 40000);

  it('merges list-events results and detects cross-account conflicts', async () => {
    const [accountA, accountB] = MULTI_ACCOUNT_IDS;
    const now = Date.now();
    const startA = new Date(now + 30 * 60 * 1000); // 30 minutes from now
    const endA = new Date(startA.getTime() + 45 * 60 * 1000);
    const startB = new Date(startA.getTime() + 10 * 60 * 1000);
    const endB = new Date(startB.getTime() + 45 * 60 * 1000);

    const timeMin = new Date(startA.getTime() - 15 * 60 * 1000).toISOString();
    const timeMax = new Date(endB.getTime() + 15 * 60 * 1000).toISOString();

    const eventA = await createEventForAccount(accountA, {
      summary: `Multi-account Test (${accountA}) ${now}`,
      start: startA.toISOString(),
      end: endA.toISOString()
    });
    const eventB = await createEventForAccount(accountB, {
      summary: `Multi-account Test (${accountB}) ${now}`,
      start: startB.toISOString(),
      end: endB.toISOString()
    });

    const listResult = await client.callTool({
      name: 'list-events',
      arguments: {
        account: MULTI_ACCOUNT_IDS,
        calendarId: 'primary',
        timeMin,
        timeMax
      }
    });

    const listResponse = parseToolResponse(listResult);
    expect(listResponse.accounts).toEqual(MULTI_ACCOUNT_IDS);
    const eventIds = (listResponse.events || []).map((event: any) => event.id);
    expect(eventIds).toContain(eventA);
    expect(eventIds).toContain(eventB);

    const eventFromA = listResponse.events.find((event: any) => event.id === eventA);
    const eventFromB = listResponse.events.find((event: any) => event.id === eventB);
    expect(eventFromA?.accountId).toBe(accountA);
    expect(eventFromB?.accountId).toBe(accountB);
  });

  async function createEventForAccount(
    accountId: string,
    options: { summary: string; start: string; end: string }
  ): Promise<string> {
    const result = await client.callTool({
      name: 'create-event',
      arguments: {
        calendarId: 'primary',
        account: accountId,
        summary: options.summary,
        start: options.start,
        end: options.end,
        allowDuplicates: true
      }
    });

    const eventId = extractEventId(result);
    expect(eventId, `create-event should return an ID for account ${accountId}`).toBeTruthy();
    if (!eventId) {
      throw new Error('Failed to create event');
    }

    createdEvents.push({ accountId, calendarId: 'primary', eventId });
    return eventId;
  }

  function parseToolResponse(result: any): any {
    const text = (result.content as any)[0]?.text;
    if (!text) {
      throw new Error('Tool response did not contain text output');
    }
    return JSON.parse(text);
  }

  function extractEventId(result: any): string | null {
    try {
      const response = parseToolResponse(result);
      return response.event?.id || null;
    } catch {
      return null;
    }
  }
});
