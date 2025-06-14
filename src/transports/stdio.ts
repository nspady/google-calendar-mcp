import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export class StdioTransportHandler {
  private server: McpServer;

  constructor(server: McpServer) {
    this.server = server;
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
} 