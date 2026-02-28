import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requestHandler: undefined as ((req: any, res: any) => Promise<void>) | undefined,
  transport: undefined as { handleRequest: ReturnType<typeof vi.fn> } | undefined,
  listen: vi.fn(),
  clearCache: vi.fn(),
  renderAuthSuccess: vi.fn(async () => '<html>success</html>'),
  renderAuthError: vi.fn(async () => '<html>error</html>'),
  loadWebFile: vi.fn(async (name: string) => `file:${name}`),
  validateAccountId: vi.fn(),
  loadCredentials: vi.fn(async () => ({ client_id: 'client-id', client_secret: 'client-secret' })),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
    handleRequest = vi.fn(async () => undefined);
    constructor() {
      state.transport = this;
    }
  }
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {}
}));

vi.mock('http', () => ({
  default: {
    createServer: vi.fn((handler: any) => {
      state.requestHandler = handler;
      return {
        listen: state.listen
      };
    })
  }
}));

vi.mock('../../../web/templates.js', () => ({
  renderAuthSuccess: state.renderAuthSuccess,
  renderAuthError: state.renderAuthError,
  loadWebFile: state.loadWebFile
}));

vi.mock('../../../services/CalendarRegistry.js', () => ({
  CalendarRegistry: {
    getInstance: vi.fn(() => ({
      clearCache: state.clearCache
    }))
  }
}));

vi.mock('../../../auth/paths.js', () => ({
  validateAccountId: state.validateAccountId
}));

vi.mock('../../../auth/client.js', () => ({
  loadCredentials: state.loadCredentials
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    generateAuthUrl = vi.fn(() => 'https://auth.example.com');
    getToken = vi.fn(async () => ({ tokens: { access_token: 'token', refresh_token: 'refresh' } }));
    setCredentials = vi.fn();
    getTokenInfo = vi.fn(async () => ({ email: 'person@example.com' }));
  }
}));

import { HttpTransportHandler } from '../../../transports/http.js';
import { StdioTransportHandler } from '../../../transports/stdio.js';

function createMockResponse() {
  return {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: '',
    headersSent: false,
    setHeader: vi.fn(function (this: any, key: string, value: string) {
      this.headers[key] = value;
    }),
    writeHead: vi.fn(function (this: any, statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      this.headersSent = true;
      if (headers) {
        Object.assign(this.headers, headers);
      }
    }),
    end: vi.fn(function (this: any, chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
    }),
  };
}

function createMockRequest(input: {
  method: string;
  url: string;
  headers?: Record<string, string>;
}) {
  const req = new EventEmitter() as any;
  req.method = input.method;
  req.url = input.url;
  req.headers = input.headers ?? {};
  return req;
}

async function invokeHandler(req: any, res: any): Promise<void> {
  const handler = state.requestHandler;
  if (!handler) {
    throw new Error('Request handler was not initialized');
  }
  await handler(req, res);
}

describe('Transport Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requestHandler = undefined;
    state.transport = undefined;
    state.listen.mockImplementation((_port: number, _host: string, callback?: () => void) => {
      if (callback) {
        callback();
      }
    });
  });

  it('connects stdio transport through server.connect', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new StdioTransportHandler(server);

    await handler.connect();

    expect(server.connect).toHaveBeenCalledTimes(1);
  });

  it('rejects requests from non-localhost origins', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
    const handler = new HttpTransportHandler(server, { port: 3999, host: '127.0.0.1' }, tokenManager);
    await handler.connect();

    const req = createMockRequest({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example.com', accept: 'application/json' }
    });
    const res = createMockResponse();

    await invokeHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Invalid origin');
  });

  it('returns health payload and sets localhost CORS defaults', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
    const handler = new HttpTransportHandler(server, { port: 4001, host: '127.0.0.1' }, tokenManager);
    await handler.connect();

    const req = createMockRequest({
      method: 'GET',
      url: '/health',
      headers: { accept: 'application/json' }
    });
    const res = createMockResponse();

    await invokeHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:4001');
    expect(JSON.parse(res.body).status).toBe('healthy');
  });

  it('returns account list via API endpoint', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = {
      listAccounts: vi.fn(async () => [{ id: 'work', status: 'active' }]),
      getAccountMode: vi.fn(),
      setAccountMode: vi.fn(),
      clearTokens: vi.fn(),
      saveTokens: vi.fn()
    } as any;
    const handler = new HttpTransportHandler(server, {}, tokenManager);
    await handler.connect();

    const req = createMockRequest({
      method: 'GET',
      url: '/api/accounts',
      headers: { origin: 'http://localhost', accept: 'application/json' }
    });
    const res = createMockResponse();

    await invokeHandler(req, res);

    expect(tokenManager.listAccounts).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).accounts).toEqual([{ id: 'work', status: 'active' }]);
  });

  it('creates OAuth URL for POST /api/accounts', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
    const handler = new HttpTransportHandler(server, { port: 4000, host: 'localhost' }, tokenManager);
    await handler.connect();

    const req = createMockRequest({
      method: 'POST',
      url: '/api/accounts',
      headers: { origin: 'http://localhost', accept: 'application/json', 'content-length': '25' }
    });
    const res = createMockResponse();

    const pending = invokeHandler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ accountId: 'work' })));
    req.emit('end');
    await pending;

    expect(state.validateAccountId).toHaveBeenCalledWith('work');
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.accountId).toBe('work');
    expect(payload.authUrl).toBe('https://auth.example.com');
  });

  it('returns 500 when MCP transport request handling throws', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
    const handler = new HttpTransportHandler(server, {}, tokenManager);
    await handler.connect();

    if (!state.transport) {
      throw new Error('Transport mock not initialized');
    }
    state.transport.handleRequest.mockRejectedValueOnce(new Error('boom'));

    const req = createMockRequest({
      method: 'POST',
      url: '/mcp',
      headers: { origin: 'http://localhost', accept: 'application/json' }
    });
    const res = createMockResponse();

    await invokeHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Internal server error');
  });
});
