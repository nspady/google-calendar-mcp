import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetEventHandler } from '../../../handlers/core/GetEventHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        get: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock the field mask builder
vi.mock('../../../utils/field-mask-builder.js', () => ({
  buildSingleEventFieldMask: vi.fn((fields) => {
    if (!fields || fields.length === 0) return undefined;
    return fields.join(',');
  })
}));

describe('GetEventHandler', () => {
  let handler: GetEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new GetEventHandler();
    mockOAuth2Client = new OAuth2Client();
    
    // Setup mock calendar
    mockCalendar = {
      events: {
        get: vi.fn()
      }
    };
    
    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
  });

  describe('runTool', () => {
    it('should retrieve an event successfully', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Test Event',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        status: 'confirmed'
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123'
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBe('event123');
      expect(response.event.summary).toBe('Test Event');
    });

    it('should retrieve an event with custom fields', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Test Event',
        start: { dateTime: '2025-01-15T10:00:00Z' },
        end: { dateTime: '2025-01-15T11:00:00Z' },
        description: 'Event description',
        colorId: '5',
        attendees: [{ email: 'test@example.com' }]
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        fields: ['description', 'colorId', 'attendees']
      };

      const result = await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        fields: 'description,colorId,attendees'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.id).toBe('event123');
      expect(response.event.description).toBe('Event description');
      expect(response.event.colorId).toBe('5');
    });

    it('should handle event not found', async () => {
      const notFoundError = new Error('Not found');
      (notFoundError as any).code = 404;
      mockCalendar.events.get.mockRejectedValue(notFoundError);

      const args = {
        calendarId: 'primary',
        eventId: 'nonexistent'
      };

      // Now throws an error instead of returning a message
      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        "Event with ID 'nonexistent' not found in calendar 'primary'."
      );
    });

    it('should handle API errors', async () => {
      const apiError = new Error('API Error');
      (apiError as any).code = 500;
      mockCalendar.events.get.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Handled API Error');
      });

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow('Handled API Error');
    });

    it('should handle null event response', async () => {
      mockCalendar.events.get.mockResolvedValue({ data: null });

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      // Now throws an error instead of returning a message
      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        "Event with ID 'event123' not found in calendar 'primary'."
      );
    });
  });

  describe('field mask integration', () => {
    it('should not include fields parameter when no fields requested', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Test Event'
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123'
      });
    });

    it('should include fields parameter when fields are requested', async () => {
      const mockEvent = {
        id: 'event123',
        summary: 'Test Event',
        description: 'Test Description'
      };

      mockCalendar.events.get.mockResolvedValue({ data: mockEvent });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        fields: ['description']
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        fields: 'description'
      });
    });
  });
});