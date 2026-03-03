import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({
  mcpServerConfig: undefined as any,
  mcpServerInstance: undefined as any,
  oauthClient: { id: 'oauth-client' } as any,
  tokenManagerInstance: undefined as any,
  authServerInstance: undefined as any,
  initializeOAuth2Client: vi.fn(async () => ({ id: 'oauth-client' })),
  tokenManagerLoadAllAccounts: vi.fn(async () => new Map()),
  tokenManagerGetAccountMode: vi.fn(() => 'normal'),
  tokenManagerValidateTokens: vi.fn(async () => false),
  tokenManagerClearTokens: vi.fn(async () => undefined),
  authServerStart: vi.fn(async () => true),
  authServerStop: vi.fn(async () => undefined),
  toolRegistryRegisterAll: vi.fn(),
  manageAccountsRunTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
  registerTool: vi.fn(),
  registerPrompt: vi.fn(),
  registerResource: vi.fn(),
  stdioConnect: vi.fn(async () => undefined),
  httpConnect: vi.fn(async () => undefined),
  processOn: vi.fn(process.on.bind(process)),
  calendarRegistryGetUnifiedCalendars: vi.fn(async () => [] as Array<Record<string, unknown>>),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class MockMcpServer {
    connect = vi.fn(async () => undefined);
    tool = vi.fn();
    registerTool = state.registerTool;
    registerPrompt = state.registerPrompt;
    registerResource = state.registerResource;
    close = vi.fn();
    constructor(config: any) {
      state.mcpServerConfig = config;
      state.mcpServerInstance = this;
    }
  }
}));

vi.mock('../../../auth/client.js', () => ({
  initializeOAuth2Client: state.initializeOAuth2Client
}));

vi.mock('../../../auth/tokenManager.js', () => ({
  TokenManager: class MockTokenManager {
    constructor(_oauthClient: any) {
      state.tokenManagerInstance = this;
    }
    loadAllAccounts = state.tokenManagerLoadAllAccounts;
    getAccountMode = state.tokenManagerGetAccountMode;
    validateTokens = state.tokenManagerValidateTokens;
    clearTokens = state.tokenManagerClearTokens;
  }
}));

vi.mock('../../../auth/server.js', () => ({
  AuthServer: class MockAuthServer {
    authCompletedSuccessfully = false;
    constructor(_oauthClient: any) {
      state.authServerInstance = this;
    }
    start = state.authServerStart;
    stop = state.authServerStop;
  }
}));

vi.mock('../../../tools/registry.js', () => ({
  ToolRegistry: {
    registerAll: state.toolRegistryRegisterAll
  }
}));

vi.mock('../../../handlers/core/ManageAccountsHandler.js', () => ({
  ManageAccountsHandler: class MockManageAccountsHandler {
    runTool = state.manageAccountsRunTool;
  }
}));

vi.mock('../../../services/CalendarRegistry.js', () => ({
  CalendarRegistry: {
    getInstance: () => ({
      getUnifiedCalendars: state.calendarRegistryGetUnifiedCalendars
    })
  }
}));

vi.mock('../../../transports/stdio.js', () => ({
  StdioTransportHandler: class MockStdioTransportHandler {
    constructor(_server: any) {}
    connect = state.stdioConnect;
  }
}));

vi.mock('../../../transports/http.js', () => ({
  HttpTransportHandler: class MockHttpTransportHandler {
    constructor(...args: any[]) {
      (state.httpConnect as any).mockHttpArgs = args;
    }
    connect = state.httpConnect;
  }
}));

import { GoogleCalendarMcpServer } from '../../../server.js';

describe('GoogleCalendarMcpServer', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    state.tokenManagerLoadAllAccounts.mockResolvedValue(new Map());
    state.tokenManagerValidateTokens.mockResolvedValue(false);
    state.tokenManagerGetAccountMode.mockReturnValue('normal');
    state.authServerStart.mockResolvedValue(true);
    state.authServerStop.mockResolvedValue(undefined);
    state.stdioConnect.mockResolvedValue(undefined);
    state.httpConnect.mockResolvedValue(undefined);
    state.calendarRegistryGetUnifiedCalendars.mockResolvedValue([]);
    process.env.NODE_ENV = 'test';
    vi.spyOn(process, 'on').mockImplementation(state.processOn as any);
  });

  it('initializes dependencies, registers tools, and installs shutdown handlers', async () => {
    const server = new GoogleCalendarMcpServer({
      transport: { type: 'stdio' },
      debug: false
    } as any);

    await server.initialize();

    expect(state.initializeOAuth2Client).toHaveBeenCalledTimes(1);
    expect(state.tokenManagerLoadAllAccounts).toHaveBeenCalledTimes(1);
    expect(state.toolRegistryRegisterAll).toHaveBeenCalledTimes(1);
    expect(state.mcpServerInstance.tool).not.toHaveBeenCalled();
    expect(state.registerTool).toHaveBeenCalledTimes(1);
    expect(state.registerPrompt).toHaveBeenCalledTimes(2);
    expect(state.registerResource).toHaveBeenCalledTimes(1);
    expect(state.registerTool).toHaveBeenCalledWith(
      'manage-accounts',
      expect.objectContaining({
        title: 'Manage Google Accounts',
        description: expect.any(String),
        inputSchema: expect.any(Object),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false
        }
      }),
      expect.any(Function)
    );
    expect(state.registerPrompt).toHaveBeenCalledWith(
      'daily-agenda-brief',
      expect.objectContaining({
        title: 'Daily Agenda Brief'
      }),
      expect.any(Function)
    );
    expect(state.registerPrompt).toHaveBeenCalledWith(
      'find-and-book-meeting',
      expect.objectContaining({
        title: 'Find and Book Meeting'
      }),
      expect.any(Function)
    );
    expect(state.registerResource).toHaveBeenCalledWith(
      'calendar-accounts',
      'calendar://accounts',
      expect.objectContaining({
        title: 'Connected Accounts and Calendars',
        mimeType: 'application/json'
      }),
      expect.any(Function)
    );
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(server.getServer()).toBe(state.mcpServerInstance);
  });

  it('skips startup auth validation in test environment', async () => {
    const server = new GoogleCalendarMcpServer({
      transport: { type: 'stdio' },
      debug: false
    } as any);

    await server.initialize();

    expect(state.tokenManagerValidateTokens).not.toHaveBeenCalled();
  });

  it('starts stdio transport when configured', async () => {
    const server = new GoogleCalendarMcpServer({
      transport: { type: 'stdio' },
      debug: false
    } as any);

    await server.initialize();
    await server.start();

    expect(state.stdioConnect).toHaveBeenCalledTimes(1);
    expect(state.httpConnect).not.toHaveBeenCalled();
  });

  it('starts http transport with host/port config when configured', async () => {
    const server = new GoogleCalendarMcpServer({
      transport: { type: 'http', host: '0.0.0.0', port: 3456 },
      debug: false
    } as any);

    await server.initialize();
    await server.start();

    expect(state.httpConnect).toHaveBeenCalledTimes(1);
    const args = (state.httpConnect as any).mockHttpArgs;
    expect(args[1]).toEqual({ host: '0.0.0.0', port: 3456 });
    expect(args[2]).toBe(state.tokenManagerInstance);
  });

  it('throws for unsupported transport types', async () => {
    const server = new GoogleCalendarMcpServer({
      transport: { type: 'invalid' },
      debug: false
    } as any);

    await server.initialize();
    await expect(server.start()).rejects.toThrow('Unsupported transport type');
  });

  it('short-circuits startup auth checks when tokens are already loaded in non-test mode', async () => {
    process.env.NODE_ENV = 'production';
    state.tokenManagerLoadAllAccounts
      .mockResolvedValueOnce(new Map([['work', {} as any]]))
      .mockResolvedValueOnce(new Map([['work', {} as any]]));

    const server = new GoogleCalendarMcpServer({
      transport: { type: 'stdio' },
      debug: false
    } as any);

    await server.initialize();

    expect(state.tokenManagerValidateTokens).not.toHaveBeenCalled();
  });

  describe('prompt callbacks', () => {
    async function initAndGetPromptCallback(promptName: string) {
      const server = new GoogleCalendarMcpServer({
        transport: { type: 'stdio' },
        debug: false
      } as any);
      await server.initialize();
      const call = state.registerPrompt.mock.calls.find(
        (c: any[]) => c[0] === promptName
      )!;
      return call[2];
    }

    it('daily-agenda-brief returns correct message with defaults', async () => {
      const callback = await initAndGetPromptCallback('daily-agenda-brief');
      const result = await callback({});
      const text = result.messages[0].content.text;

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(text).toContain('today');
      expect(text).toContain('all connected accounts');
    });

    it('daily-agenda-brief interpolates date, account string, and timezone', async () => {
      const callback = await initAndGetPromptCallback('daily-agenda-brief');
      const result = await callback({
        date: '2026-03-15',
        account: 'work',
        timeZone: 'America/New_York'
      });
      const text = result.messages[0].content.text;

      expect(text).toContain('2026-03-15');
      expect(text).toContain('America/New_York');
      expect(text).toContain('work');
    });

    it('daily-agenda-brief joins array accounts', async () => {
      const callback = await initAndGetPromptCallback('daily-agenda-brief');
      const result = await callback({
        account: ['work', 'personal']
      });
      const text = result.messages[0].content.text;

      expect(text).toContain('work, personal');
    });

    it('find-and-book-meeting returns correct message with full args', async () => {
      const callback = await initAndGetPromptCallback('find-and-book-meeting');
      const result = await callback({
        title: 'Sprint Review',
        durationMinutes: 60,
        windowStart: '2026-03-10T09:00:00',
        windowEnd: '2026-03-10T17:00:00',
        attendeeEmails: ['alice@example.com', 'bob@example.com'],
        account: 'work',
        targetCalendarId: 'team-cal',
        timeZone: 'Europe/London'
      });
      const text = result.messages[0].content.text;

      expect(text).toContain('Sprint Review');
      expect(text).toContain('60 minutes');
      expect(text).toContain('alice@example.com, bob@example.com');
      expect(text).toContain('team-cal');
      expect(text).toContain('Europe/London');
      expect(text).toContain('Do not create an event before confirmation');
    });

    it('find-and-book-meeting uses defaults for optional args', async () => {
      const callback = await initAndGetPromptCallback('find-and-book-meeting');
      const result = await callback({
        title: 'Sync',
        durationMinutes: 30,
        windowStart: '2026-03-10T09:00:00',
        windowEnd: '2026-03-10T17:00:00'
      });
      const text = result.messages[0].content.text;

      expect(text).toContain('primary');
      expect(text).toContain('none specified');
    });
  });

  describe('resource callbacks', () => {
    async function initAndGetResourceCallback() {
      // Ensure ensureAuthenticated succeeds by providing accounts
      state.tokenManagerLoadAllAccounts.mockResolvedValue(
        new Map([['work', {} as any]])
      );

      const server = new GoogleCalendarMcpServer({
        transport: { type: 'stdio' },
        debug: false
      } as any);
      await server.initialize();

      const call = state.registerResource.mock.calls.find(
        (c: any[]) => c[0] === 'calendar-accounts'
      )!;
      return call[3];
    }

    it('returns structured JSON payload on success', async () => {
      state.calendarRegistryGetUnifiedCalendars.mockResolvedValue([
        {
          calendarId: 'cal-1',
          displayName: 'Work Calendar',
          preferredAccount: 'work',
          accounts: [
            { accountId: 'work', accessRole: 'owner', primary: true }
          ]
        }
      ]);

      const callback = await initAndGetResourceCallback();
      const result = await callback();

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('calendar://accounts');
      expect(result.contents[0].mimeType).toBe('application/json');

      const payload = JSON.parse(result.contents[0].text);
      expect(payload.accountCount).toBe(1);
      expect(payload.accountIds).toEqual(['work']);
      expect(payload.calendarCount).toBe(1);
      expect(payload.calendars[0].calendarId).toBe('cal-1');
      expect(payload.calendars[0].preferredAccount).toBe('work');
    });

    it('wraps non-McpError exceptions in McpError', async () => {
      state.calendarRegistryGetUnifiedCalendars.mockRejectedValue(
        new Error('network failure')
      );

      const callback = await initAndGetResourceCallback();

      await expect(callback()).rejects.toThrow(McpError);
      await expect(callback()).rejects.toThrow('Failed to load calendar accounts: network failure');
    });

    it('re-throws McpError instances directly', async () => {
      state.tokenManagerLoadAllAccounts.mockResolvedValue(new Map());
      state.tokenManagerValidateTokens.mockResolvedValue(false);

      const server = new GoogleCalendarMcpServer({
        transport: { type: 'stdio' },
        debug: false
      } as any);
      await server.initialize();

      const call = state.registerResource.mock.calls.find(
        (c: any[]) => c[0] === 'calendar-accounts'
      )!;
      const callback = call[3];

      // ensureAuthenticated will throw McpError because no accounts and no valid tokens
      await expect(callback()).rejects.toThrow(McpError);
      try {
        await callback();
      } catch (err) {
        expect(err).toBeInstanceOf(McpError);
        expect((err as McpError).code).toBe(ErrorCode.InvalidRequest);
      }
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
});
