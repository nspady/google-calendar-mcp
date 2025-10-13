/**
 * Unit tests for calendar name resolution feature
 * Tests the resolveCalendarId and resolveCalendarIds methods in BaseToolHandler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

// Mock googleapis globally
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: vi.fn()
      },
      calendarList: {
        list: vi.fn(),
        get: vi.fn()
      }
    }))
  }
}));

describe('Calendar Name Resolution', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;

  let handler: ListEventsHandler;
  let mockCalendar: any;

  beforeEach(() => {
    handler = new ListEventsHandler();
    mockCalendar = {
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: []
          }
        })
      },
      calendarList: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'primary',
                summary: 'Primary Calendar',
                summaryOverride: undefined
              },
              {
                id: 'work@example.com',
                summary: 'Engineering Team - Project Alpha - Q4 2024',
                summaryOverride: 'Work Calendar'
              },
              {
                id: 'personal@example.com',
                summary: 'Personal Calendar',
                summaryOverride: undefined
              },
              {
                id: 'team@example.com',
                summary: 'Team Events',
                summaryOverride: 'My Team'
              }
            ]
          }
        }),
        get: vi.fn().mockResolvedValue({
          data: { timeZone: 'UTC' }
        })
      }
    };
    vi.mocked(google.calendar).mockReturnValue(mockCalendar);
  });

  describe('summaryOverride matching priority', () => {
    it('should match summaryOverride before summary (exact match)', async () => {
      const args = {
        calendarId: 'Work Calendar',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await handler.runTool(args, mockOAuth2Client);

      // Should have called events.list with the resolved ID
      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'work@example.com'
        })
      );
    });

    it('should fall back to summary if summaryOverride does not match', async () => {
      const args = {
        calendarId: 'Personal Calendar',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'personal@example.com'
        })
      );
    });

    it('should match summaryOverride case-insensitively', async () => {
      const args = {
        calendarId: 'WORK CALENDAR',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'work@example.com'
        })
      );
    });

    it('should match summary case-insensitively', async () => {
      const args = {
        calendarId: 'personal calendar',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'personal@example.com'
        })
      );
    });

    it('should prefer summaryOverride over similar summary name', async () => {
      // Even if there's a calendar with summary "My Team",
      // it should match the summaryOverride first
      const args = {
        calendarId: 'My Team',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await handler.runTool(args, mockOAuth2Client);

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'team@example.com'
        })
      );
    });
  });

  describe('multiple calendar name resolution', () => {
    it('should resolve multiple calendar names including summaryOverride', async () => {
      const args = {
        calendarId: ['Work Calendar', 'Personal Calendar'],  // Pass as array, not JSON string
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      // Mock fetch for batch requests
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn()
        },
        text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http
Content-ID: <item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": []}

--batch_boundary
Content-Type: application/http
Content-ID: <item2>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": []}

--batch_boundary--`)
      });

      await handler.runTool(args, mockOAuth2Client);

      // Should have called fetch with both resolved calendar IDs
      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const requestBody = fetchCall[1]?.body as string;

      // Calendar IDs may be URL-encoded in batch request
      expect(requestBody).toMatch(/work@example\.com|work%40example\.com/);
      expect(requestBody).toMatch(/personal@example\.com|personal%40example\.com/);
    });

    it('should resolve mix of IDs, summary names, and summaryOverride names', async () => {
      const args = {
        calendarId: ['primary', 'Work Calendar', 'Personal Calendar'],  // Pass as array
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn()
        },
        text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http

HTTP/1.1 200 OK

{"items": []}
--batch_boundary--`)
      });

      await handler.runTool(args, mockOAuth2Client);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const requestBody = fetchCall[1]?.body as string;

      // Should include all three calendar IDs (may be URL-encoded)
      expect(requestBody).toContain('primary');
      expect(requestBody).toMatch(/work@example\.com|work%40example\.com/);
      expect(requestBody).toMatch(/personal@example\.com|personal%40example\.com/);
    });
  });

  describe('error handling with summaryOverride', () => {
    it('should provide helpful error listing both summaryOverride and summary', async () => {
      const args = {
        calendarId: 'NonExistentCalendar',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        /Calendar\(s\) not found: "NonExistentCalendar"/
      );

      try {
        await handler.runTool(args, mockOAuth2Client);
      } catch (error: any) {
        // Error message should show both override and original name
        expect(error.message).toContain('Work Calendar');
        expect(error.message).toContain('Engineering Team - Project Alpha - Q4 2024');
        expect(error.message).toContain('My Team');
        expect(error.message).toContain('Team Events');
      }
    });

    it('should handle calendar with summaryOverride same as summary', async () => {
      // Update mock to have a calendar where override equals summary
      mockCalendar.calendarList.list.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'test@example.com',
              summary: 'Test Calendar',
              summaryOverride: 'Test Calendar'
            }
          ]
        }
      });

      const args = {
        calendarId: 'NonExistent',
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      try {
        await handler.runTool(args, mockOAuth2Client);
      } catch (error: any) {
        // Should not show duplicate when override equals summary
        const message = error.message;
        const matches = (message.match(/Test Calendar/g) || []).length;
        expect(matches).toBe(1);
      }
    });
  });

  describe('performance optimization', () => {
    it('should skip API call when all inputs are IDs', async () => {
      const args = {
        calendarId: ['primary', 'work@example.com'],  // Pass as array
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      // Reset the mock to track calls
      mockCalendar.calendarList.list.mockClear();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn()
        },
        text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http

HTTP/1.1 200 OK

{"items": []}
--batch_boundary--`)
      });

      await handler.runTool(args, mockOAuth2Client);

      // Should NOT have called calendarList.list since all inputs are IDs
      expect(mockCalendar.calendarList.list).not.toHaveBeenCalled();
    });

    it('should call API only once for multiple name resolutions', async () => {
      const args = {
        calendarId: ['Work Calendar', 'Personal Calendar', 'My Team'],  // Pass as array
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      mockCalendar.calendarList.list.mockClear();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn()
        },
        text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http

HTTP/1.1 200 OK

{"items": []}
--batch_boundary--`)
      });

      await handler.runTool(args, mockOAuth2Client);

      // Should have called calendarList.list exactly once
      expect(mockCalendar.calendarList.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('input validation', () => {
    it('should filter out empty strings', async () => {
      const args = {
        calendarId: ['primary', '', 'Work Calendar'],  // Pass as array
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn()
        },
        text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http

HTTP/1.1 200 OK

{"items": []}
--batch_boundary--`)
      });

      // Should not throw - empty string should be filtered out
      await expect(handler.runTool(args, mockOAuth2Client)).resolves.toBeDefined();
    });

    it('should reject when all inputs are empty/whitespace', async () => {
      const args = {
        calendarId: ['', '  ', '\t'],  // Pass as array
        timeMin: '2025-06-02T00:00:00Z',
        timeMax: '2025-06-09T23:59:59Z'
      };

      await expect(handler.runTool(args, mockOAuth2Client)).rejects.toThrow(
        /At least one valid calendar identifier is required/
      );
    });
  });
});
