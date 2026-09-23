import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GaxiosError } from 'gaxios';
import { OAuth2Client } from 'google-auth-library';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler } from '../../../handlers/core/BaseToolHandler.js';

class TestHandler extends BaseToolHandler<Record<string, never>> {
  async runTool() {
    return { content: [] };
  }
  timezone(operation?: 'read' | 'write') {
    return this.getCalendarTimezone(new OAuth2Client(), 'cal-id', operation);
  }
}

function apiError(status: number): GaxiosError {
  const error = new GaxiosError(`HTTP ${status}`, {} as any, { status, data: {} } as any);
  error.response = { status, data: {} } as any;
  return error;
}

describe('BaseToolHandler.getCalendarTimezone', () => {
  let handler: TestHandler;
  let get: ReturnType<typeof vi.fn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handler = new TestHandler();
    get = vi.fn();
    vi.spyOn(handler as any, 'getCalendar').mockReturnValue({ calendarList: { get } });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the calendar's time zone", async () => {
    get.mockResolvedValue({ data: { timeZone: 'Europe/Paris' } });
    await expect(handler.timezone('write')).resolves.toBe('Europe/Paris');
  });

  it('uses UTC when the calendar has no time zone', async () => {
    get.mockResolvedValue({ data: {} });
    await expect(handler.timezone('write')).resolves.toBe('UTC');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('falls back to UTC with a warning on read paths', async () => {
    get.mockRejectedValue(new Error('timeout of 3000ms exceeded'));
    await expect(handler.timezone('read')).resolves.toBe('UTC');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Could not read time zone for calendar "cal-id" (timeout of 3000ms exceeded)'));
  });

  it('throws on write paths for transient failures', async () => {
    get.mockRejectedValue(apiError(500));
    await expect(handler.timezone('write')).rejects.toBeInstanceOf(McpError);
  });

  it.each([403, 404])('falls back to UTC on write paths when the calendar is not in the list (%i)', async (status) => {
    get.mockRejectedValue(apiError(status));
    await expect(handler.timezone('write')).resolves.toBe('UTC');
    expect(stderr).toHaveBeenCalled();
  });
});
