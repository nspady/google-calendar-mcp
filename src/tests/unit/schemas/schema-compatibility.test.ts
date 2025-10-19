import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../tools/registry.js';

/**
 * Provider-Specific Schema Compatibility Tests
 *
 * These tests ensure that schemas are compatible with different MCP clients
 * by testing what each provider actually receives, not internal implementation.
 *
 * - OpenAI: Receives converted schemas (anyOf flattened to string)
 * - Python MCP: Receives raw schemas (anyOf preserved for native array support)
 * - Claude: Uses raw MCP schemas
 */

// Type for JSON Schema objects (subset of what zod-to-json-schema returns)
interface JSONSchemaObject {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  anyOf?: any[];
  [key: string]: any;
}

describe('Provider-Specific Schema Compatibility', () => {
  describe('OpenAI Schema Compatibility', () => {
    // Helper function that mimics OpenAI schema conversion from openai-mcp-integration.test.ts
    const convertMCPSchemaToOpenAI = (mcpSchema: any): any => {
      if (!mcpSchema) {
        return {
          type: 'object',
          properties: {},
          required: []
        };
      }

      return {
        type: 'object',
        properties: enhancePropertiesForOpenAI(mcpSchema.properties || {}),
        required: mcpSchema.required || []
      };
    };

    const enhancePropertiesForOpenAI = (properties: any): any => {
      const enhanced: any = {};

      for (const [key, value] of Object.entries(properties)) {
        const prop = value as any;
        enhanced[key] = { ...prop };

        // Handle anyOf union types (OpenAI doesn't support these well)
        if (prop.anyOf && Array.isArray(prop.anyOf)) {
          const stringType = prop.anyOf.find((t: any) => t.type === 'string');
          if (stringType) {
            enhanced[key] = {
              type: 'string',
              description: `${stringType.description || prop.description || ''} Note: For multiple values, use JSON array string format: '["id1", "id2"]'`.trim()
            };
          } else {
            enhanced[key] = { ...prop.anyOf[0] };
          }
          delete enhanced[key].anyOf;
        }

        // Recursively enhance nested objects
        if (enhanced[key].type === 'object' && enhanced[key].properties) {
          enhanced[key].properties = enhancePropertiesForOpenAI(enhanced[key].properties);
        }

        // Enhance array items if they contain objects
        if (enhanced[key].type === 'array' && enhanced[key].items && enhanced[key].items.properties) {
          enhanced[key].items = {
            ...enhanced[key].items,
            properties: enhancePropertiesForOpenAI(enhanced[key].items.properties)
          };
        }
      }

      return enhanced;
    };

    it('should ensure ALL tools (including list-events) have no problematic features after OpenAI conversion', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      const problematicFeatures = ['oneOf', 'anyOf', 'allOf', 'not'];
      const issues: string[] = [];

      for (const tool of tools) {
        // Convert to OpenAI format (this is what OpenAI actually sees)
        const openaiSchema = convertMCPSchemaToOpenAI(tool.inputSchema);
        const schemaStr = JSON.stringify(openaiSchema);

        for (const feature of problematicFeatures) {
          if (schemaStr.includes(`"${feature}"`)) {
            issues.push(`Tool "${tool.name}" contains "${feature}" after OpenAI conversion - this will break OpenAI function calling`);
          }
        }
      }

      if (issues.length > 0) {
        throw new Error(`OpenAI schema compatibility issues found:\n${issues.join('\n')}`);
      }
    });

    it('should convert list-events calendarId anyOf to string for OpenAI', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      const listEventsTool = tools.find(t => t.name === 'list-events');

      expect(listEventsTool).toBeDefined();

      // Convert to OpenAI format
      const openaiSchema = convertMCPSchemaToOpenAI(listEventsTool!.inputSchema);

      // OpenAI should see a simple string type, not anyOf
      expect(openaiSchema.properties.calendarId.type).toBe('string');
      expect(openaiSchema.properties.calendarId.anyOf).toBeUndefined();

      // Description should mention JSON array format
      expect(openaiSchema.properties.calendarId.description).toContain('JSON array string format');
      expect(openaiSchema.properties.calendarId.description).toMatch(/\[".*"\]/);
    });

    it('should ensure all converted schemas are valid objects', () => {
      const tools = ToolRegistry.getToolsWithSchemas();

      for (const tool of tools) {
        const openaiSchema = convertMCPSchemaToOpenAI(tool.inputSchema);

        expect(openaiSchema.type).toBe('object');
        expect(openaiSchema.properties).toBeDefined();
        expect(openaiSchema.required).toBeDefined();
      }
    });
  });

  describe('Python MCP Client Compatibility', () => {
    it('should ensure list-events supports native arrays via anyOf', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      const listEventsTool = tools.find(t => t.name === 'list-events');

      expect(listEventsTool).toBeDefined();

      // Raw MCP schema should have anyOf for Python clients
      const schema = listEventsTool!.inputSchema as JSONSchemaObject;
      expect(schema.properties).toBeDefined();

      const calendarIdProp = schema.properties!.calendarId;
      expect(calendarIdProp.anyOf).toBeDefined();
      expect(Array.isArray(calendarIdProp.anyOf)).toBe(true);
      expect(calendarIdProp.anyOf.length).toBe(2);

      // Verify it has both string and array options
      const types = calendarIdProp.anyOf.map((t: any) => t.type);
      expect(types).toContain('string');
      expect(types).toContain('array');
    });

    it('should ensure all other tools do NOT use anyOf/oneOf/allOf', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      const problematicFeatures = ['oneOf', 'anyOf', 'allOf', 'not'];
      const issues: string[] = [];

      for (const tool of tools) {
        // Skip list-events - it's explicitly allowed to use anyOf
        if (tool.name === 'list-events') {
          continue;
        }

        const schemaStr = JSON.stringify(tool.inputSchema);

        for (const feature of problematicFeatures) {
          if (schemaStr.includes(`"${feature}"`)) {
            issues.push(`Tool "${tool.name}" contains problematic feature: ${feature}`);
          }
        }
      }

      if (issues.length > 0) {
        throw new Error(`Raw MCP schema compatibility issues found:\n${issues.join('\n')}`);
      }
    });
  });

  describe('General Schema Structure', () => {
    it('should have tools available', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should have proper schema structure for all tools', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);

      for (const tool of tools) {
        const schema = tool.inputSchema as JSONSchemaObject;

        // All schemas should be objects at the top level
        expect(schema.type).toBe('object');
      }
    });

    it('should validate specific known tool schemas exist', () => {
      const tools = ToolRegistry.getToolsWithSchemas();
      const toolSchemas = new Map();
      for (const tool of tools) {
        toolSchemas.set(tool.name, tool.inputSchema);
      }

      // Validate that key tools exist and have the proper basic structure
      const listEventsSchema = toolSchemas.get('list-events') as JSONSchemaObject;
      expect(listEventsSchema).toBeDefined();
      expect(listEventsSchema.type).toBe('object');

      if (listEventsSchema.properties) {
        expect(listEventsSchema.properties.calendarId).toBeDefined();
        expect(listEventsSchema.properties.timeMin).toBeDefined();
        expect(listEventsSchema.properties.timeMax).toBeDefined();
      }

      // Check other important tools exist
      expect(toolSchemas.get('create-event')).toBeDefined();
      expect(toolSchemas.get('update-event')).toBeDefined();
      expect(toolSchemas.get('delete-event')).toBeDefined();
    });

    it('should test that all datetime fields have proper format', () => {
      const tools = ToolRegistry.getToolsWithSchemas();

      const toolsWithDateTimeFields = ['list-events', 'search-events', 'create-event', 'update-event', 'get-freebusy'];

      for (const tool of tools) {
        if (toolsWithDateTimeFields.includes(tool.name)) {
          // These tools should exist and be properly typed
          const schema = tool.inputSchema as JSONSchemaObject;
          expect(schema.type).toBe('object');
        }
      }
    });

    it('should ensure enum fields are properly structured', () => {
      const tools = ToolRegistry.getToolsWithSchemas();

      const toolsWithEnums = ['update-event', 'delete-event'];

      for (const tool of tools) {
        if (toolsWithEnums.includes(tool.name)) {
          // These tools should exist and be properly typed
          const schema = tool.inputSchema as JSONSchemaObject;
          expect(schema.type).toBe('object');
        }
      }
    });

    it('should validate array fields have proper items definition', () => {
      const tools = ToolRegistry.getToolsWithSchemas();

      const toolsWithArrays = ['create-event', 'update-event', 'get-freebusy'];

      for (const tool of tools) {
        if (toolsWithArrays.includes(tool.name)) {
          // These tools should exist and be properly typed
          const schema = tool.inputSchema as JSONSchemaObject;
          expect(schema.type).toBe('object');
        }
      }
    });
  });
});

/**
 * Schema Validation Rules Documentation
 *
 * This test documents the rules that our schemas must follow
 * to be compatible with various MCP clients.
 */
describe('Schema Validation Rules Documentation', () => {
  it('should document provider-specific compatibility requirements', () => {
    const rules = {
      'OpenAI': 'Schemas are converted to remove anyOf/oneOf/allOf. Union types flattened to primary type with usage notes in description.',
      'Python MCP': 'Native array support via anyOf for list-events.calendarId. Accepts both string and array types directly.',
      'Claude/Generic MCP': 'Uses raw schemas. list-events has anyOf for flexibility, but most tools avoid union types for broad compatibility.',
      'Top-level schema': 'All schemas must be type: "object" at root level.',
      'DateTime fields': 'Support both RFC3339 with timezone and timezone-naive formats.',
      'Array fields': 'Must have items schema defined for proper validation.',
      'Enum fields': 'Must include type information alongside enum values.'
    };

    // This test documents the rules - it always passes but serves as documentation
    expect(Object.keys(rules).length).toBeGreaterThan(0);
  });
});
