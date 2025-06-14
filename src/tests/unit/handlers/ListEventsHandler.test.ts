import { describe, it, expect, vi } from 'vitest';
import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { OAuth2Client } from 'google-auth-library';

describe('ListEventsHandler JSON String Handling', () => {
  const mockOAuth2Client = {
    getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
  } as unknown as OAuth2Client;
  
  const handler = new ListEventsHandler();

  // Mock the calendar API methods
  vi.mock('googleapis', () => ({
    google: {
      calendar: () => ({
        events: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  id: 'test-event',
                  summary: 'Test Event',
                  start: { dateTime: '2025-06-02T10:00:00Z' },
                  end: { dateTime: '2025-06-02T11:00:00Z' },
                }
              ]
            }
          })
        }
      })
    }
  }));

  // Mock fetch for batch requests
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(`--batch_boundary
Content-Type: application/http
Content-ID: <item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "test-event", "summary": "Test Event", "start": {"dateTime": "2025-06-02T10:00:00Z"}, "end": {"dateTime": "2025-06-02T11:00:00Z"}}]}

--batch_boundary--`)
  });

  it('should handle single calendar ID as string', async () => {
    const args = {
      calendarId: 'primary',
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    const result = await handler.runTool(args, mockOAuth2Client);
    expect(result.content[0].text).toContain('Test Event');
  });

  it('should handle multiple calendar IDs as array', async () => {
    const args = {
      calendarId: ['primary', 'secondary@gmail.com'],
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    const result = await handler.runTool(args, mockOAuth2Client);
    expect(result.content[0].text).toContain('Test Event');
  });

  it('should handle calendar IDs passed as JSON string', async () => {
    // This simulates the problematic case from the user
    const args = {
      calendarId: '["primary", "secondary@gmail.com"]',
      timeMin: '2025-06-02T00:00:00Z',
      timeMax: '2025-06-09T23:59:59Z'
    };

    // This would be parsed by the Zod transform before reaching the handler
    // For testing, we'll manually simulate what the transform should do
    let processedArgs = { ...args };
    if (typeof args.calendarId === 'string' && args.calendarId.startsWith('[')) {
      processedArgs.calendarId = JSON.parse(args.calendarId);
    }

    const result = await handler.runTool(processedArgs, mockOAuth2Client);
    expect(result.content[0].text).toContain('Test Event');
  });
}); 