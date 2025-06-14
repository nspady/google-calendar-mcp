/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { BatchRequestHandler, BatchRequest, BatchResponse } from '../../../handlers/core/BatchRequestHandler.js';

describe('BatchRequestHandler', () => {
  let mockOAuth2Client: OAuth2Client;
  let batchHandler: BatchRequestHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOAuth2Client = {
      getAccessToken: vi.fn().mockResolvedValue({ token: 'mock_access_token' })
    } as any;
    batchHandler = new BatchRequestHandler(mockOAuth2Client);
  });

  describe('Batch Request Creation', () => {
    it('should create proper multipart request body with single request', () => {
      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime'
        }
      ];

      const result = (batchHandler as any).createBatchBody(requests);
      const boundary = (batchHandler as any).boundary;

      expect(result).toContain(`--${boundary}`);
      expect(result).toContain('Content-Type: application/http');
      expect(result).toContain('Content-ID: <item1>');
      expect(result).toContain('GET /calendar/v3/calendars/primary/events');
      expect(result).toContain('singleEvents=true');
      expect(result).toContain('orderBy=startTime');
      expect(result).toContain(`--${boundary}--`);
    });

    it('should create proper multipart request body with multiple requests', () => {
      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/primary/events'
        },
        {
          method: 'GET',
          path: '/calendar/v3/calendars/work%40example.com/events'
        },
        {
          method: 'GET',
          path: '/calendar/v3/calendars/personal%40example.com/events'
        }
      ];

      const result = (batchHandler as any).createBatchBody(requests);
      const boundary = (batchHandler as any).boundary;

      expect(result).toContain('Content-ID: <item1>');
      expect(result).toContain('Content-ID: <item2>');
      expect(result).toContain('Content-ID: <item3>');
      expect(result).toContain('calendars/primary/events');
      expect(result).toContain('calendars/work%40example.com/events');
      expect(result).toContain('calendars/personal%40example.com/events');
      
      // Should have proper boundary structure
      const boundaryCount = (result.match(new RegExp(`--${boundary}`, 'g')) || []).length;
      expect(boundaryCount).toBe(4); // 3 request boundaries + 1 end boundary
    });

    it('should handle requests with custom headers', () => {
      const requests: BatchRequest[] = [
        {
          method: 'POST',
          path: '/calendar/v3/calendars/primary/events',
          headers: {
            'If-Match': '"etag123"',
            'X-Custom-Header': 'custom-value'
          }
        }
      ];

      const result = (batchHandler as any).createBatchBody(requests);

      expect(result).toContain('If-Match: "etag123"');
      expect(result).toContain('X-Custom-Header: custom-value');
    });

    it('should handle requests with JSON body', () => {
      const requestBody = {
        summary: 'Test Event',
        start: { dateTime: '2024-01-15T10:00:00Z' },
        end: { dateTime: '2024-01-15T11:00:00Z' }
      };

      const requests: BatchRequest[] = [
        {
          method: 'POST',
          path: '/calendar/v3/calendars/primary/events',
          body: requestBody
        }
      ];

      const result = (batchHandler as any).createBatchBody(requests);

      expect(result).toContain('Content-Type: application/json');
      expect(result).toContain(JSON.stringify(requestBody));
      expect(result).toContain('"summary":"Test Event"');
    });

    it('should encode URLs properly in batch requests', () => {
      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/test%40example.com/events?timeMin=2024-01-01T00%3A00%3A00Z'
        }
      ];

      const result = (batchHandler as any).createBatchBody(requests);

      expect(result).toContain('calendars/test%40example.com/events');
      expect(result).toContain('timeMin=2024-01-01T00%3A00%3A00Z');
    });
  });

  describe('Batch Response Parsing', () => {
    it('should parse successful response correctly', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Length: response_total_content_length
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 123

{
  "items": [
    {
      "id": "event1",
      "summary": "Test Event",
      "start": {"dateTime": "2024-01-15T10:00:00Z"},
      "end": {"dateTime": "2024-01-15T11:00:00Z"}
    }
  ]
}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(200);
      expect(responses[0].body.items).toHaveLength(1);
      expect(responses[0].body.items[0].summary).toBe('Test Event');
    });

    it('should parse multiple responses correctly', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "event1", "summary": "Event 1"}]}

--batch_abc123
Content-Type: application/http
Content-ID: <response-item2>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "event2", "summary": "Event 2"}]}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(2);
      expect(responses[0].body.items[0].summary).toBe('Event 1');
      expect(responses[1].body.items[0].summary).toBe('Event 2');
    });

    it('should handle error responses in batch', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": 404,
    "message": "Calendar not found"
  }
}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(404);
      expect(responses[0].body.error.code).toBe(404);
      expect(responses[0].body.error.message).toBe('Calendar not found');
    });

    it('should handle mixed success and error responses', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "event1", "summary": "Success"}]}

--batch_abc123
Content-Type: application/http
Content-ID: <response-item2>

HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": {
    "code": 403,
    "message": "Access denied"
  }
}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(2);
      expect(responses[0].statusCode).toBe(200);
      expect(responses[0].body.items[0].summary).toBe('Success');
      expect(responses[1].statusCode).toBe(403);
      expect(responses[1].body.error.message).toBe('Access denied');
    });

    it('should handle empty response parts gracefully', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123


--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 200 OK
Content-Type: application/json

{"items": []}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(200);
      expect(responses[0].body.items).toEqual([]);
    });

    it('should handle malformed JSON gracefully', () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http
Content-ID: <response-item1>

HTTP/1.1 200 OK
Content-Type: application/json

{invalid json here}

--batch_abc123--`;

      const responses = (batchHandler as any).parseBatchResponse(mockResponseText);

      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(200);
      expect(responses[0].body).toBe('{invalid json here}');
    });
  });

  describe('Integration Tests', () => {
    it('should execute batch request with mocked fetch', async () => {
      const mockResponseText = `HTTP/1.1 200 OK
Content-Type: multipart/mixed; boundary=batch_abc123

--batch_abc123
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json

{"items": [{"id": "event1", "summary": "Test"}]}

--batch_abc123--`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(mockResponseText)
      });

      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/primary/events'
        }
      ];

      const responses = await batchHandler.executeBatch(requests);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/batch/calendar/v3',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer mock_access_token',
            'Content-Type': expect.stringContaining('multipart/mixed; boundary=')
          })
        })
      );

      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(200);
    });

    it('should handle network errors during batch execution', async () => {
      // Create a handler with no retries for this test
      const noRetryHandler = new BatchRequestHandler(mockOAuth2Client);
      (noRetryHandler as any).maxRetries = 0; // Override max retries
      
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/primary/events'
        }
      ];

      await expect(noRetryHandler.executeBatch(requests))
        .rejects.toThrow('Failed to execute batch request: Network error');
    });

    it('should handle authentication errors', async () => {
      mockOAuth2Client.getAccessToken = vi.fn().mockRejectedValue(
        new Error('Authentication failed')
      );

      const requests: BatchRequest[] = [
        {
          method: 'GET',
          path: '/calendar/v3/calendars/primary/events'
        }
      ];

      await expect(batchHandler.executeBatch(requests))
        .rejects.toThrow('Authentication failed');
    });
  });
}); 