import { describe, it, expect, vi } from 'vitest';
import { GetCurrentTimeHandler } from '../../../handlers/core/GetCurrentTimeHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('GetCurrentTimeHandler', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;

  describe('runTool', () => {
    it('should return current time without timezone parameter', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({}, mockOAuth2Client);
      
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.currentTime).toBeDefined();
      expect(response.currentTime.utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(response.currentTime.timestamp).toBeTypeOf('number');
      expect(response.currentTime.systemTimeZone).toBeDefined();
      expect(response.currentTime.systemTimeZone.timeZone).toBeTypeOf('string');
      expect(response.currentTime.note).toContain('HTTP mode');
    });

    it('should return current time with valid timezone parameter', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'America/New_York' }, mockOAuth2Client);
      
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.currentTime).toBeDefined();
      expect(response.currentTime.utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(response.currentTime.timestamp).toBeTypeOf('number');
      expect(response.currentTime.requestedTimeZone).toBeDefined();
      expect(response.currentTime.requestedTimeZone.timeZone).toBe('America/New_York');
      expect(response.currentTime.requestedTimeZone.rfc3339).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it('should handle UTC timezone parameter', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      
      const response = JSON.parse(result.content[0].text as string);
      expect(response.currentTime.requestedTimeZone.timeZone).toBe('UTC');
      expect(response.currentTime.requestedTimeZone.rfc3339).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(response.currentTime.requestedTimeZone.offset).toBe('Z');
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
        expect(response.currentTime.requestedTimeZone.timeZone).toBe(timezone);
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
      const result = await handler.runTool({}, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      expect(response.currentTime).toHaveProperty('utc');
      expect(response.currentTime).toHaveProperty('timestamp');
      expect(response.currentTime).toHaveProperty('systemTimeZone');
      expect(response.currentTime).toHaveProperty('note');
      
      expect(response.currentTime.systemTimeZone).toHaveProperty('timeZone');
      expect(response.currentTime.systemTimeZone).toHaveProperty('rfc3339');
      expect(response.currentTime.systemTimeZone).toHaveProperty('humanReadable');
      expect(response.currentTime.systemTimeZone).toHaveProperty('offset');
    });

    it('should include all required fields in response with timezone', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      expect(response.currentTime).toHaveProperty('utc');
      expect(response.currentTime).toHaveProperty('timestamp');
      expect(response.currentTime).toHaveProperty('requestedTimeZone');
      expect(response.currentTime).not.toHaveProperty('systemTimeZone');
      expect(response.currentTime).not.toHaveProperty('note');
      
      expect(response.currentTime.requestedTimeZone).toHaveProperty('timeZone');
      expect(response.currentTime.requestedTimeZone).toHaveProperty('rfc3339');
      expect(response.currentTime.requestedTimeZone).toHaveProperty('humanReadable');
      expect(response.currentTime.requestedTimeZone).toHaveProperty('offset');
    });

    it('should format RFC3339 timestamps correctly', async () => {
      const handler = new GetCurrentTimeHandler();
      const result = await handler.runTool({ timeZone: 'UTC' }, mockOAuth2Client);
      const response = JSON.parse(result.content[0].text as string);

      // Should match RFC3339 pattern with timezone
      expect(response.currentTime.requestedTimeZone.rfc3339).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
      expect(response.currentTime.utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});