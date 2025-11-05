# MCP Common Pitfalls

Known issues and edge cases in MCP server implementations.

## Protocol Errors

### Missing jsonrpc Field
**Problem:** Responses missing `"jsonrpc": "2.0"` field
**Impact:** Clients reject messages as invalid JSON-RPC
**Fix:** Include in all requests and responses

### Both result and error
**Problem:** Response includes both `result` and `error` fields
**Impact:** Invalid JSON-RPC 2.0 (must be XOR)
**Fix:** Return one or the other, never both

### Skipped initialized Notification
**Problem:** Server doesn't send `initialized` notification after `initialize`
**Impact:** Client waits indefinitely, connection hangs
**Fix:** Always send `initialized` after successful `initialize` response

### Incorrect Error Codes
**Problem:** Using custom codes for standard JSON-RPC errors
**Impact:** Clients misinterpret error types
**Fix:** Use `-32xxx` for protocol errors, positive integers for domain errors

## Capability Issues

### Undeclared Capabilities
**Problem:** Server implements features not declared in `initialize` response
**Impact:** Clients don't discover features, functionality hidden
**Fix:** Declare all capabilities (`tools`, `resources`, `prompts`, etc.)

### Outdated Protocol Version
**Problem:** Using old protocol version string
**Impact:** Missing new features, potential incompatibility
**Fix:** Use latest spec version (currently `"2025-06-18"`)

### Capability Mismatch
**Problem:** Declared capabilities don't match actual implementation
**Impact:** Client calls fail unexpectedly
**Fix:** Keep capability list synchronized with implementation

## Security Gaps

### Missing Consent Workflows
**Problem:** Tool execution without user approval
**Impact:** Unauthorized actions, data leaks, security violations
**Fix:** Require explicit consent before tool execution and data access

### Hardcoded Credentials
**Problem:** API keys, passwords in source code
**Impact:** Credential exposure, security breach
**Fix:** Use environment variables, secure credential storage

### No Input Validation
**Problem:** Accepting unsanitized user input
**Impact:** Injection attacks, crashes, data corruption
**Fix:** Validate all inputs, use schema enforcement

### Output Leakage
**Problem:** Returning sensitive data without sanitization
**Impact:** Data privacy violations
**Fix:** Sanitize outputs, remove sensitive fields

## Transport Layer Issues

### stdout Contamination (stdio)
**Problem:** Logging or debug output to stdout instead of stderr
**Impact:** JSON-RPC messages corrupted, client parsing fails
**Fix:** All logging to stderr, only JSON-RPC to stdout

### Missing Output Flush (stdio)
**Problem:** Buffered output not flushed immediately
**Impact:** Delayed responses, client timeouts
**Fix:** Flush stdout after each message

### CORS Not Configured (HTTP)
**Problem:** Missing CORS headers for browser clients
**Impact:** Browser blocks requests
**Fix:** Configure appropriate CORS headers

### SSE Connection Drops (HTTP)
**Problem:** SSE stream closes unexpectedly
**Impact:** Server can't send notifications to client
**Fix:** Implement keep-alive, reconnection logic

## Tool Implementation

### Missing Input Schema
**Problem:** Tools without proper JSON schema for inputs
**Impact:** Clients can't validate parameters, errors at runtime
**Fix:** Define complete input schema for all tools

### Incorrect Content Type
**Problem:** Returning wrong content type (e.g., object instead of text)
**Impact:** Client can't parse response
**Fix:** Use MCP content types: `text`, `image`, `resource`

### Blocking Operations
**Problem:** Long-running tools block entire server
**Impact:** Other requests timeout, poor performance
**Fix:** Run async, return task ID for long operations

### No Error Context
**Problem:** Generic error messages without details
**Impact:** Users can't debug issues
**Fix:** Include parameter names, expected values in error data

## Resource Implementation

### Invalid URI Schemes
**Problem:** Using unsupported or malformed URI schemes
**Impact:** Clients can't fetch resources
**Fix:** Use valid schemes: custom, `file://`, `https://`

### Large Resources Not Chunked
**Problem:** Returning multi-MB resources in single response
**Impact:** Memory issues, timeouts
**Fix:** Chunk resources >1MB, implement pagination

### Missing Access Control
**Problem:** No authorization checks for sensitive resources
**Impact:** Data leaks
**Fix:** Verify user permissions before returning resource

## Performance Issues

### No Caching
**Problem:** Fetching same data repeatedly from external APIs
**Impact:** Slow responses, API rate limits hit
**Fix:** Implement caching with appropriate TTL

### No Connection Pooling
**Problem:** Creating new connections for each request
**Impact:** Slow performance, resource exhaustion
**Fix:** Pool connections, reuse clients

### Synchronous External Calls
**Problem:** Blocking on external API calls
**Impact:** Poor throughput, cascading delays
**Fix:** Use async/await, non-blocking I/O

### Missing Timeouts
**Problem:** No timeout on external API calls
**Impact:** Requests hang indefinitely
**Fix:** Set timeouts (3-5 seconds typical)

## Production Issues

### No Health Checks
**Problem:** Server has no health/readiness endpoint
**Impact:** Load balancers can't detect failures
**Fix:** Implement `/health` with component status

### Unstructured Logging
**Problem:** Plain text logs, inconsistent format
**Impact:** Difficult to parse, monitor, alert on
**Fix:** Use JSON structured logging

### Stateful Design
**Problem:** Server stores state in memory
**Impact:** Can't scale horizontally, data loss on restart
**Fix:** Design stateless, use external state storage

### No Metrics
**Problem:** No telemetry or monitoring
**Impact:** Can't diagnose performance issues, outages
**Fix:** Expose metrics (request count, latency, errors)

## Testing Gaps

### No Protocol Compliance Tests
**Problem:** Not validating JSON-RPC 2.0 format
**Impact:** Non-compliant messages, client incompatibility
**Fix:** Add JSON-RPC schema validation tests

### Missing Error Path Tests
**Problem:** Only testing success cases
**Impact:** Unhandled errors crash server
**Fix:** Test all error conditions

### No Load Testing
**Problem:** Not testing under realistic load
**Impact:** Performance issues in production
**Fix:** Run load tests, identify bottlenecks

## Quick Fixes Reference

**Protocol:** Always include `jsonrpc: "2.0"`, never both `result` and `error`
**Capabilities:** Declare all features in `initialize` response
**Security:** Require consent, validate inputs, sanitize outputs, no hardcoded credentials
**Transport:** stderr for logs (stdio), CORS headers (HTTP), flush after writes
**Performance:** Cache, pool connections, async operations, timeouts
**Production:** Health checks, structured logging, stateless design, metrics
