import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteEventHandler } from '../../../handlers/core/DeleteEventHandler.js';
import { OAuth2Client } from 'google-auth-library';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        delete: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

describe('DeleteEventHandler', () => {
  let handler: DeleteEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new DeleteEventHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        delete: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

    // Mock getAccountForCalendarWrite to return the test account
    vi.spyOn(handler as any, 'getAccountForCalendarWrite').mockResolvedValue({
      accountId: 'test',
      client: mockOAuth2Client
    });
  });

  describe('Basic Event Deletion', () => {
    it('should delete an event successfully', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: undefined
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.eventId).toBe('event123');
      expect(response.calendarId).toBe('primary');
      expect(response.message).toBe('Event deleted successfully');
    });

    it('should delete event with explicit account parameter', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        account: 'test'
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.delete).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });
  });

  describe('Send Updates Options', () => {
    it('should send updates to all attendees when specified', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'all'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'all'
      });
    });

    it('should send updates to external attendees only', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'externalOnly'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'externalOnly'
      });
    });

    it('should not send updates when none specified', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'none'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event123',
        sendUpdates: 'none'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle event not found error', async () => {
      const apiError = new Error('Not Found');
      (apiError as any).code = 404;
      mockCalendar.events.delete.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'nonexistent'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Event not found');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Event not found');
    });

    it('should handle permission denied error', async () => {
      const apiError = new Error('Forbidden');
      (apiError as any).code = 403;
      mockCalendar.events.delete.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Permission denied');
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Bad Request');
      (apiError as any).code = 400;
      mockCalendar.events.delete.mockRejectedValue(apiError);

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      // Mock handleGoogleApiError to throw a specific error
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Bad Request');
      });

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Bad Request');
    });
  });

  describe('Multi-Account Handling', () => {
    it('should throw error when no account has write access', async () => {
      // Mock getAccountForCalendarAccess to return null (no write access)
      vi.spyOn(handler as any, 'getAccountForCalendarAccess').mockResolvedValue(null);

      const args = {
        calendarId: 'primary',
        eventId: 'event123'
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow(
        'No account has write access to calendar "primary"'
      );
    });

    it('should use specified account when provided', async () => {
      const spy = vi.spyOn(handler as any, 'getClientForAccount');
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const args = {
        calendarId: 'primary',
        eventId: 'event123',
        account: 'test'
      };

      await handler.runTool(args, mockAccounts);

      expect(spy).toHaveBeenCalledWith('test', mockAccounts);
    });
  });
});
