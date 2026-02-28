import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface IntegrationClientOptions {
  name: string;
  version?: string;
  excludeGoogleAccountMode?: boolean;
  envOverrides?: Record<string, string>;
}

function buildTestEnv(options: IntegrationClientOptions): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined)
  ) as Record<string, string>;

  env.NODE_ENV = 'test';

  if (options.excludeGoogleAccountMode) {
    delete env.GOOGLE_ACCOUNT_MODE;
  }

  if (options.envOverrides) {
    Object.assign(env, options.envOverrides);
  }

  return env;
}

export async function createIntegrationClient(options: IntegrationClientOptions): Promise<Client> {
  const env = buildTestEnv(options);
  const client = new Client({
    name: options.name,
    version: options.version ?? "1.0.0"
  }, {
    capabilities: {
      tools: {}
    }
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['build/index.js'],
    env
  });

  await client.connect(transport);
  return client;
}
