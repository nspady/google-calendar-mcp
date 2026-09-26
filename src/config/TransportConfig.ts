import { AppConfig, CONFIG_ENV_VARS, ConfigError, loadAppConfig } from './AppConfig.js';

export type { TransportConfig, ServerConfig } from './AppConfig.js';

function helpText(): string {
  const envLines = CONFIG_ENV_VARS
    .map(v => `  ${v.name.padEnd(32)}${v.description.replace(/`/g, '')}`)
    .join('\n');
  return `
Google Calendar MCP Server

Usage: node build/index.js [options]

Options:
  --transport <type>        Transport type: stdio (default) | http
  --port <number>          Port for HTTP transport (default: 3000)
  --host <string>          Host for HTTP transport (default: 127.0.0.1)
  --debug                  Enable debug logging
  --enable-tools <list>    Comma-separated list of tools to enable (whitelist)
  --help                   Show this help message

Environment Variables:
${envLines}

Examples:
  node build/index.js                              # stdio (local use)
  node build/index.js --transport http --port 3000 # HTTP server
  node build/index.js --enable-tools list-events,create-event,get-current-time
  PORT=3000 TRANSPORT=http node build/index.js     # Using env vars
`;
}

/**
 * Parse CLI args and environment into the server configuration.
 * Exits the process with code 1 on malformed values (see AppConfig.ts).
 */
export function parseArgs(args: string[]): AppConfig {
  if (args.includes('--help')) {
    process.stderr.write(helpText());
    process.exit(0);
  }

  try {
    return loadAppConfig(args);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
