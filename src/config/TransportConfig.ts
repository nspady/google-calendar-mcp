export interface TransportConfig {
  type: 'stdio' | 'http';
  port?: number;
  host?: string;
}

export interface ServerConfig {
  transport: TransportConfig;
  debug?: boolean;
  readonlyMode?: boolean;
  disabledTools?: string[];
  enabledTools?: string[];
}

export function parseArgs(args: string[]): ServerConfig {
  // Start with environment variables as base config
  const config: ServerConfig = {
    transport: {
      type: (process.env.TRANSPORT as 'stdio' | 'http') || 'stdio',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      host: process.env.HOST || '127.0.0.1'
    },
    debug: process.env.DEBUG === 'true' || false,
    readonlyMode: process.env.READONLY_MODE === 'true' || false,
    disabledTools: process.env.DISABLED_TOOLS ? process.env.DISABLED_TOOLS.split(',').map(t => t.trim()) : undefined,
    enabledTools: process.env.ENABLED_TOOLS ? process.env.ENABLED_TOOLS.split(',').map(t => t.trim()) : undefined
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--transport':
        const transport = args[++i];
        if (transport === 'stdio' || transport === 'http') {
          config.transport.type = transport;
        }
        break;
      case '--port':
        config.transport.port = parseInt(args[++i], 10);
        break;
      case '--host':
        config.transport.host = args[++i];
        break;
      case '--debug':
        config.debug = true;
        break;
      case '--readonly':
        config.readonlyMode = true;
        break;
      case '--disable-tools':
        const disabledTools = args[++i];
        config.disabledTools = disabledTools.split(',').map(t => t.trim());
        break;
      case '--enable-tools':
        const enabledTools = args[++i];
        config.enabledTools = enabledTools.split(',').map(t => t.trim());
        break;
      case '--help':
        process.stderr.write(`
Google Calendar MCP Server

Usage: node build/index.js [options]

Options:
  --transport <type>        Transport type: stdio (default) | http
  --port <number>          Port for HTTP transport (default: 3000)
  --host <string>          Host for HTTP transport (default: 127.0.0.1)
  --debug                  Enable debug logging
  --readonly                Enable readonly mode (disables write operations)
  --disable-tools <list>   Comma-separated list of tools to disable (blacklist)
  --enable-tools <list>    Comma-separated list of tools to enable (whitelist)
  --help                   Show this help message

Note: --disable-tools and --enable-tools are mutually exclusive. 
      If --enable-tools is specified, only listed tools will be available.

Environment Variables:
  TRANSPORT               Transport type: stdio | http
  PORT                   Port for HTTP transport
  HOST                   Host for HTTP transport
  DEBUG                  Enable debug logging (true/false)
  READONLY_MODE          Enable readonly mode (true/false)
  DISABLED_TOOLS         Comma-separated list of tools to disable
  ENABLED_TOOLS          Comma-separated list of tools to enable

Examples:
  node build/index.js                              # stdio (local use)
  node build/index.js --transport http --port 3000 # HTTP server
  PORT=3000 TRANSPORT=http node build/index.js     # Using env vars
        `);
        process.exit(0);
    }
  }

  return config;
} 