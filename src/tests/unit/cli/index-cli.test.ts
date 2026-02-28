import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  parseArgs: vi.fn(),
  serverInitialize: vi.fn(async () => undefined),
  serverStart: vi.fn(async () => undefined),
  receivedServerConfig: undefined as any,
  initializeOAuth2Client: vi.fn(async () => ({ id: 'oauth-client' })),
  authStart: vi.fn(async () => true),
  authStop: vi.fn(async () => undefined),
  authCompletedSuccessfully: false,
}));

vi.mock('../../../config/TransportConfig.js', () => ({
  parseArgs: state.parseArgs
}));

vi.mock('../../../server.js', () => ({
  GoogleCalendarMcpServer: class MockGoogleCalendarMcpServer {
    constructor(config: any) {
      state.receivedServerConfig = config;
    }
    initialize = state.serverInitialize;
    start = state.serverStart;
  }
}));

vi.mock('../../../auth/client.js', () => ({
  initializeOAuth2Client: state.initializeOAuth2Client
}));

vi.mock('../../../auth/server.js', () => ({
  AuthServer: class MockAuthServer {
    authCompletedSuccessfully = state.authCompletedSuccessfully;
    start = state.authStart;
    stop = state.authStop;
    constructor(_oauthClient: any) {}
  }
}));

const originalArgv = process.argv.slice();
const originalAccountMode = process.env.GOOGLE_ACCOUNT_MODE;

async function importIndexModule() {
  vi.resetModules();
  process.argv = ['node', 'index.js', 'version'];
  return import('../../../index.js');
}

function mockProcessExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as any);
}

describe('CLI Entry (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.parseArgs.mockReturnValue({ transport: { type: 'stdio' }, debug: false });
    state.serverInitialize.mockResolvedValue(undefined);
    state.serverStart.mockResolvedValue(undefined);
    state.initializeOAuth2Client.mockResolvedValue({ id: 'oauth-client' });
    state.authStart.mockResolvedValue(true);
    state.authStop.mockResolvedValue(undefined);
    state.authCompletedSuccessfully = false;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
    if (originalAccountMode === undefined) {
      delete process.env.GOOGLE_ACCOUNT_MODE;
    } else {
      process.env.GOOGLE_ACCOUNT_MODE = originalAccountMode;
    }
    vi.restoreAllMocks();
  });

  it('runs main successfully with parsed config', async () => {
    const mod = await importIndexModule();

    await mod.main();

    expect(state.parseArgs).toHaveBeenCalledTimes(1);
    expect(state.serverInitialize).toHaveBeenCalledTimes(1);
    expect(state.serverStart).toHaveBeenCalledTimes(1);
    expect(state.receivedServerConfig).toEqual({ transport: { type: 'stdio' }, debug: false });
  });

  it('exits with code 1 when main throws', async () => {
    state.parseArgs.mockImplementation(() => {
      throw new Error('bad args');
    });
    const mod = await importIndexModule();
    mockProcessExit();

    await expect(mod.main()).rejects.toThrow('EXIT:1');
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Failed to start server'));
  });

  it('rejects invalid auth account ids', async () => {
    const mod = await importIndexModule();
    mockProcessExit();

    await expect(mod.runAuthServer('INVALID@ACCOUNT')).rejects.toThrow('EXIT:1');
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Invalid account ID')
    );
  });

  it('auth flow exits cleanly when already authenticated', async () => {
    state.authCompletedSuccessfully = true;
    const mod = await importIndexModule();
    const exitSpy = mockProcessExit();

    await expect(mod.runAuthServer('work')).rejects.toThrow('EXIT:1');
    expect(process.env.GOOGLE_ACCOUNT_MODE).toBe('work');
    expect(state.initializeOAuth2Client).toHaveBeenCalledTimes(1);
    expect(state.authStart).toHaveBeenCalledWith(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('auth flow exits with code 1 when server cannot start and auth is incomplete', async () => {
    state.authStart.mockResolvedValue(false);
    state.authCompletedSuccessfully = false;
    const mod = await importIndexModule();
    mockProcessExit();

    await expect(mod.runAuthServer('work')).rejects.toThrow('EXIT:1');
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Authentication failed. Could not start server')
    );
  });
});
