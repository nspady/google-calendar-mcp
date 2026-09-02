import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requestHandler: undefined as ((req: any, res: any) => Promise<void>) | undefined,
  transport: undefined as { handleRequest: ReturnType<typeof vi.fn> } | undefined,
  transports: [] as any[],
  suppressSessionInit: false,
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
    sessionId: string | undefined = undefined;
    onclose: (() => void) | undefined = undefined;
    options: any;
    handleRequest = vi.fn(async (_req: any, _res: any, body?: any) => {
      // Simulate the SDK assigning a session id and firing the callback on initialize
      if (!state.suppressSessionInit && body?.method === 'initialize' && this.options?.sessionIdGenerator) {
        this.sessionId = this.options.sessionIdGenerator();
        this.options.onsessioninitialized?.(this.sessionId);
      }
    });
    close = vi.fn(async () => {
      this.onclose?.();
    });
    constructor(options?: any) {
      this.options = options;
      state.transport = this;
      state.transports.push(this);
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
  const res = new EventEmitter() as any;
  Object.assign(res, {
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
  });
  return res;
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

function makeTokenManager() {
  return { listAccounts: vi.fn(), getAccountMode: vi.fn(), setAccountMode: vi.fn(), clearTokens: vi.fn(), saveTokens: vi.fn() } as any;
}

function makeInitializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' }
    }
  };
}

async function postJson(req: any, res: any, body: unknown): Promise<void> {
  const pending = invokeHandler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  await pending;
}

// Drives a full session-opening initialize POST and returns the created transport + id.
async function openSession(): Promise<{ transport: any; sessionId: string }> {
  const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
  const res = createMockResponse();
  await postJson(req, res, makeInitializeBody());
  const transport = state.transport;
  return { transport, sessionId: transport.sessionId };
}

describe('Transport Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requestHandler = undefined;
    state.transport = undefined;
    state.transports = [];
    state.suppressSessionInit = false;
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
    const handler = new HttpTransportHandler(() => server, { port: 3999, host: '127.0.0.1' }, tokenManager);
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
    const handler = new HttpTransportHandler(() => server, { port: 4001, host: '127.0.0.1' }, tokenManager);
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

  it('allows MCP protocol and SSE resumption headers in CORS preflights', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, { port: 4001, host: '127.0.0.1' }, makeTokenManager());
    await handler.connect();

    const req = createMockRequest({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'http://localhost:5173' }
    });
    const res = createMockResponse();

    await invokeHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID'
    );
    expect(res.headers['Access-Control-Expose-Headers']).toBe('Mcp-Session-Id');
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
    const handler = new HttpTransportHandler(() => server, {}, tokenManager);
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
    const handler = new HttpTransportHandler(() => server, { port: 4000, host: 'localhost' }, tokenManager);
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

  it('creates a session on initialize and reuses it for follow-up requests', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const { transport, sessionId } = await openSession();
    expect(sessionId).toBeTruthy();
    expect(state.transports).toHaveLength(1);
    expect(server.connect).toHaveBeenCalledTimes(1);
    expect(transport.handleRequest).toHaveBeenCalledTimes(1);

    const followReq = createMockRequest({
      method: 'POST',
      url: '/',
      headers: { accept: 'application/json', 'mcp-session-id': sessionId }
    });
    const followRes = createMockResponse();
    await postJson(followReq, followRes, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    // Reused the same transport; no new transport or server built.
    expect(state.transports).toHaveLength(1);
    expect(server.connect).toHaveBeenCalledTimes(1);
    expect(transport.handleRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-initialize POST without a session id with 400', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
    const res = createMockResponse();
    await postJson(req, res, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('No valid session ID');
    expect(state.transports).toHaveLength(0);
  });

  it('rejects GET/DELETE with an unknown session id with 404/-32001 (never 500)', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    for (const method of ['GET', 'DELETE']) {
      const req = createMockRequest({ method, url: '/mcp', headers: { accept: 'application/json', 'mcp-session-id': 'unknown' } });
      const res = createMockResponse();
      await invokeHandler(req, res);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe(-32001);
    }
    expect(state.transports).toHaveLength(0);
  });

  it('rejects GET/DELETE with no session id with 400/-32000', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    for (const method of ['GET', 'DELETE']) {
      const req = createMockRequest({ method, url: '/mcp', headers: { accept: 'application/json' } });
      const res = createMockResponse();
      await invokeHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(-32000);
    }
  });

  it('returns 404/-32001 for a POST carrying an unknown session id', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json', 'mcp-session-id': 'bogus' } });
    const res = createMockResponse();
    await postJson(req, res, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe(-32001);
  });

  it('returns 400/-32700 for a malformed JSON body, never 500', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
    const res = createMockResponse();
    const pending = invokeHandler(req, res);
    req.emit('data', Buffer.from('{not valid json'));
    req.emit('end');
    await pending;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it('returns 400/-32700 for an empty MCP POST body', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
    const res = createMockResponse();
    const pending = invokeHandler(req, res);
    req.emit('end');
    await pending;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it('removes a session from the map when the transport closes', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const { transport, sessionId } = await openSession();
    await transport.close(); // fires onclose -> map delete

    // A follow-up carrying the now-removed id is treated as unknown -> 404.
    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json', 'mcp-session-id': sessionId } });
    const res = createMockResponse();
    await postJson(req, res, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe(-32001);
  });

  it('evicts the least-recently-used session, sparing recently-touched ones', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const MAX_SESSIONS = 128;
    const sessions: Array<Awaited<ReturnType<typeof openSession>>> = [];
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.push(await openSession());
    }
    expect(state.transports).toHaveLength(MAX_SESSIONS);

    // Touch the oldest-created session so it becomes most-recently-used.
    const oldest = sessions[0];
    const touchReq = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json', 'mcp-session-id': oldest.sessionId } });
    const touchRes = createMockResponse();
    await postJson(touchReq, touchRes, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    // Open one more session at capacity -> LRU eviction fires.
    await openSession();

    // The touched oldest session survives; the now-LRU (second-created) is evicted.
    expect(oldest.transport.close).not.toHaveBeenCalled();
    expect(sessions[1].transport.close).toHaveBeenCalledTimes(1);
  });

  it('does not evict a session with an active SSE response', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const MAX_SESSIONS = 128;
    const sessions: Array<Awaited<ReturnType<typeof openSession>>> = [];
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.push(await openSession());
    }

    const active = sessions[0];
    const streamReq = createMockRequest({
      method: 'GET',
      url: '/mcp',
      headers: { accept: 'text/event-stream', 'mcp-session-id': active.sessionId }
    });
    const streamRes = createMockResponse();
    await invokeHandler(streamReq, streamRes);

    // Move every inactive session behind the active one, making the active
    // session the least-recently-used entry in the map.
    for (const session of sessions.slice(1)) {
      const touchReq = createMockRequest({
        method: 'POST',
        url: '/',
        headers: { accept: 'application/json', 'mcp-session-id': session.sessionId }
      });
      await postJson(
        touchReq,
        createMockResponse(),
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
      );
    }

    await openSession();

    expect(active.transport.close).not.toHaveBeenCalled();
    expect(sessions[1].transport.close).toHaveBeenCalledTimes(1);

    // Once the SSE response closes, the session is eligible for LRU eviction.
    streamRes.emit('close');
    await openSession();
    expect(active.transport.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a new session when every session has an active SSE response', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const MAX_SESSIONS = 128;
    const sessions: Array<Awaited<ReturnType<typeof openSession>>> = [];
    const streamResponses: any[] = [];
    for (let i = 0; i < MAX_SESSIONS; i++) {
      const session = await openSession();
      sessions.push(session);

      const streamReq = createMockRequest({
        method: 'GET',
        url: '/mcp',
        headers: { accept: 'text/event-stream', 'mcp-session-id': session.sessionId }
      });
      const streamRes = createMockResponse();
      streamResponses.push(streamRes);
      await invokeHandler(streamReq, streamRes);
    }

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
    const res = createMockResponse();
    await postJson(req, res, makeInitializeBody());

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe(-32000);
    expect(state.transports).toHaveLength(MAX_SESSIONS);
    expect(sessions.every(({ transport }) => transport.close.mock.calls.length === 0)).toBe(true);

    for (const streamRes of streamResponses) {
      streamRes.emit('close');
    }
  });

  it('returns 500 when a mapped transport request handling throws', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    const { transport, sessionId } = await openSession();
    transport.handleRequest.mockRejectedValueOnce(new Error('boom'));

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json', 'mcp-session-id': sessionId } });
    const res = createMockResponse();
    await postJson(req, res, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Internal server error');
  });

  it('closes an initialize transport whose handshake never commits a session id', async () => {
    const server = { connect: vi.fn(async () => undefined) } as any;
    const handler = new HttpTransportHandler(() => server, {}, makeTokenManager());
    await handler.connect();

    // Simulate an initialize whose handshake never assigns a session id (aborted).
    state.suppressSessionInit = true;

    const req = createMockRequest({ method: 'POST', url: '/', headers: { accept: 'application/json' } });
    const res = createMockResponse();
    await postJson(req, res, makeInitializeBody());

    // The uncommitted transport is never tracked in the map and is closed to
    // release its connected server deterministically.
    expect(state.transports).toHaveLength(1);
    expect(state.transports[0].close).toHaveBeenCalledTimes(1);
    expect(state.transports[0].sessionId).toBeUndefined();
  });
});
