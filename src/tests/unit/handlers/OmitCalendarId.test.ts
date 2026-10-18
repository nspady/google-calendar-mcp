/**
 * Tests for configurable default calendar resolution when calendarId is omitted.
 *
 * Verifies that list-events and search-events:
 * 1. Validate successfully with calendarId omitted (schema-level).
 * 2. Resolve the omitted calendarId to GOOGLE_CALENDAR_MCP_DEFAULT_CALENDAR_ID.
 * 3. Fall back to 'primary' when the env var is unset (historical behavior).
 * 4. Still honor an explicit calendarId (including the literal 'primary' alias).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { SearchEventsHandler } from '../../../handlers/core/SearchEventsHandler.js';
import { ToolSchemas, ToolRegistry } from '../../../tools/registry.js';

const ENV_KEY = 'GOOGLE_CALENDAR_MCP_DEFAULT_CALENDAR_ID';
const FAMILY_CAL = 'configured-default-calendar@group.calendar.google.com';

const listEventsToolDef = (ToolRegistry as any).tools?.find((t: any) => t.name === 'list-events');
const listEventsHandlerFn = listEventsToolDef?.handlerFunction;

describe('Default calendar resolution with calendarId omitted', () => {
  const savedEnv = process.env[ENV_KEY];
  let accounts: Map<string, OAuth2Client>;

  beforeEach(() => {
    accounts = new Map([['test1', new OAuth2Client()]]);
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    vi.restoreAllMocks();
  });

  describe('Schema validation', () => {
    it('accepts list-events input with calendarId omitted', () => {
      const parsed = ToolSchemas['list-events'].parse({});
      expect(parsed.calendarId).toBeUndefined();
    });

    it('accepts search-events input with calendarId omitted', () => {
      const parsed = ToolSchemas['search-events'].parse({
        query: 'standup',
        timeMin: '2026-01-01T00:00:00',
        timeMax: '2026-01-31T23:59:59'
      });
      expect(parsed.calendarId).toBeUndefined();
    });

    it('still rejects an empty calendarId array', () => {
      expect(() => ToolSchemas['list-events'].parse({ calendarId: [] })).toThrow();
    });

    it('still accepts explicit calendar IDs including literal primary', () => {
      expect(ToolSchemas['list-events'].parse({ calendarId: 'primary' }).calendarId).toBe('primary');
      expect(ToolSchemas['list-events'].parse({ calendarId: FAMILY_CAL }).calendarId).toBe(FAMILY_CAL);
    });

    it('passes handlerFunction preprocessing with calendarId omitted', async () => {
      const parsed = ToolSchemas['list-events'].parse({});
      const result = await listEventsHandlerFn(parsed);
      expect(result.calendarId).toBeUndefined();
    });
  });

  describe('list-events handler resolution', () => {
    it('queries the configured default calendar when calendarId is omitted', async () => {
      process.env[ENV_KEY] = FAMILY_CAL;
      const handler = new ListEventsHandler();
      const resolveSpy = vi
        .spyOn(handler as any, 'resolveCalendarIds')
        .mockImplementation(async (_client: unknown, names: string[]) => names);
      vi.spyOn(handler as any, 'fetchEvents').mockResolvedValue([] as never);

      await handler.runTool({} as any, accounts);

      expect(resolveSpy).toHaveBeenCalled();
      expect(resolveSpy.mock.calls[0][1]).toEqual([FAMILY_CAL]);
    });

    it('falls back to primary when the env var is unset', async () => {
      delete process.env[ENV_KEY];
      const handler = new ListEventsHandler();
      const resolveSpy = vi
        .spyOn(handler as any, 'resolveCalendarIds')
        .mockImplementation(async (_client: unknown, names: string[]) => names);
      vi.spyOn(handler as any, 'fetchEvents').mockResolvedValue([] as never);

      await handler.runTool({} as any, accounts);

      expect(resolveSpy.mock.calls[0][1]).toEqual(['primary']);
    });

    it('uses an explicit calendarId unchanged when provided', async () => {
      process.env[ENV_KEY] = FAMILY_CAL;
      const handler = new ListEventsHandler();
      const resolveSpy = vi
        .spyOn(handler as any, 'resolveCalendarIds')
        .mockImplementation(async (_client: unknown, names: string[]) => names);
      vi.spyOn(handler as any, 'fetchEvents').mockResolvedValue([] as never);

      await handler.runTool({ calendarId: 'Work' } as any, accounts);

      expect(resolveSpy.mock.calls[0][1]).toEqual(['Work']);
    });
  });

  describe('search-events handler resolution', () => {
    function searchArgs() {
      return {
        query: 'standup',
        timeMin: '2026-01-01T00:00:00',
        timeMax: '2026-01-31T23:59:59'
      };
    }

    it('searches the configured default calendar when calendarId is omitted', async () => {
      process.env[ENV_KEY] = FAMILY_CAL;
      const handler = new SearchEventsHandler();
      const autoSpy = vi
        .spyOn(handler as any, 'getClientWithAutoSelection')
        .mockImplementation(async (_account: unknown, calendarId: string) => ({
          accountId: 'test1',
          calendarId
        }));
      vi.spyOn(handler as any, 'searchEvents').mockResolvedValue([] as never);

      await handler.runTool(searchArgs() as any, accounts);

      expect(autoSpy.mock.calls[0][1]).toEqual(FAMILY_CAL);
    });

    it('falls back to primary when the env var is unset', async () => {
      delete process.env[ENV_KEY];
      const handler = new SearchEventsHandler();
      const autoSpy = vi
        .spyOn(handler as any, 'getClientWithAutoSelection')
        .mockImplementation(async (_account: unknown, calendarId: string) => ({
          accountId: 'test1',
          calendarId
        }));
      vi.spyOn(handler as any, 'searchEvents').mockResolvedValue([] as never);

      await handler.runTool(searchArgs() as any, accounts);

      expect(autoSpy.mock.calls[0][1]).toEqual('primary');
    });
  });
});
