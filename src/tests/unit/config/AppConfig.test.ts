import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ConfigError, formatResolvedConfig, getServiceAccountConfig, loadAppConfig } from '../../../config/AppConfig.js';

// Minimal env so tests don't depend on the developer's shell
const baseEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  XDG_CONFIG_HOME: '/tmp/xdg',
  ...overrides
});

describe('loadAppConfig', () => {
  it('uses defaults when nothing is set', () => {
    const config = loadAppConfig([], baseEnv());

    expect(config.transport).toEqual({ type: 'stdio', port: 3000, host: '127.0.0.1' });
    expect(config.debug).toBe(false);
    expect(config.enabledTools).toBeUndefined();
    expect(config.credentialsPath).toBeUndefined();
    expect(config.tokenPath).toBe(path.join('/tmp/xdg', 'google-calendar-mcp', 'tokens.json'));
    expect(config.accountMode).toBe('normal');
    expect(config.isTest).toBe(false);
    expect(config.sources.transport).toBe('default');
    expect(config.sources.port).toBe('default');
  });

  it('reads environment variables', () => {
    const config = loadAppConfig([], baseEnv({
      TRANSPORT: 'http',
      PORT: '4000',
      HOST: '0.0.0.0',
      DEBUG: 'true',
      ENABLED_TOOLS: 'list-events, get-event',
      GOOGLE_OAUTH_CREDENTIALS: 'creds.json',
      GOOGLE_CALENDAR_MCP_TOKEN_PATH: '/tmp/tokens.json',
      GOOGLE_ACCOUNT_MODE: 'work',
      NODE_ENV: 'test'
    }));

    expect(config.transport).toEqual({ type: 'http', port: 4000, host: '0.0.0.0' });
    expect(config.debug).toBe(true);
    expect(config.enabledTools).toEqual(['list-events', 'get-event']);
    expect(config.credentialsPath).toBe(path.resolve('creds.json'));
    expect(config.tokenPath).toBe('/tmp/tokens.json');
    expect(config.accountMode).toBe('work');
    expect(config.isTest).toBe(true);
    expect(config.sources.transport).toBe('env');
    expect(config.sources.accountMode).toBe('env');
  });

  it('lets CLI flags override environment variables', () => {
    const config = loadAppConfig(
      ['start', '--transport', 'stdio', '--port', '5000', '--host', 'localhost', '--debug', '--enable-tools', 'list-events'],
      baseEnv({ TRANSPORT: 'http', PORT: '4000', HOST: '0.0.0.0', ENABLED_TOOLS: 'get-event' })
    );

    expect(config.transport).toEqual({ type: 'stdio', port: 5000, host: 'localhost' });
    expect(config.debug).toBe(true);
    expect(config.enabledTools).toEqual(['list-events']);
    expect(config.sources.transport).toBe('cli');
    expect(config.sources.enabledTools).toBe('cli');
  });

  it('does not validate environment values that a CLI flag overrides', () => {
    const config = loadAppConfig(
      ['--transport', 'http', '--port', '3001', '--enable-tools', 'list-events'],
      baseEnv({ TRANSPORT: 'sse', PORT: 'abc', ENABLED_TOOLS: '' })
    );
    expect(config.transport.type).toBe('http');
    expect(config.transport.port).toBe(3001);
    expect(config.enabledTools).toEqual(['list-events']);
  });

  it('treats empty environment values as unset', () => {
    const config = loadAppConfig([], baseEnv({ TRANSPORT: '', PORT: '', HOST: '', GOOGLE_OAUTH_CREDENTIALS: '' }));
    expect(config.transport).toEqual({ type: 'stdio', port: 3000, host: '127.0.0.1' });
    expect(config.credentialsPath).toBeUndefined();
  });

  it('keeps DEBUG permissive because other tools share the variable', () => {
    expect(loadAppConfig([], baseEnv({ DEBUG: 'express:*' })).debug).toBe(false);
    expect(loadAppConfig([], baseEnv({ DEBUG: '1' })).debug).toBe(false);
  });

  it('returns a frozen config', () => {
    const config = loadAppConfig([], baseEnv());
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.transport)).toBe(true);
  });

  describe('fails loudly on malformed values', () => {
    it.each([
      [[], { PORT: 'abc' }, /PORT must be an integer/],
      [[], { PORT: '3000abc' }, /PORT must be an integer/],
      [[], { PORT: '70000' }, /PORT must be an integer/],
      [[], { PORT: '0' }, /PORT must be an integer/],
      [[], { TRANSPORT: 'htp' }, /TRANSPORT must be "stdio" or "http"/],
      [[], { ENABLED_TOOLS: '' }, /ENABLED_TOOLS requires at least one tool name/],
      [[], { ENABLED_TOOLS: ' , ,' }, /ENABLED_TOOLS requires at least one tool name/],
      [[], { GOOGLE_ACCOUNT_MODE: 'Work' }, /GOOGLE_ACCOUNT_MODE: Invalid account ID/],
      [['--port', 'abc'], {}, /--port must be an integer/],
      [['--port'], {}, /--port requires a port number/],
      [['--transport', 'bogus'], {}, /--transport must be "stdio" or "http"/],
      [['--transport'], {}, /--transport requires a value/],
      [['--host', '--debug'], {}, /--host requires a host address/],
      [['--enable-tools'], {}, /--enable-tools requires a comma-separated list/],
      [['--enable-tools', ', ,'], {}, /--enable-tools requires at least one tool name/],
    ] as Array<[string[], Record<string, string>, RegExp]>)('%j with env %j', (args, env, message) => {
      expect(() => loadAppConfig(args, baseEnv(env))).toThrow(ConfigError);
      expect(() => loadAppConfig(args, baseEnv(env))).toThrow(message);
    });
  });
});

describe('getServiceAccountConfig', () => {
  it('returns the configured key paths and impersonated subject', () => {
    expect(getServiceAccountConfig({
      GOOGLE_SERVICE_ACCOUNT_KEY: '/keys/explicit.json',
      GOOGLE_APPLICATION_CREDENTIALS: '/keys/ambient.json',
      GOOGLE_SERVICE_ACCOUNT_SUBJECT: 'user@example.com'
    })).toEqual({
      keyPath: '/keys/explicit.json',
      applicationCredentialsPath: '/keys/ambient.json',
      subject: 'user@example.com'
    });
  });

  it('treats empty settings as unset', () => {
    expect(getServiceAccountConfig({
      GOOGLE_SERVICE_ACCOUNT_KEY: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      GOOGLE_SERVICE_ACCOUNT_SUBJECT: ''
    })).toEqual({});
  });
});

describe('formatResolvedConfig', () => {
  it('lists each setting with its source', () => {
    const output = formatResolvedConfig(loadAppConfig(['--transport', 'http'], baseEnv({ PORT: '4000' })));

    expect(output).toContain('transport: http (cli)');
    expect(output).toContain('port: 4000 (env)');
    expect(output).toContain('host: 127.0.0.1 (default)');
    expect(output).toContain('accountMode: normal (default)');
  });

  it('omits HTTP-only settings for stdio', () => {
    const output = formatResolvedConfig(loadAppConfig([], baseEnv()));
    expect(output).not.toContain('  port:');
  });
});

describe('process.env access', () => {
  // Env reads belong in AppConfig.ts (paths.js is shared with scripts/ under plain Node).
  // Runtime writes to process.env are shared mutable state across HTTP sessions.
  const ALLOWED = new Set(['config/AppConfig.ts', 'auth/paths.js']);
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
      return /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
  }

  it('is confined to the config module', () => {
    const offenders = sourceFiles(srcRoot)
      .map(file => path.relative(srcRoot, file).split(path.sep).join('/'))
      .filter(rel => !ALLOWED.has(rel))
      .filter(rel => /process\.env\b/.test(readFileSync(path.join(srcRoot, rel), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
