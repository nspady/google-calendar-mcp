/**
 * Central application configuration.
 *
 * Every environment variable the server reads is declared in CONFIG_ENV_VARS and
 * parsed in this file. Precedence is CLI flag > environment variable > default.
 * Malformed values throw ConfigError at startup instead of silently falling back.
 *
 * Adding a setting:
 *   1. Add a row to CONFIG_ENV_VARS (the README "Configuration" table must list it;
 *      src/tests/unit/docs/docs-sync.test.ts enforces this).
 *   2. Add a field to AppConfig and resolve it in loadAppConfig() with a parser
 *      that throws ConfigError on malformed input.
 *   3. If a module needs the value outside startup, add an accessor here rather
 *      than reading process.env directly (src/tests/unit/config/AppConfig.test.ts
 *      fails on process.env reads elsewhere in src/).
 *
 * Token path and account mode resolution live in src/auth/paths.js because
 * scripts/account-manager.js imports that file directly under plain Node.
 */
import * as path from 'path';
import { getAccountMode, getSecureTokenPath } from '../auth/paths.js';

export type TransportType = 'stdio' | 'http';
export type ConfigSource = 'cli' | 'env' | 'default';

export interface TransportConfig {
  type: TransportType;
  port?: number;
  host?: string;
}

export interface ServerConfig {
  transport: TransportConfig;
  debug?: boolean;
  enabledTools?: string[];
}

export interface AppConfig extends ServerConfig {
  transport: Required<TransportConfig>;
  debug: boolean;
  /** Absolute credentials path from GOOGLE_OAUTH_CREDENTIALS, or undefined to use the package default */
  credentialsPath?: string;
  tokenPath: string;
  accountMode: string;
  /** NODE_ENV=test: skips startup auth, uses the 'test' token namespace, quiets token logging */
  isTest: boolean;
  sources: Record<string, ConfigSource>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface EnvVarDoc {
  name: string;
  cliFlag?: string;
  defaultValue: string;
  description: string;
}

export const CONFIG_ENV_VARS: readonly EnvVarDoc[] = [
  { name: 'GOOGLE_OAUTH_CREDENTIALS', defaultValue: '`gcp-oauth.keys.json` in the package root', description: 'Path to the OAuth credentials file' },
  { name: 'GOOGLE_CALENDAR_MCP_TOKEN_PATH', defaultValue: '`$XDG_CONFIG_HOME/google-calendar-mcp/tokens.json`', description: 'Custom token storage location' },
  { name: 'XDG_CONFIG_HOME', defaultValue: '`~/.config`', description: 'Base config directory for token storage (ignored if GOOGLE_CALENDAR_MCP_TOKEN_PATH is set)' },
  { name: 'GOOGLE_ACCOUNT_MODE', defaultValue: '`normal`', description: 'Account nickname used for single-account operations and the `auth` command' },
  { name: 'ENABLED_TOOLS', cliFlag: '--enable-tools', defaultValue: 'all tools', description: 'Comma-separated list of tools to expose (see Tool Filtering)' },
  { name: 'TRANSPORT', cliFlag: '--transport', defaultValue: '`stdio`', description: 'Transport type: `stdio` or `http`' },
  { name: 'PORT', cliFlag: '--port', defaultValue: '`3000`', description: 'HTTP transport port (1-65535)' },
  { name: 'HOST', cliFlag: '--host', defaultValue: '`127.0.0.1`', description: 'HTTP transport bind address' },
  { name: 'DEBUG', cliFlag: '--debug', defaultValue: '`false`', description: 'Enable debug logging when set to `true`' },
  { name: 'NODE_ENV', defaultValue: 'unset', description: '`test` skips startup authentication and uses the `test` account namespace (for the test suite)' },
];

type Env = NodeJS.ProcessEnv;

// Empty strings are treated as unset, matching the previous `process.env.X || default` reads
function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function parseTransport(raw: string, origin: string): TransportType {
  if (raw === 'stdio' || raw === 'http') {
    return raw;
  }
  throw new ConfigError(`${origin} must be "stdio" or "http", got "${raw}"`);
}

function parsePort(raw: string, origin: string): number {
  const port = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${origin} must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

function parseEnabledTools(raw: string, origin: string): string[] {
  const parsed = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (parsed.length === 0) {
    throw new ConfigError(`${origin} requires at least one tool name`);
  }
  return parsed;
}

function requireFlagValue(args: string[], index: number, flag: string, hint: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new ConfigError(`${flag} requires ${hint}`);
  }
  return value;
}

/** Path from GOOGLE_OAUTH_CREDENTIALS, resolved against the current directory, or undefined if unset. */
export function getCredentialsPathSetting(env: Env = process.env): string | undefined {
  const raw = envValue(env, 'GOOGLE_OAUTH_CREDENTIALS');
  return raw ? path.resolve(raw) : undefined;
}

/** True when NODE_ENV=test (set automatically by vitest). */
export function isTestEnvironment(env: Env = process.env): boolean {
  return env.NODE_ENV === 'test';
}

/**
 * Resolve the full configuration from CLI args and environment.
 * Unrecognized args are ignored (index.ts handles commands like `start`).
 * @throws ConfigError on malformed values
 */
export function loadAppConfig(args: string[], env: Env = process.env): AppConfig {
  const sources: Record<string, ConfigSource> = {};

  const fromEnv = <T>(key: string, name: string, parse: (raw: string, origin: string) => T, fallback: T): T => {
    const raw = envValue(env, name);
    if (raw === undefined) {
      sources[key] = 'default';
      return fallback;
    }
    sources[key] = 'env';
    return parse(raw, name);
  };

  let transportType = fromEnv('transport', 'TRANSPORT', parseTransport, 'stdio' as TransportType);
  let port = fromEnv('port', 'PORT', parsePort, 3000);
  let host = fromEnv('host', 'HOST', (raw) => raw, '127.0.0.1');
  let debug = fromEnv('debug', 'DEBUG', (raw) => raw === 'true', false);

  // ENABLED_TOOLS="" is an error rather than "unset" (documented in README Tool Filtering)
  let enabledTools: string[] | undefined;
  if (env.ENABLED_TOOLS !== undefined) {
    enabledTools = parseEnabledTools(env.ENABLED_TOOLS, 'ENABLED_TOOLS');
    sources.enabledTools = 'env';
  } else {
    sources.enabledTools = 'default';
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--transport':
        transportType = parseTransport(requireFlagValue(args, ++i, '--transport', 'a value (stdio or http)'), '--transport');
        sources.transport = 'cli';
        break;
      case '--port':
        port = parsePort(requireFlagValue(args, ++i, '--port', 'a port number'), '--port');
        sources.port = 'cli';
        break;
      case '--host':
        host = requireFlagValue(args, ++i, '--host', 'a host address');
        sources.host = 'cli';
        break;
      case '--debug':
        debug = true;
        sources.debug = 'cli';
        break;
      case '--enable-tools':
        enabledTools = parseEnabledTools(
          requireFlagValue(args, ++i, '--enable-tools', 'a comma-separated list of tool names'),
          '--enable-tools'
        );
        sources.enabledTools = 'cli';
        break;
    }
  }

  const credentialsPath = getCredentialsPathSetting(env);
  sources.credentialsPath = credentialsPath ? 'env' : 'default';
  sources.tokenPath = envValue(env, 'GOOGLE_CALENDAR_MCP_TOKEN_PATH') || envValue(env, 'XDG_CONFIG_HOME') ? 'env' : 'default';
  sources.accountMode = env.GOOGLE_ACCOUNT_MODE !== undefined ? 'env' : 'default';

  let accountMode: string;
  try {
    accountMode = getAccountMode(env);
  } catch (error) {
    throw new ConfigError(`GOOGLE_ACCOUNT_MODE: ${error instanceof Error ? error.message : error}`);
  }

  return Object.freeze({
    transport: Object.freeze({ type: transportType, port, host }),
    debug,
    enabledTools: enabledTools ? Object.freeze([...enabledTools]) as string[] : undefined,
    credentialsPath,
    tokenPath: getSecureTokenPath(env),
    accountMode,
    isTest: isTestEnvironment(env),
    sources: Object.freeze(sources)
  });
}

/** One line per setting with its source, for the startup stderr log. */
export function formatResolvedConfig(config: ServerConfig & Partial<AppConfig>): string {
  const sources = config.sources ?? {};
  const line = (label: string, value: unknown, key: string) =>
    `  ${label}: ${value}${sources[key] ? ` (${sources[key]})` : ''}`;

  const lines = [
    'Resolved configuration:',
    line('transport', config.transport.type, 'transport')
  ];
  if (config.transport.type === 'http') {
    lines.push(line('host', config.transport.host, 'host'));
    lines.push(line('port', config.transport.port, 'port'));
  }
  lines.push(line('enabledTools', config.enabledTools ? config.enabledTools.join(',') : 'all', 'enabledTools'));
  lines.push(line('debug', config.debug ?? false, 'debug'));
  if (config.accountMode !== undefined) {
    lines.push(line('credentials', config.credentialsPath ?? 'package default (gcp-oauth.keys.json)', 'credentialsPath'));
    lines.push(line('tokenPath', config.tokenPath, 'tokenPath'));
    lines.push(line('accountMode', config.accountMode, 'accountMode'));
  }
  if (config.isTest) {
    lines.push('  NODE_ENV=test: startup authentication skipped');
  }
  return lines.join('\n') + '\n';
}
