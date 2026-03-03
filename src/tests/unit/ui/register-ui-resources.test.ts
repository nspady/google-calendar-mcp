import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { promises as fs } from 'node:fs';

// Mock node:fs before importing the module
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readFile: vi.fn()
  }
}));

// Mock MCP Apps module - use vi.fn() directly in the factory
vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppResource: vi.fn(),
  RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app'
}));

// Now import the module after mocks are set up
import { registerUIResources, DAY_VIEW_RESOURCE_URI } from '../../../ui/register-ui-resources.js';
import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';

describe('register-ui-resources', () => {
  let mockServer: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = { resource: vi.fn() } as any;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('registerUIResources', () => {
    it('should register day view resource with correct URI and MIME type', async () => {
      const mockHtml = '<html><body>Day View</body></html>';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockHtml);

      await registerUIResources(mockServer);

      expect(vi.mocked(registerAppResource)).toHaveBeenCalledWith(
        mockServer,
        DAY_VIEW_RESOURCE_URI,
        DAY_VIEW_RESOURCE_URI,
        { mimeType: 'text/html;profile=mcp-app' },
        expect.any(Function)
      );
    });
  });

  describe('File path resolution', () => {
    it('should try first path and succeed', async () => {
      const mockHtml = '<html><body>Day View</body></html>';

      // First path succeeds
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockHtml);

      await registerUIResources(mockServer);

      // Get the registered callback function
      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(mockHtml);
      expect(fs.access).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should fallback to second path if first fails', async () => {
      const mockHtml = '<html><body>Day View from second path</body></html>';

      // First path fails, second succeeds
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockHtml);

      await registerUIResources(mockServer);

      // Get the registered callback function
      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(mockHtml);
      // Both paths should have been tried
      expect(fs.access).toHaveBeenCalledTimes(2);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should try all paths in order', async () => {
      const mockHtml = '<html><body>Success!</body></html>';

      // All access calls fail except the last
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockHtml);

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(mockHtml);
      expect(fs.access).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should return placeholder HTML when UI not built', async () => {
      // All paths fail
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toContain('not available');
      expect(result.contents[0].text).toContain('npm run build:ui');
      expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    });

    it('should return placeholder when file read fails', async () => {
      // Access succeeds but read fails
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('read error'));

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toContain('not available');
      expect(result.contents[0].text).toContain('npm run build:ui');
    });

    it('should not throw error on file load failure', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];

      // Should not throw
      await expect(registeredCallback()).resolves.toBeDefined();
    });

    it('should include correct URI in placeholder response', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].uri).toBe(DAY_VIEW_RESOURCE_URI);
    });
  });

  describe('Success path', () => {
    it('should load and return HTML content successfully', async () => {
      const mockHtml = `
        <html>
          <head><title>Day View</title></head>
          <body>
            <div id="day-view-container">Calendar content</div>
          </body>
        </html>
      `;

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockHtml);

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(mockHtml);
      expect(result.contents[0].uri).toBe(DAY_VIEW_RESOURCE_URI);
      expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    });

    it('should handle empty HTML file', async () => {
      const emptyHtml = '';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(emptyHtml);

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(emptyHtml);
    });

    it('should handle large HTML files', async () => {
      const largeHtml = '<html>' + 'x'.repeat(100000) + '</html>';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(largeHtml);

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(largeHtml);
      expect(result.contents[0].text.length).toBeGreaterThan(100000);
    });

    it('should preserve HTML special characters', async () => {
      const htmlWithSpecialChars = '<html><body>&lt;div&gt; &amp; &quot;test&quot;</body></html>';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(htmlWithSpecialChars);

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].text).toBe(htmlWithSpecialChars);
    });
  });

  describe('Resource metadata', () => {
    it('should return contents array with single item', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('<html></html>');

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents).toHaveLength(1);
      expect(Array.isArray(result.contents)).toBe(true);
    });

    it('should use correct MIME type for MCP Apps', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('<html></html>');

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    });

    it('should use DAY_VIEW_RESOURCE_URI constant', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('<html></html>');

      await registerUIResources(mockServer);

      const registeredCallback = vi.mocked(registerAppResource).mock.calls[0][4];
      const result = await registeredCallback();

      expect(result.contents[0].uri).toBe('ui://calendar/day-view.html');
      expect(DAY_VIEW_RESOURCE_URI).toBe('ui://calendar/day-view.html');
    });
  });
});
