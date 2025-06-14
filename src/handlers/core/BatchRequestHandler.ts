import { OAuth2Client } from "google-auth-library";

export interface BatchRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
}

export interface BatchResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  error?: any;
}

export interface BatchError {
  calendarId?: string;
  statusCode: number;
  message: string;
  details?: any;
}

export class BatchRequestError extends Error {
  constructor(
    message: string,
    public errors: BatchError[],
    public partial: boolean = false
  ) {
    super(message);
    this.name = 'BatchRequestError';
  }
}

export class BatchRequestHandler {
  private readonly batchEndpoint = "https://www.googleapis.com/batch/calendar/v3";
  private readonly boundary: string;
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000; // 1 second

  constructor(private auth: OAuth2Client) {
    this.boundary = "batch_boundary_" + Date.now();
  }

  async executeBatch(requests: BatchRequest[]): Promise<BatchResponse[]> {
    if (requests.length === 0) {
      return [];
    }

    if (requests.length > 50) {
      throw new Error('Batch requests cannot exceed 50 requests per batch');
    }

    return this.executeBatchWithRetry(requests, 0);
  }

  private async executeBatchWithRetry(requests: BatchRequest[], attempt: number): Promise<BatchResponse[]> {
    try {
      const batchBody = this.createBatchBody(requests);
      const token = await this.auth.getAccessToken();
      
      const response = await fetch(this.batchEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token.token}`,
          "Content-Type": `multipart/mixed; boundary=${this.boundary}`
        },
        body: batchBody
      });

      const responseText = await response.text();

      // Handle rate limiting with retry
      if (response.status === 429 && attempt < this.maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : this.baseDelay * Math.pow(2, attempt);
        
        process.stderr.write(`Rate limited, retrying after ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})\n`);
        await this.sleep(delay);
        return this.executeBatchWithRetry(requests, attempt + 1);
      }

      if (!response.ok) {
        throw new BatchRequestError(
          `Batch request failed: ${response.status} ${response.statusText}`,
          [{
            statusCode: response.status,
            message: `HTTP ${response.status}: ${response.statusText}`,
            details: responseText
          }]
        );
      }

      return this.parseBatchResponse(responseText);
    } catch (error) {
      if (error instanceof BatchRequestError) {
        throw error;
      }
      
      // Retry on network errors
      if (attempt < this.maxRetries && this.isRetryableError(error)) {
        const delay = this.baseDelay * Math.pow(2, attempt);
        process.stderr.write(`Network error, retrying after ${delay}ms (attempt ${attempt + 1}/${this.maxRetries}): ${error instanceof Error ? error.message : 'Unknown error'}\n`);
        await this.sleep(delay);
        return this.executeBatchWithRetry(requests, attempt + 1);
      }
      
      // Handle network or auth errors
      throw new BatchRequestError(
        `Failed to execute batch request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        [{
          statusCode: 0,
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error
        }]
      );
    }
  }

  private isRetryableError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('network') || 
             message.includes('timeout') || 
             message.includes('econnreset') ||
             message.includes('enotfound');
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createBatchBody(requests: BatchRequest[]): string {
    return requests.map((req, index) => {
      const parts = [
        `--${this.boundary}`,
        `Content-Type: application/http`,
        `Content-ID: <item${index + 1}>`,
        "",
        `${req.method} ${req.path} HTTP/1.1`
      ];

      if (req.headers) {
        Object.entries(req.headers).forEach(([key, value]) => {
          parts.push(`${key}: ${value}`);
        });
      }

      if (req.body) {
        parts.push("Content-Type: application/json");
        parts.push("");
        parts.push(JSON.stringify(req.body));
      }

      return parts.join("\r\n");
    }).join("\r\n\r\n") + `\r\n--${this.boundary}--`;
  }

  private parseBatchResponse(responseText: string): BatchResponse[] {
    // First, try to find boundary from Content-Type header in the response
    // Google's responses typically have boundary in the first few lines
    const lines = responseText.split(/\r?\n/);
    let boundary = null;
    
    // Look for Content-Type header with boundary in the first few lines
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      if (line.toLowerCase().includes('content-type:') && line.includes('boundary=')) {
        const boundaryMatch = line.match(/boundary=([^\s\r\n;]+)/);
        if (boundaryMatch) {
          boundary = boundaryMatch[1];
          break;
        }
      }
    }
    
    // If not found in headers, try to find boundary markers in the content
    if (!boundary) {
      const boundaryMatch = responseText.match(/--([a-zA-Z0-9_-]+)/);
      if (boundaryMatch) {
        boundary = boundaryMatch[1];
      }
    }
    
    if (!boundary) {
      throw new Error('Could not find boundary in batch response');
    }
    
    // Split by boundary markers
    const parts = responseText.split(`--${boundary}`);
    
    const responses: BatchResponse[] = [];
    
    // Skip the first part (before the first boundary) and the last part (after final boundary with --)
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      // Skip empty parts or the final boundary marker
      if (part.trim() === '' || part.trim() === '--' || part.trim().startsWith('--')) continue;
      
      const response = this.parseResponsePart(part);
      if (response) {
        responses.push(response);
      }
    }
    
    return responses;
  }

  private parseResponsePart(part: string): BatchResponse | null {
    // Handle both \r\n and \n line endings
    const lines = part.split(/\r?\n/);
    
    // Find the HTTP response line (look for "HTTP/1.1")
    let httpLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('HTTP/1.1')) {
        httpLineIndex = i;
        break;
      }
    }

    if (httpLineIndex === -1) return null;

    // Parse status code from HTTP response line
    const httpLine = lines[httpLineIndex];
    const statusMatch = httpLine.match(/HTTP\/1\.1 (\d+)/);
    if (!statusMatch) return null;
    
    const statusCode = parseInt(statusMatch[1]);

    // Parse response headers (start after HTTP line, stop at empty line)
    const headers: Record<string, string> = {};
    let bodyStartIndex = httpLineIndex + 1;
    
    for (let i = httpLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        bodyStartIndex = i + 1;
        break;
      }
      
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    // Parse body - everything after the empty line following headers
    let body: any = null;
    if (bodyStartIndex < lines.length) {
      // Collect all body lines, filtering out empty lines at the end
      const bodyLines = [];
      for (let i = bodyStartIndex; i < lines.length; i++) {
        bodyLines.push(lines[i]);
      }
      
      // Remove trailing empty lines
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
        bodyLines.pop();
      }
      
      if (bodyLines.length > 0) {
        const bodyText = bodyLines.join('\n');
        if (bodyText.trim()) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            // If JSON parsing fails, return the raw text
            body = bodyText;
          }
        }
      }
    }

    return {
      statusCode,
      headers,
      body
    };
  }
} 