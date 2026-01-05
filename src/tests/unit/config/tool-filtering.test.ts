import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../../../config/TransportConfig.js';
import { ToolRegistry } from '../../../tools/registry.js';

describe('Tool Filtering', () => {
  describe('parseArgs', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
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
  });

  describe('ToolRegistry.validateToolNames', () => {
    it('should not throw for valid tool names', () => {
      expect(() => {
        ToolRegistry.validateToolNames(['list-events', 'create-event', 'get-current-time']);
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
});
