# Security Hardening Guide

This document provides a comprehensive security review and hardening recommendations for the Google Calendar MCP Server before production deployment.

## Executive Summary

**Current Security Posture:** The server has reasonable security for local `stdio` usage but requires significant hardening for production HTTP deployment.

**Critical Issues Found:** 5 High, 3 Medium, 2 Low
**Estimated Time to Harden:** 8-12 hours

---

## Table of Contents

1. [Critical Vulnerabilities](#critical-vulnerabilities)
2. [High Priority Issues](#high-priority-issues)
3. [Medium Priority Issues](#medium-priority-issues)
4. [Low Priority Issues](#low-priority-issues)
5. [Security Checklist](#security-checklist)
6. [Implementation Guides](#implementation-guides)
7. [Security Best Practices](#security-best-practices)

---

## Critical Vulnerabilities

### 🔴 CRITICAL 1: No Authentication on HTTP Endpoint

**File:** [src/transports/http.ts](../src/transports/http.ts#L31-L114)

**Issue:**
The HTTP transport has NO authentication mechanism. Anyone with the server URL can:
- List all calendars
- Read all calendar events
- Create, modify, delete events
- Query free/busy information

**Risk:** Complete data breach and calendar manipulation

**Impact:** CRITICAL - Full unauthorized access to user calendar data

**Current Code:**
```typescript
// src/transports/http.ts:98
try {
  await transport.handleRequest(req, res);  // No auth check!
} catch (error) {
  // ... error handling
}
```

**Fix Required:**
```typescript
// Add before transport.handleRequest()
const authHeader = req.headers.authorization;
const expectedToken = process.env.MCP_API_KEY;

if (!expectedToken) {
  throw new Error('MCP_API_KEY not configured - server cannot start');
}

if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="MCP Server"'
  });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32600,
      message: 'Unauthorized: Invalid or missing API key'
    },
    id: null
  }));
  return;
}
```

**Implementation Steps:**
1. Add authentication middleware to HTTP transport
2. Generate secure API key: `openssl rand -hex 32`
3. Store in environment variable: `MCP_API_KEY`
4. Update clients to include `Authorization: Bearer <key>` header
5. Document in README.md

**Priority:** MUST FIX before any HTTP deployment

---

### 🔴 CRITICAL 2: Tokens Stored in Plain Text

**File:** [src/auth/tokenManager.ts](../src/auth/tokenManager.ts#L75-L80)

**Issue:**
OAuth refresh tokens are stored unencrypted in JSON files with only file permissions (0o600) as protection.

```typescript
// Line 77-79
await fs.writeFile(this.tokenPath, JSON.stringify(multiAccountTokens, null, 2), {
  mode: 0o600,  // Only file permissions, no encryption
});
```

**Risk:** Token theft via:
- File system access
- Backup exposure
- Container escape
- Memory dumps

**Impact:** CRITICAL - Stolen tokens = full calendar access until revoked

**Fix Required:**
```typescript
import crypto from 'crypto';

// Encryption functions
function encryptToken(token: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    data: encrypted,
    tag: authTag.toString('hex')
  });
}

function decryptToken(encryptedData: string, key: Buffer): string {
  const { iv, data, tag } = JSON.parse(encryptedData);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Get encryption key from environment or key management service
function getEncryptionKey(): Buffer {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('TOKEN_ENCRYPTION_KEY not set');
  }
  return Buffer.from(keyHex, 'hex');
}

// Update saveMultiAccountTokens
private async saveMultiAccountTokens(multiAccountTokens: MultiAccountTokens): Promise<void> {
  await this.ensureTokenDirectoryExists();

  const key = getEncryptionKey();
  const tokensJson = JSON.stringify(multiAccountTokens);
  const encrypted = encryptToken(tokensJson, key);

  await fs.writeFile(this.tokenPath, encrypted, { mode: 0o600 });
}

// Update loadMultiAccountTokens
private async loadMultiAccountTokens(): Promise<MultiAccountTokens> {
  try {
    const encrypted = await fs.readFile(this.tokenPath, "utf-8");
    const key = getEncryptionKey();
    const decrypted = decryptToken(encrypted, key);
    return JSON.parse(decrypted);
  } catch (error: unknown) {
    // ... error handling
  }
}
```

**Key Generation:**
```bash
# Generate 256-bit encryption key
openssl rand -hex 32

# Set as environment variable
export TOKEN_ENCRYPTION_KEY="your-generated-key-here"
```

**Priority:** MUST FIX before production deployment

---

### 🔴 CRITICAL 3: CORS Wildcard Origin

**File:** [src/transports/http.ts](../src/transports/http.ts#L64)

**Issue:**
CORS is set to allow ALL origins (`*`), defeating the origin validation on line 42.

```typescript
// Line 64 - DANGEROUS!
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Risk:**
- Any website can call your MCP server
- CSRF attacks possible
- Origin validation (lines 32-49) is bypassed
- Credential theft via malicious sites

**Impact:** HIGH - Cross-site attacks, credential theft

**Fix Required:**
```typescript
// Remove wildcard CORS
// Line 64: DELETE this line
// res.setHeader('Access-Control-Allow-Origin', '*');

// Replace with specific origin handling
const origin = req.headers.origin;
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];

// For production, require explicit allowlist
if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  throw new Error('ALLOWED_ORIGINS must be set in production');
}

// Allow localhost in development
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
    'https://127.0.0.1:3000'
  );
}

if (origin && allowedOrigins.some(allowed =>
  origin === allowed || origin.startsWith(allowed)
)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
} else if (origin) {
  // Origin present but not allowed
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Forbidden',
    message: 'Origin not allowed'
  }));
  return;
}

// Only set credentials header if origin is validated
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

**Environment Setup:**
```bash
# Development
ALLOWED_ORIGINS=http://localhost:3000,https://claude.ai

# Production
ALLOWED_ORIGINS=https://your-app.com,https://api.openai.com
```

**Priority:** MUST FIX before HTTP deployment

---

### 🔴 CRITICAL 4: OAuth Credentials in Environment Variables

**File:** [src/auth/utils.ts](../src/auth/utils.ts#L42)

**Issue:**
OAuth credentials are loaded from `GOOGLE_OAUTH_CREDENTIALS` environment variable, which:
- Appears in process listings
- Logged by many deployment platforms
- Stored in CI/CD logs
- Visible in container inspect output

```typescript
// Line 42
const envCredentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS;
```

**Risk:**
- Credential exposure in logs
- CI/CD secret leaks
- Process memory dumps
- Container inspection

**Impact:** HIGH - Credential compromise

**Fix Required:**

**Option 1: Use Secret Management (Recommended)**
```typescript
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

async function loadCredentialsFromSecretManager(): Promise<OAuthCredentials> {
  const provider = process.env.SECRET_PROVIDER; // 'gcp' | 'aws' | 'azure'
  const secretName = process.env.OAUTH_SECRET_NAME;

  switch (provider) {
    case 'gcp':
      const client = new SecretManagerServiceClient();
      const [version] = await client.accessSecretVersion({
        name: secretName
      });
      const payload = version.payload?.data?.toString();
      return JSON.parse(payload!);

    case 'aws':
      const ssm = new SSMClient({});
      const command = new GetParameterCommand({
        Name: secretName,
        WithDecryption: true
      });
      const response = await ssm.send(command);
      return JSON.parse(response.Parameter!.Value!);

    default:
      throw new Error('SECRET_PROVIDER must be set to gcp, aws, or azure');
  }
}
```

**Option 2: Encrypted File (Better than current)**
```typescript
// Store credentials in encrypted file
const credentialsPath = '/secure/encrypted-credentials.json.enc';

function decryptCredentials(encryptedPath: string): OAuthCredentials {
  const encrypted = fs.readFileSync(encryptedPath, 'utf8');
  const key = getEncryptionKey(); // From TOKEN_ENCRYPTION_KEY env var
  const decrypted = decryptToken(encrypted, key);
  return JSON.parse(decrypted);
}
```

**Option 3: File Path Only (Minimum fix)**
```typescript
// ONLY accept file paths, never raw JSON in env vars
function getKeysFilePath(): string {
  const path = process.env.GOOGLE_OAUTH_CREDENTIALS_PATH;

  // REJECT if value looks like JSON content
  if (path && (path.trim().startsWith('{') || path.trim().startsWith('['))) {
    throw new Error(
      'GOOGLE_OAUTH_CREDENTIALS_PATH must be a file path, not JSON content. ' +
      'Store credentials in a file and provide the path.'
    );
  }

  return path || './gcp-oauth.keys.json';
}
```

**Priority:** FIX before cloud deployment

---

### 🔴 CRITICAL 5: No Rate Limiting

**File:** [src/transports/http.ts](../src/transports/http.ts)

**Issue:**
No rate limiting on HTTP endpoint allows:
- DoS attacks
- Resource exhaustion
- Google API quota exhaustion
- Cost explosion (for cloud deployments)

**Risk:**
- Server crashes from request floods
- Google Calendar API quota violations
- Unexpected cloud bills
- Service unavailability

**Impact:** HIGH - Service disruption and cost

**Fix Required:**

**Option 1: Simple In-Memory Rate Limiter**
```typescript
import crypto from 'crypto';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Cleanup old records every minute
    setInterval(() => this.cleanup(), 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (now > record.resetTime) {
        this.records.delete(key);
      }
    }
  }

  private getClientId(req: http.IncomingMessage): string {
    // Use API key if present, otherwise IP
    const authHeader = req.headers.authorization;
    if (authHeader) {
      return crypto.createHash('sha256').update(authHeader).digest('hex');
    }

    // Get real IP (behind proxy)
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = forwardedFor
      ? (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0])
      : req.socket.remoteAddress;

    return ip || 'unknown';
  }

  check(req: http.IncomingMessage): { allowed: boolean; resetTime?: number } {
    const clientId = this.getClientId(req);
    const now = Date.now();
    const record = this.records.get(clientId);

    if (!record || now > record.resetTime) {
      // New window
      this.records.set(clientId, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return { allowed: true };
    }

    if (record.count >= this.maxRequests) {
      return {
        allowed: false,
        resetTime: record.resetTime
      };
    }

    record.count++;
    return { allowed: true };
  }
}

// Add to HTTP transport
const rateLimiter = new RateLimiter(
  60000,  // 1 minute window
  parseInt(process.env.RATE_LIMIT_MAX || '100', 10)
);

// In request handler (after auth check):
const rateLimitCheck = rateLimiter.check(req);
if (!rateLimitCheck.allowed) {
  const retryAfter = Math.ceil((rateLimitCheck.resetTime! - Date.now()) / 1000);

  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': retryAfter.toString(),
    'X-RateLimit-Limit': process.env.RATE_LIMIT_MAX || '100',
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': new Date(rateLimitCheck.resetTime!).toISOString()
  });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32600,
      message: 'Too many requests. Please try again later.'
    },
    id: null
  }));
  return;
}
```

**Option 2: Use express-rate-limit (if migrating to Express)**
```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/mcp', limiter);
```

**Configuration:**
```bash
# Environment variables
RATE_LIMIT_WINDOW_MS=60000    # 1 minute
RATE_LIMIT_MAX=100            # requests per window
RATE_LIMIT_SKIP_FAILED=false  # count failed requests
```

**Priority:** MUST FIX before production

---

## High Priority Issues

### 🟠 HIGH 1: Insufficient Input Validation

**Files:** Multiple handlers in [src/handlers/core/](../src/handlers/core/)

**Issue:**
While Zod schemas validate structure, some handlers don't sanitize or validate semantic correctness:

**Examples:**
```typescript
// No validation of email format in attendees
// src/handlers/core/CreateEventHandler.ts
attendees: z.array(z.object({
  email: z.string(),  // Should validate email format
  optional: z.boolean().optional()
})).optional()

// No validation of URL format
location: z.string().optional()  // Could be a XSS vector

// No validation of HTML in descriptions
description: z.string().optional()  // Could contain malicious HTML
```

**Risk:**
- XSS attacks via event descriptions
- Email spoofing
- Calendar pollution
- Injection attacks

**Impact:** MEDIUM - Data integrity issues

**Fix Required:**
```typescript
import validator from 'validator';

// Email validation
attendees: z.array(z.object({
  email: z.string().email().refine(
    (email) => validator.isEmail(email),
    { message: 'Invalid email format' }
  ),
  optional: z.boolean().optional()
})).optional()

// Sanitize HTML in descriptions
import DOMPurify from 'isomorphic-dompurify';

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'br', 'p', 'a'],
    ALLOWED_ATTR: ['href']
  });
}

// In handler
if (args.description) {
  args.description = sanitizeHtml(args.description);
}

// URL validation
if (args.location && args.location.startsWith('http')) {
  if (!validator.isURL(args.location)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Invalid URL in location');
  }
}

// String length limits
summary: z.string().min(1).max(1000),
description: z.string().max(8192).optional(),
location: z.string().max(500).optional()
```

**Priority:** HIGH - Implement before external exposure

---

### 🟠 HIGH 2: No Request Size Limits on Tool Calls

**File:** [src/transports/http.ts](../src/transports/http.ts#L51-L61)

**Issue:**
Request size limit (10MB) is only on HTTP body, but individual tool calls within MCP protocol can be unlimited.

```typescript
// Line 52-54: Good
const contentLength = parseInt(req.headers['content-length'] || '0', 10);
const maxRequestSize = 10 * 1024 * 1024; // 10MB limit
if (contentLength > maxRequestSize) { ... }

// BUT: No limit on individual tool arguments
// Example: Someone could call create-event with 1GB description
```

**Risk:**
- Memory exhaustion
- DoS attacks
- Google API errors (payload too large)

**Impact:** MEDIUM - Service disruption

**Fix Required:**
```typescript
// In BaseToolHandler or individual handlers
const MAX_STRING_LENGTH = 100_000; // 100KB
const MAX_ARRAY_LENGTH = 1000;
const MAX_OBJECT_DEPTH = 10;

function validatePayloadSize(args: any, depth = 0): void {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Request structure too deeply nested'
    );
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Field '${key}' exceeds maximum length of ${MAX_STRING_LENGTH} characters`
      );
    }

    if (Array.isArray(value) && value.length > MAX_ARRAY_LENGTH) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Array '${key}' exceeds maximum length of ${MAX_ARRAY_LENGTH} items`
      );
    }

    if (typeof value === 'object' && value !== null) {
      validatePayloadSize(value, depth + 1);
    }
  }
}

// In each handler's runTool method:
async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
  validatePayloadSize(args);
  // ... rest of handler
}
```

**Priority:** HIGH - Implement before production

---

### 🟠 HIGH 3: Logging Contains Sensitive Data

**Files:** Multiple files with `process.stderr.write()`

**Issue:**
Sensitive data is logged throughout the application:

```typescript
// src/auth/tokenManager.ts:98
process.stderr.write(`Tokens updated and saved for ${this.accountMode} account\n`);

// src/auth/server.ts:197
process.stderr.write(`\n🔗 Authentication URL: ${authorizeUrl}\n\n`);
// ^ This URL contains client_id and other sensitive params

// Could be worse if error logging includes full request bodies
```

**Risk:**
- Token exposure in logs
- Credential leaks
- User data exposure
- Compliance violations (GDPR, HIPAA)

**Impact:** MEDIUM - Data leak

**Fix Required:**
```typescript
// Create logging utility
// src/utils/logger.ts

const SENSITIVE_PATTERNS = [
  /access_token=[^&]+/gi,
  /refresh_token=[^&]+/gi,
  /client_secret=[^&]+/gi,
  /code=[^&]+/gi,
  /key=[^&]+/gi,
  /password=[^&]+/gi,
  /bearer [a-zA-Z0-9._-]+/gi
];

function sanitizeLogMessage(message: string): string {
  let sanitized = message;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const [key] = match.split('=');
      return `${key}=***REDACTED***`;
    });
  }

  return sanitized;
}

export function logInfo(message: string): void {
  const sanitized = sanitizeLogMessage(message);
  process.stderr.write(`[INFO] ${sanitized}\n`);
}

export function logError(message: string, error?: Error): void {
  const sanitized = sanitizeLogMessage(message);
  process.stderr.write(`[ERROR] ${sanitized}\n`);

  if (error && process.env.NODE_ENV !== 'production') {
    // Only log full errors in development
    process.stderr.write(`${error.stack}\n`);
  }
}

// Update all logging calls:
import { logInfo, logError } from './utils/logger.js';

// Before: process.stderr.write(`Tokens updated\n`);
// After:  logInfo('Tokens updated for account');
```

**Priority:** HIGH - Critical for compliance

---

## Medium Priority Issues

### 🟡 MEDIUM 1: No Security Headers

**File:** [src/transports/http.ts](../src/transports/http.ts)

**Issue:**
HTTP responses lack security headers:

```typescript
// Missing security headers:
// - X-Content-Type-Options
// - X-Frame-Options
// - X-XSS-Protection
// - Strict-Transport-Security
// - Content-Security-Policy
```

**Risk:** Clickjacking, MIME sniffing, XSS

**Impact:** LOW-MEDIUM - Client-side attacks

**Fix Required:**
```typescript
// Add security headers to all responses
function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Remove server fingerprinting
  res.removeHeader('X-Powered-By');
}

// Call in request handler:
setSecurityHeaders(res);
```

**Priority:** MEDIUM

---

### 🟡 MEDIUM 2: Weak Session Management (Auth Server)

**File:** [src/auth/server.ts](../src/auth/server.ts)

**Issue:**
OAuth callback server has no:
- CSRF protection
- State parameter validation
- Nonce validation
- Session timeout

```typescript
// Line 48-54: Missing state validation
const code = url.searchParams.get('code');
// Should also validate 'state' parameter
```

**Risk:** CSRF attacks, session hijacking

**Impact:** MEDIUM - OAuth flow compromise

**Fix Required:**
```typescript
import crypto from 'crypto';

private pendingAuthStates = new Map<string, {
  created: number;
  clientId: string;
}>();

// In generateAuthUrl:
private generateAuthUrl(oauth2Client: OAuth2Client): string {
  const state = crypto.randomBytes(32).toString('hex');

  // Store state with 5 minute expiry
  this.pendingAuthStates.set(state, {
    created: Date.now(),
    clientId: oauth2Client._clientId!
  });

  // Cleanup old states
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of this.pendingAuthStates.entries()) {
    if (value.created < fiveMinutesAgo) {
      this.pendingAuthStates.delete(key);
    }
  }

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
    state: state  // Add state parameter
  });
}

// In oauth2callback handler:
const code = url.searchParams.get('code');
const state = url.searchParams.get('state');

if (!state || !this.pendingAuthStates.has(state)) {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end('Invalid or expired authentication state');
  return;
}

// Validate state and remove
const stateData = this.pendingAuthStates.get(state)!;
this.pendingAuthStates.delete(state);

// Check state age (max 5 minutes)
if (Date.now() - stateData.created > 5 * 60 * 1000) {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end('Authentication state expired');
  return;
}

// Continue with token exchange...
```

**Priority:** MEDIUM

---

### 🟡 MEDIUM 3: No Audit Logging

**Files:** All handlers

**Issue:**
No audit trail for:
- Who accessed what calendar
- What events were created/modified/deleted
- Authentication attempts
- Authorization failures

**Risk:**
- Cannot detect breaches
- Cannot investigate incidents
- Compliance violations
- No accountability

**Impact:** MEDIUM - Forensics impossible

**Fix Required:**
```typescript
// src/utils/audit-logger.ts

interface AuditEvent {
  timestamp: string;
  userId: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

class AuditLogger {
  private logPath: string;

  constructor() {
    this.logPath = process.env.AUDIT_LOG_PATH || './audit.log';
  }

  async log(event: AuditEvent): Promise<void> {
    const logLine = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    });

    await fs.appendFile(this.logPath, logLine + '\n');

    // Also send to external logging service in production
    if (process.env.NODE_ENV === 'production' && process.env.AUDIT_LOG_URL) {
      await fetch(process.env.AUDIT_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: logLine
      });
    }
  }
}

export const auditLogger = new AuditLogger();

// In each handler:
async runTool(args: any, oauth2Client: OAuth2Client): Promise<CallToolResult> {
  const startTime = Date.now();

  try {
    const result = await this.executeToolLogic(args, oauth2Client);

    await auditLogger.log({
      userId: await this.getUserId(oauth2Client),
      action: 'calendar.event.create',
      resource: `calendar:${args.calendarId}`,
      result: 'success',
      details: {
        eventId: result.eventId,
        duration: Date.now() - startTime
      }
    });

    return result;
  } catch (error) {
    await auditLogger.log({
      userId: await this.getUserId(oauth2Client),
      action: 'calendar.event.create',
      resource: `calendar:${args.calendarId}`,
      result: 'failure',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      }
    });

    throw error;
  }
}
```

**Priority:** MEDIUM (HIGH for compliance-sensitive deployments)

---

## Low Priority Issues

### 🟢 LOW 1: Timing Attack Vulnerability in Token Comparison

**File:** Future authentication implementation

**Issue:**
When comparing API keys or tokens, standard string comparison (`===`) is vulnerable to timing attacks.

**Risk:** Token brute-forcing (theoretical)

**Impact:** LOW - Requires local network access

**Fix Required:**
```typescript
import crypto from 'crypto';

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(a, 'utf8'),
    Buffer.from(b, 'utf8')
  );
}

// Use in authentication
if (!constantTimeCompare(providedKey, expectedKey)) {
  // Unauthorized
}
```

**Priority:** LOW

---

### 🟢 LOW 2: Error Messages Leak Information

**Files:** Multiple handlers

**Issue:**
Some error messages reveal too much about system internals:

```typescript
// Bad: Reveals file paths
throw new Error(`Token file not found at: ${this.tokenPath}`);

// Bad: Reveals database structure
throw new Error(`Failed to query calendar_events table`);

// Bad: Reveals Google API details
throw new Error(`Google API returned: ${response.data.error.message}`);
```

**Risk:** Information disclosure aids attackers

**Impact:** LOW - Minor information leak

**Fix Required:**
```typescript
// Good: Generic message for users, detailed for logs
function handleError(error: Error, context: string): never {
  // Log detailed error internally
  logError(`${context}: ${error.message}`, error);

  // Return generic error to client
  if (process.env.NODE_ENV === 'production') {
    throw new McpError(
      ErrorCode.InternalError,
      'An error occurred processing your request. Please try again.'
    );
  } else {
    // More details in development
    throw new McpError(
      ErrorCode.InternalError,
      `${context}: ${error.message}`
    );
  }
}
```

**Priority:** LOW

---

## Security Checklist

Use this checklist before deploying to production:

### Authentication & Authorization
- [ ] **API key authentication** implemented on HTTP endpoint
- [ ] **API keys** generated with cryptographically secure random (min 32 bytes)
- [ ] **API keys** stored in secrets manager, not environment variables
- [ ] **OAuth tokens** encrypted at rest with AES-256-GCM
- [ ] **Encryption keys** rotated every 90 days
- [ ] **Token expiry** enforced (Google test mode tokens expire in 7 days)
- [ ] **Multi-user support** implemented with per-user token storage
- [ ] **RBAC** (Role-Based Access Control) if multiple users

### Network Security
- [ ] **HTTPS only** (TLS 1.2 minimum, TLS 1.3 preferred)
- [ ] **CORS properly configured** (no wildcard `*`)
- [ ] **ALLOWED_ORIGINS** environment variable set
- [ ] **Rate limiting** implemented (100 req/min recommended)
- [ ] **Request size limits** enforced (10MB HTTP, 100KB tool args)
- [ ] **Security headers** added to all responses
- [ ] **Origin validation** working correctly

### Input Validation
- [ ] **All inputs** validated with Zod schemas
- [ ] **Email addresses** validated (regex + DNS check)
- [ ] **URLs** validated and sanitized
- [ ] **HTML content** sanitized (DOMPurify or similar)
- [ ] **String length limits** enforced on all fields
- [ ] **Array/object depth** limited to prevent DoS
- [ ] **Calendar IDs** validated against allowed list

### Secrets Management
- [ ] **OAuth credentials** never in environment variables
- [ ] **Secrets** stored in KMS/Secret Manager
- [ ] **Secrets** encrypted in transit and at rest
- [ ] **Secrets** not logged or exposed in errors
- [ ] **File permissions** set to 0600 for sensitive files
- [ ] **.gitignore** includes all credential files

### Logging & Monitoring
- [ ] **Audit logging** implemented for all data access
- [ ] **Sensitive data** redacted from logs
- [ ] **Log aggregation** configured (CloudWatch, Datadog, etc.)
- [ ] **Alerting** setup for auth failures, rate limits, errors
- [ ] **Monitoring** for unusual access patterns
- [ ] **Log retention** policy defined (90 days recommended)

### Google Calendar API
- [ ] **Quota project** configured to avoid rate limits
- [ ] **Scopes** limited to minimum required
- [ ] **Production OAuth** app verified (or published)
- [ ] **Test users** removed before production
- [ ] **API timeouts** configured (3 seconds)
- [ ] **Retry logic** with exponential backoff
- [ ] **Error handling** doesn't expose Google API details

### Container/Deployment Security
- [ ] **Non-root user** in Docker (nodejs:nodejs)
- [ ] **Base image** scanned for vulnerabilities
- [ ] **Dependencies** audited (`npm audit`)
- [ ] **Secrets** injected at runtime, not baked into image
- [ ] **Read-only filesystem** where possible
- [ ] **Network policies** restrict outbound connections
- [ ] **Health checks** configured

### Code Security
- [ ] **Dependencies** up to date
- [ ] **Known vulnerabilities** resolved (`npm audit fix`)
- [ ] **No hardcoded credentials** in code
- [ ] **Environment-specific configs** separated
- [ ] **TypeScript strict mode** enabled
- [ ] **ESLint security rules** configured
- [ ] **Static analysis** run (Semgrep, Snyk)

### Incident Response
- [ ] **Security contact** documented
- [ ] **Incident response plan** created
- [ ] **Token revocation** procedure documented
- [ ] **Backup/restore** tested
- [ ] **Disaster recovery** plan in place

---

## Implementation Guides

### Quick Start: Minimum Security (30 minutes)

These are the ABSOLUTE MINIMUM changes required before deploying:

```bash
# 1. Generate API key
openssl rand -hex 32 > .mcp-api-key
chmod 600 .mcp-api-key
export MCP_API_KEY=$(cat .mcp-api-key)

# 2. Generate encryption key
openssl rand -hex 32 > .token-encryption-key
chmod 600 .token-encryption-key
export TOKEN_ENCRYPTION_KEY=$(cat .token-encryption-key)

# 3. Set allowed origins
export ALLOWED_ORIGINS="https://your-app.com,https://api.openai.com"

# 4. Enable production mode
export NODE_ENV=production

# 5. Apply critical patches (see files below)
```

**Files to modify:**
1. `src/transports/http.ts` - Add authentication (see Critical #1)
2. `src/transports/http.ts` - Fix CORS (see Critical #3)
3. `src/auth/tokenManager.ts` - Encrypt tokens (see Critical #2)

### Full Hardening Guide (8-12 hours)

For a production-ready deployment with all security best practices:

**Phase 1: Critical Fixes (2-3 hours)**
1. Implement API key authentication
2. Implement token encryption
3. Fix CORS configuration
4. Add rate limiting
5. Move credentials to secrets manager

**Phase 2: High Priority (3-4 hours)**
6. Add input sanitization
7. Implement request size validation
8. Create logging utility with redaction
9. Add security headers
10. Implement CSRF protection for OAuth

**Phase 3: Medium Priority (2-3 hours)**
11. Implement audit logging
12. Add monitoring/alerting
13. Configure log aggregation
14. Document incident response
15. Security testing

**Phase 4: Deployment (1-2 hours)**
16. Configure secrets in production
17. Set up monitoring dashboards
18. Test authentication flow
19. Test rate limiting
20. Verify all security headers

---

## Security Best Practices

### Development
- **Never commit secrets** to version control
- **Use `.env.example`** with placeholder values
- **Rotate development credentials** regularly
- **Use separate credentials** for dev/staging/prod
- **Enable strict TypeScript** checking
- **Run security linters** (ESLint security plugins)

### Deployment
- **Use secrets managers** (AWS Secrets Manager, GCP Secret Manager)
- **Enable TLS 1.3** on all endpoints
- **Configure WAF** (Web Application Firewall) if available
- **Use least-privilege IAM** roles
- **Enable audit logging** on infrastructure
- **Implement network segmentation**

### Operations
- **Monitor security alerts** (GitHub Dependabot, Snyk)
- **Patch vulnerabilities** within 7 days (critical), 30 days (others)
- **Review audit logs** weekly
- **Test incident response** quarterly
- **Conduct security reviews** before major releases
- **Keep dependencies updated** (monthly)

### Google Calendar API
- **Use service accounts** for server-to-server (if applicable)
- **Limit OAuth scopes** to minimum required
- **Implement quota monitoring**
- **Handle rate limits** gracefully with backoff
- **Validate calendar ownership** before modifications
- **Cache calendar lists** to reduce API calls

---

## Testing Security

### Manual Testing

```bash
# Test 1: Authentication required
curl http://localhost:3000 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 401 Unauthorized

# Test 2: Valid authentication
curl http://localhost:3000 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 200 OK with tool list

# Test 3: Rate limiting
for i in {1..150}; do
  curl http://localhost:3000/health &
done
wait
# Expected: Some requests return 429 Too Many Requests

# Test 4: Invalid origin (if CORS strict)
curl http://localhost:3000/health \
  -H "Origin: https://evil.com"
# Expected: 403 Forbidden

# Test 5: Request size limit
dd if=/dev/zero bs=1M count=15 | curl http://localhost:3000 \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @-
# Expected: 413 Payload Too Large

# Test 6: Security headers
curl -I http://localhost:3000/health
# Expected: See X-Content-Type-Options, X-Frame-Options, etc.
```

### Automated Testing

```typescript
// tests/security.test.ts
import { describe, it, expect } from 'vitest';

describe('Security Tests', () => {
  it('rejects requests without authentication', async () => {
    const res = await fetch('http://localhost:3000', {
      method: 'POST',
      body: JSON.stringify({jsonrpc:'2.0',method:'tools/list',id:1})
    });
    expect(res.status).toBe(401);
  });

  it('enforces rate limits', async () => {
    const requests = Array(150).fill(null).map(() =>
      fetch('http://localhost:3000/health')
    );
    const responses = await Promise.all(requests);
    const tooMany = responses.filter(r => r.status === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });

  it('validates tokens are encrypted on disk', async () => {
    const tokenPath = '~/.config/google-calendar-mcp/tokens.json';
    const content = await fs.readFile(tokenPath, 'utf8');

    // Should not be plaintext JSON
    expect(() => JSON.parse(content)).toThrow();

    // Should look like encrypted data
    expect(content).toMatch(/^{.*"iv":.*"data":.*"tag":.*}$/);
  });

  it('redacts sensitive data from logs', () => {
    const logMessage = 'Token: access_token=abc123, refresh_token=xyz789';
    const sanitized = sanitizeLogMessage(logMessage);
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('xyz789');
    expect(sanitized).toContain('***REDACTED***');
  });

  it('includes security headers', async () => {
    const res = await fetch('http://localhost:3000/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
  });
});
```

---

## Security Resources

### Standards & Frameworks
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CIS Controls](https://www.cisecurity.org/controls)
- [PCI DSS](https://www.pcisecuritystandards.org/) (if handling payments)
- [GDPR](https://gdpr.eu/) (if EU users)
- [SOC 2](https://us.aicpa.org/interestareas/frc/assuranceadvisoryservices/aicpasoc2report) (for enterprise)

### Tools
- **Static Analysis:** Semgrep, Snyk, SonarQube
- **Dependency Scanning:** `npm audit`, Dependabot, Renovate
- **Container Scanning:** Trivy, Clair, Anchore
- **Penetration Testing:** OWASP ZAP, Burp Suite
- **Secrets Detection:** git-secrets, TruffleHog, GitGuardian

### Google-Specific
- [Google Calendar API Security Best Practices](https://developers.google.com/calendar/api/guides/auth)
- [Google OAuth 2.0 Security](https://developers.google.com/identity/protocols/oauth2)
- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)

---

## Conclusion

Your Google Calendar MCP Server has a solid foundation for local `stdio` usage but requires significant security hardening before production HTTP deployment.

**Priority Actions:**
1. **Implement API authentication** (Critical #1)
2. **Encrypt tokens at rest** (Critical #2)
3. **Fix CORS configuration** (Critical #3)
4. **Add rate limiting** (Critical #5)
5. **Secure credential loading** (Critical #4)

**Timeline:**
- Minimum viable security: 30 minutes - 1 hour
- Production-ready security: 8-12 hours
- Enterprise-grade security: 2-3 days

**Risk Assessment:**
- **Current (stdio):** LOW risk - Local use only
- **HTTP without fixes:** CRITICAL risk - Data breach likely
- **HTTP with minimum fixes:** MEDIUM risk - Acceptable for internal use
- **HTTP with full hardening:** LOW risk - Production ready

For questions or to report security issues, contact: [security@your-domain.com]

---

**Document Version:** 1.0
**Last Updated:** October 2025
**Next Review:** January 2026
