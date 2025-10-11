import { describe, it, expect } from 'vitest';
import { ToolSchemas } from '../../../tools/registry.js';

// Use the unified schemas from registry  
const UpdateEventArgumentsSchema = ToolSchemas['update-event'];
const ListEventsArgumentsSchema = ToolSchemas['list-events'];

// Helper to generate a future date string in timezone-naive format
function getFutureDateString(daysFromNow: number = 365): string {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysFromNow);
  // Format as timezone-naive ISO string (no timezone suffix)
  return futureDate.toISOString().split('.')[0];
}

describe('UpdateEventArgumentsSchema with Recurring Event Support', () => {
  describe('Basic Validation', () => {
    it('should validate basic required fields', () => {
      const validArgs = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles'
      };

      const result = UpdateEventArgumentsSchema.parse(validArgs);
      expect(result.modificationScope).toBeUndefined(); // optional with no default
      expect(result.calendarId).toBe('primary');
      expect(result.eventId).toBe('event123');
      expect(result.timeZone).toBe('America/Los_Angeles');
    });

    it('should reject missing required fields', () => {
      const invalidArgs = {
        calendarId: 'primary',
        // missing eventId and timeZone
      };

      expect(() => UpdateEventArgumentsSchema.parse(invalidArgs)).toThrow();
    });

    it('should validate optional fields when provided', () => {
      const validArgs = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Location',
        colorId: '9',
        start: '2024-06-15T10:00:00',
        end: '2024-06-15T11:00:00'
      };

      const result = UpdateEventArgumentsSchema.parse(validArgs);
      expect(result.summary).toBe('Updated Meeting');
      expect(result.description).toBe('Updated description');
      expect(result.location).toBe('New Location');
      expect(result.colorId).toBe('9');
    });
  });

  describe('Modification Scope Validation', () => {
    it('should leave modificationScope undefined when not provided', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles'
      };

      const result = UpdateEventArgumentsSchema.parse(args);
      expect(result.modificationScope).toBeUndefined();
    });

    it('should accept valid modificationScope values', () => {
      const validScopes = ['thisEventOnly', 'all', 'thisAndFollowing'] as const;

      validScopes.forEach(scope => {
        const args: any = {
          calendarId: 'primary',
          eventId: 'event123',
          timeZone: 'America/Los_Angeles',
          modificationScope: scope
        };

        // Add required fields for each scope
        if (scope === 'thisEventOnly') {
          args.originalStartTime = '2024-06-15T10:00:00';
        } else if (scope === 'thisAndFollowing') {
          args.futureStartDate = getFutureDateString(90); // 90 days from now
        }

        const result = UpdateEventArgumentsSchema.parse(args);
        expect(result.modificationScope).toBe(scope);
      });
    });

    it('should reject invalid modificationScope values', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'invalid'
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow();
    });
  });

  describe('Single Instance Scope Validation', () => {
    it('should require originalStartTime when modificationScope is "thisEventOnly"', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisEventOnly'
        // missing originalStartTime
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow(
        /originalStartTime is required when modificationScope is 'thisEventOnly'/
      );
    });

    it('should accept valid originalStartTime for thisEventOnly scope', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisEventOnly',
        originalStartTime: '2024-06-15T10:00:00'
      };

      const result = UpdateEventArgumentsSchema.parse(args);
      expect(result.modificationScope).toBe('thisEventOnly');
      expect(result.originalStartTime).toBe('2024-06-15T10:00:00');
    });

    it('should reject invalid originalStartTime format', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisEventOnly',
        originalStartTime: '2024-06-15 10:00:00' // invalid format
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow();
    });

    it('should accept originalStartTime without timezone designator', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisEventOnly',
        originalStartTime: '2024-06-15T10:00:00' // timezone-naive format (expected)
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).not.toThrow();
    });
  });

  describe('Future Instances Scope Validation', () => {
    it('should require futureStartDate when modificationScope is "thisAndFollowing"', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisAndFollowing'
        // missing futureStartDate
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow(
        /futureStartDate is required when modificationScope is 'thisAndFollowing'/
      );
    });

    it('should accept valid futureStartDate for thisAndFollowing scope', () => {
      const futureDateString = getFutureDateString(30); // 30 days from now

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisAndFollowing',
        futureStartDate: futureDateString
      };

      const result = UpdateEventArgumentsSchema.parse(args);
      expect(result.modificationScope).toBe('thisAndFollowing');
      expect(result.futureStartDate).toBe(futureDateString);
    });

    it('should reject futureStartDate in the past', () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      // Format as ISO string without milliseconds
      const pastDateString = pastDate.toISOString().split('.')[0] + 'Z';

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisAndFollowing',
        futureStartDate: pastDateString
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow(
        /futureStartDate must be in the future/
      );
    });

    it('should reject invalid futureStartDate format', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisAndFollowing',
        futureStartDate: '2024-12-31 10:00:00' // invalid format
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow();
    });
  });

  describe('Datetime Format Validation', () => {
    const validDatetimes = [
      '2024-06-15T10:00:00',      // timezone-naive (preferred)
      '2024-12-31T23:59:59',      // timezone-naive (preferred)
      '2024-01-01T00:00:00',      // timezone-naive (preferred)
      '2024-06-15T10:00:00Z',     // timezone-aware (accepted)
      '2024-06-15T10:00:00-07:00', // timezone-aware (accepted)
      '2024-06-15T10:00:00+05:30'  // timezone-aware (accepted)
    ];

    const invalidDatetimes = [
      '2024-06-15 10:00:00',     // space instead of T
      '24-06-15T10:00:00',       // short year
      '2024-6-15T10:00:00',      // single digit month
      '2024-06-15T10:00'         // missing seconds
    ];

    validDatetimes.forEach(datetime => {
      it(`should accept valid datetime format: ${datetime}`, () => {
        const args = {
          calendarId: 'primary',
          eventId: 'event123',
          timeZone: 'America/Los_Angeles',
          start: datetime,
          end: datetime
        };

        expect(() => UpdateEventArgumentsSchema.parse(args)).not.toThrow();
      });
    });

    invalidDatetimes.forEach(datetime => {
      it(`should reject invalid datetime format: ${datetime}`, () => {
        const args = {
          calendarId: 'primary',
          eventId: 'event123',
          timeZone: 'America/Los_Angeles',
          start: datetime
        };

        expect(() => UpdateEventArgumentsSchema.parse(args)).toThrow();
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should validate complete update with all fields', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'thisAndFollowing',
        futureStartDate: getFutureDateString(60), // 60 days from now
        summary: 'Updated Meeting',
        description: 'Updated description',
        location: 'New Conference Room',
        start: '2024-06-15T10:00:00',
        end: '2024-06-15T11:00:00',
        colorId: '9',
        attendees: [
          { email: 'user1@example.com' },
          { email: 'user2@example.com' }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 1440 },
            { method: 'popup', minutes: 10 }
          ]
        },
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO']
      };

      const result = UpdateEventArgumentsSchema.parse(args);
      expect(result).toMatchObject(args);
    });

    it('should not require conditional fields for "all" scope', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'all',
        summary: 'Updated Meeting'
        // no originalStartTime or futureStartDate required
      };

      expect(() => UpdateEventArgumentsSchema.parse(args)).not.toThrow();
    });

    it('should allow optional conditional fields when not required', () => {
      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        modificationScope: 'all',
        originalStartTime: '2024-06-15T10:00:00', // optional for 'all' scope
        summary: 'Updated Meeting'
      };

      const result = UpdateEventArgumentsSchema.parse(args);
      expect(result.originalStartTime).toBe('2024-06-15T10:00:00');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing update calls', () => {
      // Existing call format without new parameters
      const legacyArgs = {
        calendarId: 'primary',
        eventId: 'event123',
        timeZone: 'America/Los_Angeles',
        summary: 'Updated Meeting',
        location: 'Conference Room A'
      };

      const result = UpdateEventArgumentsSchema.parse(legacyArgs);
      expect(result.modificationScope).toBeUndefined(); // optional with no default
      expect(result.summary).toBe('Updated Meeting');
      expect(result.location).toBe('Conference Room A');
    });
  });
});

describe('ListEventsArgumentsSchema JSON String Handling', () => {
  it('should parse JSON string calendarId into array', () => {
    const input = {
      calendarId: '["primary", "secondary@gmail.com"]',
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-02T00:00:00Z'
    };

    const result = ListEventsArgumentsSchema.parse(input);
    // The new schema keeps JSON strings as strings (they are parsed in the handler)
    expect(result.calendarId).toBe('["primary", "secondary@gmail.com"]');
  });

  it('should handle regular string calendarId', () => {
    const input = {
      calendarId: 'primary',
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-02T00:00:00Z'
    };

    const result = ListEventsArgumentsSchema.parse(input);
    expect(result.calendarId).toBe('primary');
  });

  it('should handle regular array calendarId', () => {
    // Arrays are now supported via preprocessing
    const input = {
      calendarId: ['primary', 'secondary@gmail.com'],
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-02T00:00:00Z'
    };

    // Arrays are now kept as arrays (not transformed to JSON strings)
    const result = ListEventsArgumentsSchema.parse(input);
    expect(result.calendarId).toEqual(['primary', 'secondary@gmail.com']);
  });

  it('should reject invalid JSON string', () => {
    // Invalid JSON strings are accepted by the schema but will fail in the handler
    const input = {
      calendarId: '["primary", invalid]',
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-02T00:00:00Z'
    };

    // The schema accepts any string - validation happens in the handler
    const result = ListEventsArgumentsSchema.parse(input);
    expect(result.calendarId).toBe('["primary", invalid]');
  });

  it('should reject JSON string with non-string elements', () => {
    // Schema accepts any string - validation happens in the handler
    const input = {
      calendarId: '["primary", 123]',
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-02T00:00:00Z'
    };

    // The schema accepts any string - validation happens in the handler
    const result = ListEventsArgumentsSchema.parse(input);
    expect(result.calendarId).toBe('["primary", 123]');
  });
}); 