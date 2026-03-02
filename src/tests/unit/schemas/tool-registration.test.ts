import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry, ToolSchemas } from '../../../tools/registry.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Tool Registration Tests
 * 
 * These tests validate that all tools are properly registered with the MCP server
 * and that their schemas are correctly extracted, especially for complex schemas
 * that use .refine() methods (like update-event).
 */

describe('Tool Registration', () => {
  let mockServer: McpServer;
  let registeredTools: Array<{
    name: string;
    title: string;
    description: string;
    annotations: Record<string, unknown>;
    inputSchema: any;
  }>;

  beforeEach(() => {
    mockServer = new McpServer({ name: 'test', version: '1.0.0' });
    registeredTools = [];
    
    // Mock the registerTool method to capture registered tools
    mockServer.registerTool = vi.fn((name: string, definition: any, _handler: any) => {
      registeredTools.push({
        name,
        title: definition.title,
        description: definition.description,
        annotations: definition.annotations,
        inputSchema: definition.inputSchema
      });
      // Return a mock RegisteredTool
      return { name, description: definition.description } as any;
    });
  });

  it('should register all tools successfully without errors', async () => {
    // This should not throw any errors
    await expect(
      ToolRegistry.registerAll(mockServer, async () => ({ content: [] }))
    ).resolves.not.toThrow();
  });

  it('should register the correct number of tools', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    const expectedToolCount = Object.keys(ToolSchemas).length;
    expect(registeredTools).toHaveLength(expectedToolCount);
  });

  it('should register all expected tool names', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    const expectedTools = Object.keys(ToolSchemas);
    const registeredToolNames = registeredTools.map(t => t.name);
    
    for (const expectedTool of expectedTools) {
      expect(registeredToolNames).toContain(expectedTool);
    }
  });

  it('should register titles and annotations for all tools', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));

    const expectedTitles: Record<string, string> = {
      'list-calendars': 'List Calendars',
      'list-events': 'List Calendar Events',
      'search-events': 'Search Calendar Events',
      'get-event': 'Get Event Details',
      'list-colors': 'List Calendar Colors',
      'create-event': 'Create Calendar Event',
      'create-events': 'Create Calendar Events (Bulk)',
      'update-event': 'Update Calendar Event',
      'delete-event': 'Delete Calendar Event',
      'get-freebusy': 'Get Free/Busy',
      'get-current-time': 'Get Current Time',
      'respond-to-event': 'Respond to Event Invitation'
    };

    const expectedAnnotations: Record<string, Record<string, boolean>> = {
      'list-calendars': { readOnlyHint: true, openWorldHint: false },
      'list-events': { readOnlyHint: true, openWorldHint: false },
      'search-events': { readOnlyHint: true, openWorldHint: false },
      'get-event': { readOnlyHint: true, openWorldHint: false },
      'list-colors': { readOnlyHint: true, openWorldHint: false },
      'get-freebusy': { readOnlyHint: true, openWorldHint: false },
      'get-current-time': { readOnlyHint: true, openWorldHint: false },
      'create-event': {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      'create-events': {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      'update-event': {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      'delete-event': {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      'respond-to-event': {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    };

    for (const tool of registeredTools) {
      expect(tool.title).toBe(expectedTitles[tool.name]);
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.annotations).toEqual(expectedAnnotations[tool.name]);
      expect(tool.annotations.openWorldHint).toBe(false);
    }
  });

  it('should have valid input schemas for all tools', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    for (const tool of registeredTools) {
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe('object');
      
      // The inputSchema should be either a Zod shape object or have been converted properly
      // For tools with complex schemas, we should still get a valid object
      if (tool.name === 'update-event') {
        // This is the key test - update-event should not have an empty schema
        expect(Object.keys(tool.inputSchema).length).toBeGreaterThan(0);
      }
    }
  });

  it('should properly extract schema for update-event tool with .refine() methods', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    const updateEventTool = registeredTools.find(t => t.name === 'update-event');
    expect(updateEventTool).toBeDefined();
    
    const schema = updateEventTool!.inputSchema;
    expect(schema).toBeDefined();
    
    // The key test: schema should not be empty for update-event
    expect(Object.keys(schema).length).toBeGreaterThan(0);
    
    // Check for key update-event specific properties in the Zod shape
    expect(schema).toHaveProperty('calendarId');
    expect(schema).toHaveProperty('eventId');
    expect(schema).toHaveProperty('modificationScope');
    expect(schema).toHaveProperty('originalStartTime');
    expect(schema).toHaveProperty('futureStartDate');
  });

  it('should compare update-event with create-event to ensure both have proper schemas', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    const createEventTool = registeredTools.find(t => t.name === 'create-event');
    const updateEventTool = registeredTools.find(t => t.name === 'update-event');
    
    expect(createEventTool).toBeDefined();
    expect(updateEventTool).toBeDefined();
    
    // Both should have similar basic structure
    const createSchema = createEventTool!.inputSchema;
    const updateSchema = updateEventTool!.inputSchema;
    
    // Both should have non-empty schemas
    expect(Object.keys(createSchema).length).toBeGreaterThan(0);
    expect(Object.keys(updateSchema).length).toBeGreaterThan(0);
    
    // Both should have calendarId in their Zod shapes
    expect(createSchema).toHaveProperty('calendarId');
    expect(updateSchema).toHaveProperty('calendarId');
    
    // Update should have additional properties that create doesn't need
    expect(updateSchema).toHaveProperty('eventId');
    expect(updateSchema).toHaveProperty('modificationScope');
    
    // Create should have required properties that update makes optional
    expect(createSchema).toHaveProperty('summary');
    expect(createSchema).toHaveProperty('start');
    expect(createSchema).toHaveProperty('end');
  });

  it('should handle all complex schemas with refinements properly', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    // Tools that use .refine() methods
    const toolsWithRefinements = ['update-event'];
    
    for (const toolName of toolsWithRefinements) {
      const tool = registeredTools.find(t => t.name === toolName);
      expect(tool).toBeDefined();
      
      const schema = tool!.inputSchema;
      expect(schema).toBeDefined();
      
      // Should not be empty - this was the original bug
      expect(Object.keys(schema).length).toBeGreaterThan(0);
    }
  });

  it('should validate that tools can be retrieved via getToolsWithSchemas()', () => {
    const tools = ToolRegistry.getToolsWithSchemas();
    
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    
    // Check that update-event is present and has a valid schema
    const updateEventTool = tools.find(t => t.name === 'update-event');
    expect(updateEventTool).toBeDefined();
    expect(updateEventTool!.inputSchema).toBeDefined();
    
    // The inputSchema should be a valid JSON Schema object
    expect(typeof updateEventTool!.inputSchema).toBe('object');
    expect((updateEventTool!.inputSchema as any).type).toBe('object');
  });

  it('should ensure all datetime fields have proper validation', async () => {
    await ToolRegistry.registerAll(mockServer, async () => ({ content: [] }));
    
    const toolsWithDatetime = ['create-event', 'update-event', 'list-events', 'search-events'];
    
    for (const toolName of toolsWithDatetime) {
      const tool = registeredTools.find(t => t.name === toolName);
      expect(tool).toBeDefined();
      
      const schema = tool!.inputSchema;
      expect(Object.keys(schema).length).toBeGreaterThan(0);
      
      // Just verify the schema exists and is not empty for datetime tools
      // The actual field validation is tested elsewhere
      if (toolName === 'update-event') {
        expect(schema).toHaveProperty('start');
        expect(schema).toHaveProperty('end');
      }
    }
  });

  it('should catch schema extraction issues early', async () => {
    // Test the schema extraction method directly
    const updateEventSchema = ToolSchemas['update-event'];
    expect(updateEventSchema).toBeDefined();
    
    // This should not throw an error
    const extractedShape = (ToolRegistry as any).extractSchemaShape(updateEventSchema);
    expect(extractedShape).toBeDefined();
    expect(typeof extractedShape).toBe('object');
    
    // Should have the expected properties
    expect(extractedShape).toHaveProperty('calendarId');
    expect(extractedShape).toHaveProperty('eventId');
    expect(extractedShape).toHaveProperty('modificationScope');
  });
});

/**
 * Schema Extraction Edge Cases
 * 
 * Tests to ensure the extractSchemaShape method handles various Zod schema types
 */
describe('Schema Extraction Edge Cases', () => {
  it('should handle regular ZodObject schemas', () => {
    const simpleSchema = ToolSchemas['list-calendars'];
    const extractedShape = (ToolRegistry as any).extractSchemaShape(simpleSchema);
    expect(extractedShape).toBeDefined();
  });

  it('should handle ZodEffects (refined) schemas', () => {
    const refinedSchema = ToolSchemas['update-event'];
    const extractedShape = (ToolRegistry as any).extractSchemaShape(refinedSchema);
    expect(extractedShape).toBeDefined();
    expect(typeof extractedShape).toBe('object');
  });

  it('should handle nested schema structures', () => {
    const complexSchema = ToolSchemas['create-event'];
    const extractedShape = (ToolRegistry as any).extractSchemaShape(complexSchema);
    expect(extractedShape).toBeDefined();
    expect(typeof extractedShape).toBe('object');
  });
});
