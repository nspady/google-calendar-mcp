import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  stdioConnect: vi.fn(async () => undefined),
  httpConnect: vi.fn(async () => undefined),
  processOn: vi.fn(process.on.bind(process)),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class MockMcpServer {
    connect = vi.fn(async () => undefined);
    tool = vi.fn();
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
    expect(state.mcpServerInstance.tool).toHaveBeenCalledTimes(1);
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

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
});
