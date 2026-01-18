import { describe, it, expect, vi } from 'vitest';
import { GetCurrentTimeHandler } from '../../../handlers/core/GetCurrentTimeHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('GetCurrentTimeHandler', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;
  const mockAccounts = new Map([['test', mockOAuth2Client]]);

  describe('runTool', () => {
    it('should return current time without timezone parameter using primary calendar timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      // Mock calendar timezone to avoid real API calls in unit tests
      const spy = vi.spyOn(GetCurrentTimeHandler.prototype as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
      const result = await handler.runTool({}, mockAccounts);
      
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.currentTime).toBeDefined();
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('America/Los_Angeles');
      expect(response.offset).toBeDefined();
      expect(response.isDST).toBeTypeOf('boolean');
      spy.mockRestore();
    });

    it('should return current time with valid timezone parameter', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'America/New_York' }, mockAccounts);
      
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.currentTime).toBeDefined();
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('America/New_York');
      expect(response.offset).toBeDefined();
      expect(response.isDST).toBeTypeOf('boolean');
    });

    it('should handle UTC timezone parameter', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockAccounts);
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.timezone).toBe('UTC');
      expect(response.offset).toBe('Z');
      expect(response.isDST).toBe(false);
    });

    it('should throw error for invalid timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      
      await expect(handler.runTool({ timeZone: 'Invalid/Timezone' }, mockAccounts))
        .rejects.toThrow(McpError);

      try {
        await handler.runTool({ timeZone: 'Invalid/Timezone' }, mockAccounts);
      } catch (error) {
        expect(error).toBeInstanceOf(McpError);
        expect((error as McpError).code).toBe(ErrorCode.InvalidRequest);
        expect((error as McpError).message).toContain('Invalid timezone');
        expect((error as McpError).message).toContain('Invalid/Timezone');
      }
    });
  });

  describe('timezone validation', () => {
    it('should validate common IANA timezones', async () => {
      const handler = new GetCurrentTimeHandler();
      const validTimezones = [
        'UTC',
        'America/Los_Angeles',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney'
      ];

      for (const timezone of validTimezones) {
        const result = await handler.runTool({ timeZone: timezone }, mockAccounts);
        const response = JSON.parse(result.content[0].text as string);
        expect(response.timezone).toBe(timezone);
      }
    });

    it('should reject invalid timezone formats', async () => {
      const handler = new GetCurrentTimeHandler();
      const invalidTimezones = [
        'Pacific/Invalid',
        'Not/A/Timezone',
        'Invalid/Timezone',
        'XYZ',
        'foo/bar'
      ];

      for (const timezone of invalidTimezones) {
        await expect(handler.runTool({ timeZone: timezone }, mockAccounts))
          .rejects.toThrow(McpError);
      }
    });
  });

  describe('output format', () => {
    it('should include all required fields in response without timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      const spy = vi.spyOn(GetCurrentTimeHandler.prototype as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
      const result = await handler.runTool({}, mockAccounts);
      const response = JSON.parse(result.content[0].text as string);

      expect(response).toHaveProperty('currentTime');
      expect(response).toHaveProperty('timezone');
      expect(response).toHaveProperty('offset');
      expect(response).toHaveProperty('isDST');
      expect(response).toHaveProperty('dayOfWeek');
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('America/Los_Angeles');
      expect(response.isDST).toBeTypeOf('boolean');
      spy.mockRestore();
    });

    it('should include all required fields in response with timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockAccounts);
      const response = JSON.parse(result.content[0].text as string);

      expect(response).toHaveProperty('currentTime');
      expect(response).toHaveProperty('timezone');
      expect(response).toHaveProperty('offset');
      expect(response).toHaveProperty('isDST');
      expect(response).toHaveProperty('dayOfWeek');
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('UTC');
      expect(response.offset).toBe('Z');
      expect(response.isDST).toBe(false);
    });

    it('should return valid day of week name', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockAccounts);
      const response = JSON.parse(result.content[0].text as string);

      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      expect(validDays).toContain(response.dayOfWeek);
    });

    it('should return dayOfWeek consistent with currentTime in response', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'America/New_York' }, mockAccounts);
      const response = JSON.parse(result.content[0].text as string);

      // Parse the date from currentTime and verify dayOfWeek matches
      const dateFromResponse = new Date(response.currentTime);
      const expectedDay = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: response.timezone
      }).format(dateFromResponse);

      expect(response.dayOfWeek).toBe(expectedDay);
    });

    it('should return dayOfWeek in the specified timezone', async () => {
      const handler = new GetCurrentTimeHandler();

      // Get results for two different timezones
      const utcResult = await handler.runTool({ timeZone: 'UTC' }, mockAccounts);
      const tokyoResult = await handler.runTool({ timeZone: 'Asia/Tokyo' }, mockAccounts);

      const utcResponse = JSON.parse(utcResult.content[0].text as string);
      const tokyoResponse = JSON.parse(tokyoResult.content[0].text as string);

      // Both should return valid days
      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      expect(validDays).toContain(utcResponse.dayOfWeek);
      expect(validDays).toContain(tokyoResponse.dayOfWeek);

      // Verify each dayOfWeek is consistent with its own currentTime
      const utcDate = new Date(utcResponse.currentTime);
      const tokyoDate = new Date(tokyoResponse.currentTime);

      const expectedUtcDay = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
      }).format(utcDate);

      const expectedTokyoDay = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'Asia/Tokyo'
      }).format(tokyoDate);

      expect(utcResponse.dayOfWeek).toBe(expectedUtcDay);
      expect(tokyoResponse.dayOfWeek).toBe(expectedTokyoDay);
    });

    it('should format RFC3339 timestamps correctly', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockAccounts);
      const response = JSON.parse(result.content[0].text as string);

      // Should match ISO8601 pattern with timezone offset
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      // Offset should be in the format +HH:MM, -HH:MM, or Z
      expect(response.offset).toMatch(/^([+-]\d{2}:\d{2}|Z)$/);
    });
  });
});
