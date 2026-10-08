import { describe, it, expect } from 'vitest';
import {
  buildEventFieldMask,
  buildSingleEventFieldMask,
  buildListFieldMask,
  validateFields,
  ALLOWED_EVENT_FIELDS,
  DEFAULT_EVENT_FIELDS
} from '../../../utils/field-mask-builder.js';

describe('Field Mask Builder', () => {
  describe('validateFields', () => {
    it('should accept valid fields', () => {
      const validFields = ['description', 'colorId', 'transparency'];
      const result = validateFields(validFields);
      expect(result).toEqual(validFields);
    });

    it('should reject invalid fields', () => {
      const invalidFields = ['invalid', 'notafield'];
      expect(() => validateFields(invalidFields)).toThrow('Invalid fields requested: invalid, notafield');
    });

    it('should handle mixed valid and invalid fields', () => {
      const mixedFields = ['description', 'invalid', 'colorId'];
      expect(() => validateFields(mixedFields)).toThrow('Invalid fields requested: invalid');
    });

    it('should accept all allowed fields', () => {
      const result = validateFields([...ALLOWED_EVENT_FIELDS]);
      expect(result).toEqual(ALLOWED_EVENT_FIELDS);
    });
  });

  describe('buildEventFieldMask', () => {
    it('should return undefined when no fields requested', () => {
      expect(buildEventFieldMask()).toBeUndefined();
      expect(buildEventFieldMask([])).toBeUndefined();
    });

    it('should build field mask with requested fields and defaults', () => {
      const fields = ['description', 'colorId'];
      const result = buildEventFieldMask(fields);
      expect(result).toContain('items(');
      expect(result).toContain('description');
      expect(result).toContain('colorId');
      // Should also include defaults
      DEFAULT_EVENT_FIELDS.forEach(field => {
        expect(result).toContain(field);
      });
    });

    it('should build field mask without defaults when specified', () => {
      const fields = ['description', 'colorId'];
      const result = buildEventFieldMask(fields, false);
      expect(result).toBe('items(description,colorId)');
    });

    it('should handle duplicate fields', () => {
      const fields = ['description', 'description', 'id', 'summary'];
      const result = buildEventFieldMask(fields);
      // Should deduplicate
      const fieldCount = (result?.match(/description/g) || []).length;
      expect(fieldCount).toBe(1);
    });

    it('should throw for invalid fields', () => {
      const fields = ['description', 'invalidfield'];
      expect(() => buildEventFieldMask(fields)).toThrow('Invalid fields requested: invalidfield');
    });
  });

  describe('buildSingleEventFieldMask', () => {
    it('should return undefined when no fields requested', () => {
      expect(buildSingleEventFieldMask()).toBeUndefined();
      expect(buildSingleEventFieldMask([])).toBeUndefined();
    });

    it('should build comma-separated field list with defaults', () => {
      const fields = ['description', 'colorId'];
      const result = buildSingleEventFieldMask(fields);
      expect(result).not.toContain('items(');
      expect(result).toContain('description');
      expect(result).toContain('colorId');
      // Should also include defaults
      DEFAULT_EVENT_FIELDS.forEach(field => {
        expect(result).toContain(field);
      });
    });

    it('should build field list without defaults when specified', () => {
      const fields = ['description', 'colorId'];
      const result = buildSingleEventFieldMask(fields, false);
      expect(result).toBe('description,colorId');
    });
  });

  describe('buildListFieldMask', () => {
    it('should return undefined when no fields requested', () => {
      expect(buildListFieldMask()).toBeUndefined();
      expect(buildListFieldMask([])).toBeUndefined();
    });

    it('should include list metadata fields', () => {
      const fields = ['description'];
      const result = buildListFieldMask(fields);
      expect(result).toContain('nextPageToken');
      expect(result).toContain('nextSyncToken');
      expect(result).toContain('kind');
      expect(result).toContain('etag');
      expect(result).toContain('timeZone');
      expect(result).toContain('accessRole');
    });

    it('should include event fields in items()', () => {
      const fields = ['description', 'colorId'];
      const result = buildListFieldMask(fields);
      expect(result).toContain('items(');
      expect(result).toContain('description');
      expect(result).toContain('colorId');
    });
  });


  describe('event labels', () => {
    it('should allow eventLabelId as a requested field', () => {
      expect(validateFields(['eventLabelId'])).toEqual(['eventLabelId']);
      expect(buildSingleEventFieldMask(['eventLabelId'])).toContain('eventLabelId');
    });
  });
});
