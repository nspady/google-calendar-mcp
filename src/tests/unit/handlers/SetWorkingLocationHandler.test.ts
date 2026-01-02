import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetWorkingLocationHandler } from '../../../handlers/core/SetWorkingLocationHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

// Mock datetime utilities
vi.mock('../../../handlers/utils/datetime.js', () => ({
  createTimeObject: vi.fn((datetime: string, timezone: string) => ({
    dateTime: datetime,
    timeZone: timezone
  }))
}));

describe('SetWorkingLocationHandler', () => {
  let handler: SetWorkingLocationHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    // Reset the singleton to get a fresh instance for each test
    CalendarRegistry.resetInstance();

    handler = new SetWorkingLocationHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    // Setup mock calendar
    mockCalendar = {
      events: {
        insert: vi.fn()
      }
    };

    // Mock the getCalendar method
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);

    // Mock getCalendarTimezone
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');

    // Mock getClientWithAutoSelection to return the test account
    vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
      client: mockOAuth2Client,
      accountId: 'test',
      calendarId: 'primary',
      wasAutoSelected: true
    });
  });

  describe('Home Office Location', () => {
    it('should create a home office working location event', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from home',
        eventType: 'workingLocation',
        transparency: 'transparent',
        visibility: 'public',
        start: { dateTime: '2025-01-15T09:00:00-08:00' },
        end: { dateTime: '2025-01-15T17:00:00-08:00' },
        workingLocationProperties: {
          type: 'homeOffice',
          homeOffice: {}
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'homeOffice' as const
      };

      const result = await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Working from home',
          eventType: 'workingLocation',
          transparency: 'transparent',
          visibility: 'public',
          workingLocationProperties: expect.objectContaining({
            type: 'homeOffice',
            homeOffice: {}
          })
        })
      });

      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      expect(response.event.eventType).toBe('workingLocation');
    });
  });

  describe('Office Location', () => {
    it('should create an office location event with label only', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from NYC Office',
        eventType: 'workingLocation',
        workingLocationProperties: {
          type: 'officeLocation',
          officeLocation: {
            label: 'NYC Office'
          }
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'officeLocation' as const,
        officeLabel: 'NYC Office'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from NYC Office',
            workingLocationProperties: expect.objectContaining({
              type: 'officeLocation',
              officeLocation: expect.objectContaining({
                label: 'NYC Office'
              })
            })
          })
        })
      );
    });

    it('should create an office location event with full building details', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from HQ Building',
        eventType: 'workingLocation',
        workingLocationProperties: {
          type: 'officeLocation',
          officeLocation: {
            label: 'HQ Building',
            buildingId: 'building-123',
            floorId: 'floor-3',
            floorSectionId: 'section-A',
            deskId: 'desk-42'
          }
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'officeLocation' as const,
        officeLabel: 'HQ Building',
        buildingId: 'building-123',
        floorId: 'floor-3',
        floorSectionId: 'section-A',
        deskId: 'desk-42'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            workingLocationProperties: expect.objectContaining({
              type: 'officeLocation',
              officeLocation: expect.objectContaining({
                label: 'HQ Building',
                buildingId: 'building-123',
                floorId: 'floor-3',
                floorSectionId: 'section-A',
                deskId: 'desk-42'
              })
            })
          })
        })
      );
    });

    it('should generate default summary for office location without label', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from office',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'officeLocation' as const
        // No officeLabel provided
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from office'
          })
        })
      );
    });
  });

  describe('Custom Location', () => {
    it('should create a custom location event', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from Coffee Shop',
        eventType: 'workingLocation',
        workingLocationProperties: {
          type: 'customLocation',
          customLocation: {
            label: 'Coffee Shop'
          }
        }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'customLocation' as const,
        customLocationLabel: 'Coffee Shop'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Working from Coffee Shop',
            workingLocationProperties: expect.objectContaining({
              type: 'customLocation',
              customLocation: expect.objectContaining({
                label: 'Coffee Shop'
              })
            })
          })
        })
      );
    });

    it('should create custom location event with custom summary', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Client visit - Acme Corp',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        summary: 'Client visit - Acme Corp',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'customLocation' as const,
        customLocationLabel: 'Acme Corp HQ'
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Client visit - Acme Corp'
          })
        })
      );
    });
  });

  describe('All-Day Events', () => {
    it('should create an all-day working location event', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from home',
        eventType: 'workingLocation',
        start: { date: '2025-01-15' },
        end: { date: '2025-01-16' }
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15',
        end: '2025-01-16',
        locationType: 'homeOffice' as const
      };

      await handler.runTool(args, mockAccounts);

      // Note: The actual datetime handling is mocked, but this tests the flow
      expect(mockCalendar.events.insert).toHaveBeenCalled();
    });
  });

  describe('Timezone Handling', () => {
    it('should use provided timezone', async () => {
      const mockCreatedEvent = {
        id: 'wl-event-123',
        summary: 'Working from home',
        eventType: 'workingLocation'
      };

      mockCalendar.events.insert.mockResolvedValue({ data: mockCreatedEvent });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        timeZone: 'Europe/Berlin',
        locationType: 'homeOffice' as const
      };

      await handler.runTool(args, mockAccounts);

      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            start: expect.objectContaining({
              timeZone: 'Europe/Berlin'
            }),
            end: expect.objectContaining({
              timeZone: 'Europe/Berlin'
            })
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const apiError = new Error('API Error');
      (apiError as any).response = { status: 403 };
      mockCalendar.events.insert.mockRejectedValue(apiError);

      // Mock handleGoogleApiError
      vi.spyOn(handler as any, 'handleGoogleApiError').mockImplementation(() => {
        throw new Error('Access denied: Insufficient permissions');
      });

      const args = {
        calendarId: 'primary',
        start: '2025-01-15T09:00:00',
        end: '2025-01-15T17:00:00',
        locationType: 'homeOffice' as const
      };

      await expect(handler.runTool(args, mockAccounts)).rejects.toThrow('Access denied');
    });
  });
});
