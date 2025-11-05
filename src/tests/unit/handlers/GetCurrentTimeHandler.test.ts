import { describe, it, expect, vi } from 'vitest';
import { GetCurrentTimeHandler } from '../../../handlers/core/GetCurrentTimeHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('GetCurrentTimeHandler', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;

  describe('runTool', () => {
    it('should return current time without timezone parameter using primary calendar timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      // Mock calendar timezone to avoid real API calls in unit tests
      const spy = vi.spyOn(GetCurrentTimeHandler.prototype as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
      const result = await handler.runTool({}, mockOAuth2Client);
      
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
      const result = await handler.runTool({ timeZone: 'America/New_York' }, mockOAuth2Client);
      
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
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.timezone).toBe('UTC');
      expect(response.offset).toBe('Z');
      expect(response.isDST).toBe(false);
    });

    it('should throw error for invalid timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      
      await expect(handler.runTool({ timeZone: 'Invalid/Timezone' }, mockOAuth2Client))
        .rejects.toThrow(McpError);

      try {
        await handler.runTool({ timeZone: 'Invalid/Timezone' }, mockOAuth2Client);
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
        const result = await handler.runTool({ timeZone: timezone }, mockOAuth2Client);
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
        await expect(handler.runTool({ timeZone: timezone }, mockOAuth2Client))
          .rejects.toThrow(McpError);
      }
    });
  });

  describe('output format', () => {
    it('should include all required fields in response without timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      const spy = vi.spyOn(GetCurrentTimeHandler.prototype as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
      const result = await handler.runTool({}, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      expect(response).toHaveProperty('currentTime');
      expect(response).toHaveProperty('timezone');
      expect(response).toHaveProperty('offset');
      expect(response).toHaveProperty('isDST');
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('America/Los_Angeles');
      expect(response.isDST).toBeTypeOf('boolean');
      spy.mockRestore();
    });

    it('should include all required fields in response with timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      expect(response).toHaveProperty('currentTime');
      expect(response).toHaveProperty('timezone');
      expect(response).toHaveProperty('offset');
      expect(response).toHaveProperty('isDST');
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      expect(response.timezone).toBe('UTC');
      expect(response.offset).toBe('Z');
      expect(response.isDST).toBe(false);
    });

    it('should format RFC3339 timestamps correctly', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      // Should match ISO8601 pattern with timezone offset
      expect(response.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/);
      // Offset should be in the format +HH:MM, -HH:MM, or Z
      expect(response.offset).toMatch(/^([+-]\d{2}:\d{2}|Z)$/);
    });
  });
});
