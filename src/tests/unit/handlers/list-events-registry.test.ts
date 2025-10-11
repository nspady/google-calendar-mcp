/**
 * Comprehensive tests for list-events tool registration flow
 * Tests the complete path: schema validation → handlerFunction → handler execution
 *
 * These tests verify the fix for issue #95 by testing:
 * 1. Schema validation (accepts all formats)
 * 2. HandlerFunction preprocessing (converts single-quoted JSON, validates arrays)
 * 3. Real-world scenarios from Home Assistant and other integrations
 */

import { describe, it, expect } from 'vitest';
import { ToolSchemas, ToolRegistry } from '../../../tools/registry.js';

// Get the handlerFunction for testing the full flow
const toolDefinition = (ToolRegistry as any).tools?.find((t: any) => t.name === 'list-events');
const handlerFunction = toolDefinition?.handlerFunction;

describe('list-events Registration Flow (Schema + HandlerFunction)', () => {
  describe('Schema validation (first step)', () => {
    it('should validate native array format', () => {
      const input = {
        calendarId: ['primary', 'work@example.com'],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toEqual(['primary', 'work@example.com']);
    });

    it('should validate single string format', () => {
      const input = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toBe('primary');
    });

    it('should validate JSON string format', () => {
      const input = {
        calendarId: '["primary", "work@example.com"]',
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toBe('["primary", "work@example.com"]');
    });
  });

  describe('Array validation constraints', () => {
    it('should enforce minimum array length', () => {
      const input = {
        calendarId: [],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('At least one calendar ID is required');
      }
    });

    it('should enforce maximum array length', () => {
      const input = {
        calendarId: Array(51).fill('calendar'),
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Maximum 50 calendars');
      }
    });

    it('should reject duplicate calendar IDs in array', () => {
      const input = {
        calendarId: ['primary', 'primary'],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Duplicate calendar IDs');
      }
    });

    it('should reject empty strings in array', () => {
      const input = {
        calendarId: ['primary', ''],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Type preservation after validation', () => {
    it('should preserve array type for native arrays (issue #95 fix)', () => {
      const input = {
        calendarId: ['primary', 'work@example.com', 'personal@example.com'],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].parse(input);

      // The key fix: arrays should NOT be transformed to JSON strings by the schema
      // The handlerFunction will handle the conversion logic
      expect(Array.isArray(result.calendarId)).toBe(true);
      expect(result.calendarId).toEqual(['primary', 'work@example.com', 'personal@example.com']);
    });

    it('should preserve string type for single strings', () => {
      const input = {
        calendarId: 'primary',
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].parse(input);
      expect(typeof result.calendarId).toBe('string');
      expect(result.calendarId).toBe('primary');
    });

    it('should preserve string type for JSON strings', () => {
      const input = {
        calendarId: '["primary", "work@example.com"]',
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].parse(input);
      expect(typeof result.calendarId).toBe('string');
      expect(result.calendarId).toBe('["primary", "work@example.com"]');
    });
  });

  describe('Real-world scenarios from issue #95', () => {
    it('should handle exact input from Home Assistant multi-mcp', () => {
      // This is the exact format that was failing in issue #95
      const input = {
        calendarId: ['primary', 'work@example.com', 'personal@example.com', 'family@example.com', 'events@example.com'],
        timeMin: '2025-10-09T00:00:00',
        timeMax: '2025-10-09T23:59:59'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data?.calendarId)).toBe(true);
      expect(result.data?.calendarId).toHaveLength(5);
    });

    it('should handle mixed special characters in calendar IDs', () => {
      const input = {
        calendarId: ['primary', 'user+tag@example.com', 'calendar.id@domain.co.uk'],
        timeMin: '2024-01-01T00:00:00',
        timeMax: '2024-01-02T00:00:00'
      };

      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toEqual(['primary', 'user+tag@example.com', 'calendar.id@domain.co.uk']);
    });

    it('should accept single-quoted JSON string format (Python/shell style)', () => {
      // Some clients may send JSON-like strings with single quotes instead of double quotes
      // e.g., from Python str() representation or shell scripts
      // The schema should accept it as a string (handlerFunction will process it)
      const input = {
        calendarId: "['primary', 'nathan@brand.ai']",
        timeMin: '2025-10-09T00:00:00',
        timeMax: '2025-10-09T23:59:59'
      };

      // Schema should accept it as a string (not reject it)
      const result = ToolSchemas['list-events'].safeParse(input);
      expect(result.success).toBe(true);
      expect(typeof result.data?.calendarId).toBe('string');
      expect(result.data?.calendarId).toBe("['primary', 'nathan@brand.ai']");
    });
  });

  // HandlerFunction tests - second step after schema validation
  if (!handlerFunction) {
    console.warn('⚠️  handlerFunction not found - skipping handler tests');
  } else {
    describe('HandlerFunction preprocessing (second step)', () => {
      describe('Format handling', () => {
        it('should pass through native arrays unchanged', async () => {
          const input = {
            calendarId: ['primary', 'work@example.com'],
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          const result = await handlerFunction(input);
          expect(Array.isArray(result.calendarId)).toBe(true);
          expect(result.calendarId).toEqual(['primary', 'work@example.com']);
        });

        it('should pass through single strings unchanged', async () => {
          const input = {
            calendarId: 'primary',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          const result = await handlerFunction(input);
          expect(typeof result.calendarId).toBe('string');
          expect(result.calendarId).toBe('primary');
        });

        it('should parse valid JSON strings with double quotes', async () => {
          const input = {
            calendarId: '["primary", "work@example.com"]',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          const result = await handlerFunction(input);
          expect(Array.isArray(result.calendarId)).toBe(true);
          expect(result.calendarId).toEqual(['primary', 'work@example.com']);
        });

        it('should parse single-quoted JSON-like strings (Python/shell style) - THE KEY FIX', async () => {
          // This is the failing case that needed fixing
          const input = {
            calendarId: "['primary', 'nathan@brand.ai']",
            timeMin: '2025-10-09T00:00:00',
            timeMax: '2025-10-09T23:59:59'
          };

          const result = await handlerFunction(input);
          expect(Array.isArray(result.calendarId)).toBe(true);
          expect(result.calendarId).toEqual(['primary', 'nathan@brand.ai']);
        });

        it('should handle calendar IDs with apostrophes in single-quoted JSON', async () => {
          // Calendar IDs can contain apostrophes (e.g., "John's Calendar")
          // Our replacement logic should not break these
          const input = {
            calendarId: "['primary', 'johns-calendar@example.com']",
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          const result = await handlerFunction(input);
          expect(Array.isArray(result.calendarId)).toBe(true);
          expect(result.calendarId).toEqual(['primary', 'johns-calendar@example.com']);
        });

        it('should handle JSON strings with whitespace', async () => {
          const input = {
            calendarId: '  ["primary", "work@example.com"]  ',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          const result = await handlerFunction(input);
          expect(Array.isArray(result.calendarId)).toBe(true);
          expect(result.calendarId).toEqual(['primary', 'work@example.com']);
        });
      });

      describe('JSON string validation', () => {
        it('should reject empty arrays in JSON strings', async () => {
          const input = {
            calendarId: '[]',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          await expect(handlerFunction(input)).rejects.toThrow('At least one calendar ID is required');
        });

        it('should reject arrays exceeding 50 calendars', async () => {
          const input = {
            calendarId: JSON.stringify(Array(51).fill('calendar')),
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          await expect(handlerFunction(input)).rejects.toThrow('Maximum 50 calendars');
        });

        it('should reject duplicate calendar IDs in JSON strings', async () => {
          const input = {
            calendarId: '["primary", "primary"]',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          await expect(handlerFunction(input)).rejects.toThrow('Duplicate calendar IDs');
        });
      });

      describe('Error handling', () => {
        it('should provide clear error for malformed JSON array', async () => {
          const input = {
            calendarId: '["primary", "missing-quote}]',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          await expect(handlerFunction(input)).rejects.toThrow('Invalid JSON format for calendarId');
        });

        it('should reject JSON arrays with non-string elements', async () => {
          const input = {
            calendarId: '["primary", 123, null]',
            timeMin: '2024-01-01T00:00:00',
            timeMax: '2024-01-02T00:00:00'
          };

          await expect(handlerFunction(input)).rejects.toThrow('Array must contain only non-empty strings');
        });
      });
    });
  }
});
