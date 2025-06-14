export interface TransportConfig {
  type: 'stdio' | 'http';
  port?: number;
  host?: string;
}

export interface ServerConfig {
  transport: TransportConfig;
  debug?: boolean;
}

export function parseArgs(args: string[]): ServerConfig {
  // Start with environment variables as base config
  const config: ServerConfig = {
    transport: {
      type: (process.env.TRANSPORT as 'stdio' | 'http') || 'stdio',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      host: process.env.HOST || '127.0.0.1'
    },
    debug: process.env.DEBUG === 'true' || false
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
      case '--help':
        process.stderr.write(`
Google Calendar MCP Server

Usage: node build/index.js [options]

Options:
  --transport <type>        Transport type: stdio (default) | http
  --port <number>          Port for HTTP transport (default: 3000)
  --host <string>          Host for HTTP transport (default: 127.0.0.1)
  --debug                  Enable debug logging
  --help                   Show this help message

Environment Variables:
  TRANSPORT               Transport type: stdio | http
  PORT                   Port for HTTP transport
  HOST                   Host for HTTP transport
  DEBUG                  Enable debug logging (true/false)

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