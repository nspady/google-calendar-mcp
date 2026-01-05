import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../../../config/TransportConfig.js';
import { ToolRegistry } from '../../../tools/registry.js';
import { GoogleCalendarMcpServer } from '../../../server.js';

// Mock dependencies for server tests
vi.mock('../../../auth/client.js', () => ({
  initializeOAuth2Client: vi.fn().mockResolvedValue({})
}));
vi.mock('../../../auth/server.js', () => ({
  AuthServer: vi.fn().mockImplementation(() => ({}))
}));
vi.mock('../../../auth/tokenManager.js', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    loadAllAccounts: vi.fn().mockResolvedValue(new Map()),
    validateTokens: vi.fn().mockResolvedValue(true),
    getAccountMode: vi.fn().mockReturnValue('default')
  }))
}));

describe('Tool Filtering', () => {
  describe('parseArgs', () => {
    const originalEnv = process.env;
    const originalExit = process.exit;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
      process.exit = originalExit;
    });

    it('should parse --enable-tools from CLI arguments', () => {
      const config = parseArgs(['--enable-tools', 'list-events,create-event']);
      expect(config.enabledTools).toEqual(['list-events', 'create-event']);
    });

    it('should parse ENABLED_TOOLS from environment variable', () => {
      process.env.ENABLED_TOOLS = 'list-events,get-event,get-current-time';
      const config = parseArgs([]);
      expect(config.enabledTools).toEqual(['list-events', 'get-event', 'get-current-time']);
    });

    it('should trim whitespace from tool names', () => {
      const config = parseArgs(['--enable-tools', ' list-events , create-event ']);
      expect(config.enabledTools).toEqual(['list-events', 'create-event']);
    });

    it('should filter out empty strings', () => {
      const config = parseArgs(['--enable-tools', 'list-events,,create-event,']);
      expect(config.enabledTools).toEqual(['list-events', 'create-event']);
    });

    it('should return undefined when no tool filtering specified', () => {
      const config = parseArgs([]);
      expect(config.enabledTools).toBeUndefined();
    });

    it('should prefer CLI args over environment variables', () => {
      process.env.ENABLED_TOOLS = 'get-event';
      const config = parseArgs(['--enable-tools', 'list-events']);
      expect(config.enabledTools).toEqual(['list-events']);
    });

    it('should error when --enable-tools parses to an empty list', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);

      expect(() => parseArgs(['--enable-tools', ', ,'])).toThrow(/process\.exit:1/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should error when ENABLED_TOOLS parses to an empty list', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);

      process.env.ENABLED_TOOLS = ',,';
      expect(() => parseArgs([])).toThrow(/process\.exit:1/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('ToolRegistry.validateToolNames', () => {
    it('should not throw for valid tool names', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['list-events', 'create-event', 'get-current-time']);
      }).not.toThrow();
    });

    it('should allow manage-accounts in the allowlist', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['manage-accounts', 'list-events']);
      }).not.toThrow();
    });

    it('should throw for invalid tool names', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['list-events', 'invalid-tool']);
      }).toThrow(/Invalid tool name\(s\): invalid-tool/);
    });

    it('should include available tools in error message', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['nonexistent-tool']);
      }).toThrow(/Available tools:/);
    });

    it('should list multiple invalid tools', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['foo', 'bar', 'list-events']);
      }).toThrow(/Invalid tool name\(s\): foo, bar/);
    });
  });

  describe('ToolRegistry.getAvailableToolNames', () => {
    it('should return all tool names', () => {
      const toolNames = ToolRegistry.getAvailableToolNames();

      // Check that we get expected tools
      expect(toolNames).toContain('list-events');
      expect(toolNames).toContain('create-event');
      expect(toolNames).toContain('update-event');
      expect(toolNames).toContain('delete-event');
      expect(toolNames).toContain('get-event');
      expect(toolNames).toContain('search-events');
      expect(toolNames).toContain('list-calendars');
      expect(toolNames).toContain('get-current-time');
      expect(toolNames).toContain('get-freebusy');
      expect(toolNames).toContain('list-colors');
      expect(toolNames).toContain('respond-to-event');
      expect(toolNames).toContain('set-out-of-office');
      expect(toolNames).toContain('set-working-location');
    });

    it('should return an array', () => {
      const toolNames = ToolRegistry.getAvailableToolNames();
      expect(Array.isArray(toolNames)).toBe(true);
    });
  });

  describe('Server Instructions', () => {
    it('should generate instructions listing disabled tools when filtering is active', () => {
      const config = {
        transport: { type: 'stdio' as const },
        enabledTools: ['list-events', 'get-current-time']
      };

      // Access private method via any cast for testing
      const server = new GoogleCalendarMcpServer(config);
      const instructions = (server as any).generateInstructions();

      expect(instructions).toContain('Tool filtering is active');
      expect(instructions).toContain('create-event');
      expect(instructions).toContain('delete-event');
      expect(instructions).not.toContain('list-events');
      expect(instructions).not.toContain('get-current-time');
    });

    it('should return undefined when no filtering is active', () => {
      const config = {
        transport: { type: 'stdio' as const }
      };

      const server = new GoogleCalendarMcpServer(config);
      const instructions = (server as any).generateInstructions();

      expect(instructions).toBeUndefined();
    });

    it('should return undefined when all tools are enabled', () => {
      const allTools = ToolRegistry.getAvailableToolNames();
      const config = {
        transport: { type: 'stdio' as const },
        enabledTools: allTools
      };

      const server = new GoogleCalendarMcpServer(config);
      const instructions = (server as any).generateInstructions();

      expect(instructions).toBeUndefined();
    });
  });
});
