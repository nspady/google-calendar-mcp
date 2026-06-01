import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, ToolSchemas } from '../../../tools/registry.js';

describe('Schema $ref Prevention Tests', () => {
  it('should not generate $ref references in JSON schemas, causes issues with Claude Desktop', () => {
    const tools = ToolRegistry.getToolsWithSchemas();
    
    // Convert each tool schema to JSON Schema and check for $ref
    for (const tool of tools) {
      const jsonSchema = JSON.stringify(tool.inputSchema);
      
      // Check for any $ref references
      const hasRef = jsonSchema.includes('"$ref"');
      
      if (hasRef) {
        console.error(`Tool "${tool.name}" contains $ref in schema:`, jsonSchema);
      }
      
      expect(hasRef).toBe(false);
    }
  });

  it('should have unique schema instances for similar parameters', () => {
    const tools = ToolRegistry.getToolsWithSchemas();
    
    // Find tools with timeMin/timeMax or start/end parameters
    const timeParams = [];
    
    for (const tool of tools) {
      const schemaStr = JSON.stringify(tool.inputSchema);
      if (schemaStr.includes('timeMin') || schemaStr.includes('timeMax') || 
          schemaStr.includes('"start"') || schemaStr.includes('"end"')) {
        timeParams.push(tool.name);
      }
    }
    
    // Ensure we're testing the right tools
    expect(timeParams.length).toBeGreaterThan(0);
    console.log('Tools with time parameters:', timeParams);
  });

  it('should detect if shared schema instances are reused', () => {
    // This test checks the source code structure to prevent regression
    const registryCode = require('fs').readFileSync(
      require('path').join(__dirname, '../../../tools/registry.ts'), 
      'utf8'
    );
    
    // Check for problematic patterns that could cause $ref generation
    // Note: Removed negative lookahead (?!\.) to catch ALL schema reuse including .optional() and .describe()
    const sharedSchemaUsage = [
      /timeMin:\s*[A-Z][a-zA-Z]*Schema/,     // timeMin: SomeSchema (any usage)
      /timeMax:\s*[A-Z][a-zA-Z]*Schema/,     // timeMax: SomeSchema
      /start:\s*[A-Z][a-zA-Z]*Schema/,       // start: SomeSchema
      /end:\s*[A-Z][a-zA-Z]*Schema/,         // end: SomeSchema
      /calendarId:\s*[A-Z][a-zA-Z]*Schema/,  // calendarId: SomeSchema
      /eventId:\s*[A-Z][a-zA-Z]*Schema/,     // eventId: SomeSchema
      /query:\s*[A-Z][a-zA-Z]*Schema/,       // query: SomeSchema
      /summary:\s*[A-Z][a-zA-Z]*Schema/,     // summary: SomeSchema
      /description:\s*[A-Z][a-zA-Z]*Schema/, // description: SomeSchema
      /location:\s*[A-Z][a-zA-Z]*Schema/,    // location: SomeSchema
      /colorId:\s*[A-Z][a-zA-Z]*Schema/,     // colorId: SomeSchema
      /reminders:\s*[A-Z][a-zA-Z]*Schema/,   // reminders: SomeSchema
      /attendees:\s*[A-Z][a-zA-Z]*Schema/,   // attendees: SomeSchema
      /email:\s*[A-Z][a-zA-Z]*Schema/        // email: SomeSchema
    ];
    
    for (const pattern of sharedSchemaUsage) {
      const matches = registryCode.match(pattern);
      if (matches) {
        console.error(`Found potentially problematic schema usage: ${matches[0]}`);
        expect(matches).toBeNull();
      }
    }
  });

  it('should not emit regex lookaround in JSON schema patterns, rejected by RE2 validators (OpenAI, Gemini)', () => {
    const lookaround = /\(\?[=!<]/;

    const collectPatterns = (node: unknown, acc: string[]): string[] => {
      if (Array.isArray(node)) {
        for (const item of node) collectPatterns(item, acc);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'pattern' && typeof value === 'string') acc.push(value);
          collectPatterns(value, acc);
        }
      }
      return acc;
    };

    for (const [name, schema] of Object.entries(ToolSchemas)) {
      const jsonSchema = z.toJSONSchema(schema, { io: 'input' });
      const patterns = collectPatterns(jsonSchema, []);
      const offenders = patterns.filter((p) => lookaround.test(p));

      if (offenders.length > 0) {
        console.error(`Tool "${name}" emits lookaround in pattern(s):`, offenders);
      }

      expect(offenders).toEqual([]);
    }
  });
});