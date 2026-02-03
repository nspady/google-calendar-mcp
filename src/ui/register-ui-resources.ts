import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DAY_VIEW_RESOURCE_URI = 'ui://calendar/day-view.html';

/**
 * Load the day view HTML file from the build directory.
 * Handles both bundled (build/index.js) and source locations.
 */
async function loadDayViewHtml(): Promise<string> {
  // Possible locations for the UI file:
  // 1. build/ui/day-view/day-view.html (when running bundled build/index.js, __dirname is "build/")
  // 2. src/ui/ relative path (source mode, though typically we run built code)
  const locations = [
    join(__dirname, 'ui', 'day-view', 'day-view.html'),      // build/ui/day-view/day-view.html (bundled)
    join(__dirname, '../build/ui/day-view/day-view.html'),   // From src/ui/ to build/ui/ (source)
  ];

  for (const filePath of locations) {
    try {
      await fs.access(filePath);
      return fs.readFile(filePath, 'utf-8');
    } catch {
      // Try next location
    }
  }

  throw new Error(`Day view UI not found. Tried: ${locations.join(', ')}`);
}

/**
 * Registers MCP Apps UI resources with the server
 */
export async function registerUIResources(server: McpServer): Promise<void> {
  // Register the day view resource using MCP Apps helper
  registerAppResource(
    server,
    DAY_VIEW_RESOURCE_URI,
    DAY_VIEW_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      try {
        const html = await loadDayViewHtml();
        return {
          contents: [{
            uri: DAY_VIEW_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          }],
        };
      } catch (error) {
        // Return placeholder if UI not built
        return {
          contents: [{
            uri: DAY_VIEW_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: '<html><body>Day view UI not available. Run npm run build:ui</body></html>',
          }],
        };
      }
    }
  );
}
