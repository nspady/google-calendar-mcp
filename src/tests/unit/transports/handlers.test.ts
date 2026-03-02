import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  transport: undefined as { handleRequest: ReturnType<typeof vi.fn> } | undefined,
  expressApp: undefined as any,
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

// Mock express to capture the app
vi.mock('express', () => {
  const routes: { method: string; path: string | string[]; handlers: Function[] }[] = [];
  const middlewares: Function[] = [];

  const app: any = {
    set: vi.fn(),
    use: vi.fn((...args: any[]) => {
      // Global middleware (no path)
      if (typeof args[0] === 'function') {
        middlewares.push(args[0]);
      }
    }),
    get: vi.fn((path: string | string[], ...handlers: Function[]) => {
      routes.push({ method: 'GET', path, handlers });
    }),
    post: vi.fn((path: string, ...handlers: Function[]) => {
      routes.push({ method: 'POST', path, handlers });
    }),
    delete: vi.fn((path: string, ...handlers: Function[]) => {
      routes.push({ method: 'DELETE', path, handlers });
    }),
    all: vi.fn((path: string, ...handlers: Function[]) => {
      routes.push({ method: 'ALL', path, handlers });
    }),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      if (callback) callback();
    }),
    _routes: routes,
    _middlewares: middlewares,
  };

  const expressFn: any = () => app;
  expressFn.json = vi.fn(() => (_req: any, _res: any, next: Function) => next());
  expressFn.urlencoded = vi.fn(() => (_req: any, _res: any, next: Function) => next());

  state.expressApp = app;
  return { default: expressFn };
});

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
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    _ended: false,
    headersSent: false,
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: any, data: any) {
      this._body = JSON.stringify(data);
      this.headersSent = true;
      return this;
    }),
    type: vi.fn(function (this: any, _type: string) {
      return this;
    }),
    send: vi.fn(function (this: any, body: string) {
      this._body = body;
      this.headersSent = true;
      return this;
    }),
    end: vi.fn(function (this: any) {
      this._ended = true;
      return this;
    }),
    setHeader: vi.fn(function (this: any, key: string, value: string) {
      this._headers[key] = value;
    }),
    // For compatibility with raw http patterns
    writeHead: vi.fn(function (this: any, statusCode: number, headers?: Record<string, string>) {
      this._status = statusCode;
      this.headersSent = true;
      if (headers) {
        Object.assign(this._headers, headers);
      }
    }),
  };
  return res;
}

function createMockRequest(input: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  return {
    method: input.method,
    url: input.url,
    headers: input.headers ?? {},
    body: input.body,
    params: input.params ?? {},
    query: input.query ?? {},
  } as any;
}

/**
 * Find route handler and run middleware + handler chain
 */
async function invokeRoute(
  method: string,
  url: string,
  req: any,
  res: any
): Promise<void> {
  const app = state.expressApp;
  if (!app) throw new Error('Express app not initialized');

  // Run global middlewares first
  for (const mw of app._middlewares) {
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) return; // Middleware short-circuited
  }

  // Find matching route (exact match preferred, parameterized as fallback)
  const route = app._routes.find((r: any) => {
    const methodMatch = r.method === 'ALL' || r.method === method;
    if (!methodMatch) return false;
    if (Array.isArray(r.path)) {
      return r.path.some((p: string) => p === url);
    }
    // Handle parameterized routes like /api/accounts/:id
    const pathPattern = r.path.replace(/:[\w]+/g, '[^/]+');
    const regex = new RegExp(`^${pathPattern}$`);
    return regex.test(url);
  });

  if (!route) throw new Error(`No route found for ${method} ${url}`);

  // Run all handlers in the chain
  for (const handler of route.handlers) {
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    if (!nextCalled && handler !== route.handlers[route.handlers.length - 1]) {
      return; // Handler short-circuited without calling next
    }
  }
}

describe('Transport Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transport = undefined;
    if (state.expressApp) {
      state.expressApp._routes.length = 0;
      state.expressApp._middlewares.length = 0;
    }
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

    await invokeRoute('GET', '/health', req, res);

    expect(res._status).toBe(403);
    expect(res._body).toContain('Invalid origin');
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

    await invokeRoute('GET', '/health', req, res);

    expect(res._headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:4001');
    const body = JSON.parse(res._body);
    expect(body.status).toBe('healthy');
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

    await invokeRoute('GET', '/api/accounts', req, res);

    expect(tokenManager.listAccounts).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res._body);
    expect(body.accounts).toEqual([{ id: 'work', status: 'active' }]);
  });

  it('creates OAuth URL for POST /api/accounts', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const tokenManager = { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
    const handler = new HttpTransportHandler(server, { port: 4000, host: 'localhost' }, tokenManager);
    await handler.connect();

    const req = createMockRequest({
      method: 'POST',
      url: '/api/accounts',
      headers: { origin: 'http://localhost', accept: 'application/json', 'content-length': '25' },
      body: { accountId: 'work' }
    });
    const res = createMockResponse();

    await invokeRoute('POST', '/api/accounts', req, res);

    expect(state.validateAccountId).toHaveBeenCalledWith('work');
    const body = JSON.parse(res._body);
    expect(body.accountId).toBe('work');
    expect(body.authUrl).toBe('https://auth.example.com');
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
      headers: { origin: 'http://localhost', accept: 'application/json', 'content-type': 'application/json' }
    });
    const res = createMockResponse();

    await invokeRoute('ALL', '/mcp', req, res);

    expect(res._status).toBe(500);
    expect(res._body).toContain('Internal server error');
  });
});
